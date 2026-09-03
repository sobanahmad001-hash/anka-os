-- Anka OS - QTS3 owner-controlled retention and bounded purge.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

alter table public.quick_tasks
  alter column current_revision_id drop not null,
  alter column expires_at drop not null,
  add column preserved_at timestamptz,
  add column discarded_at timestamptz,
  add column expired_at timestamptz,
  add column purged_at timestamptz,
  add column purge_reason text,
  add column final_content_sha256 text;

alter table public.quick_tasks
  drop constraint quick_tasks_expiry_order_check,
  drop constraint quick_tasks_recovery_window_check;

update public.quick_tasks task set
  preserved_at = case when task.state = 'preserved' then coalesce(task.updated_at, task.last_activity_at) end,
  discarded_at = case when task.state = 'discarded' then coalesce(task.updated_at, task.last_activity_at) end,
  expired_at = case when task.state = 'expired' then coalesce(task.expires_at, task.updated_at) end,
  recoverable_until = case
    when task.state = 'expired' then coalesce(task.recoverable_until, coalesce(task.expires_at, task.updated_at) + interval '30 days')
    when task.state = 'discarded' then coalesce(task.recoverable_until, coalesce(task.updated_at, task.last_activity_at) + interval '30 days')
    else null
  end,
  expires_at = case when task.state = 'active' then task.expires_at else null end;

alter table public.quick_tasks
  add constraint quick_tasks_expiry_shape_check check (
    (state = 'active' and expires_at is not null and expires_at >= last_activity_at and recoverable_until is null)
    or (state <> 'active' and expires_at is null)
  ),
  add constraint quick_tasks_preserved_shape_check check (
    (state = 'preserved') = (preserved_at is not null)
  ),
  add constraint quick_tasks_discarded_shape_check check (
    (state = 'discarded') = (discarded_at is not null)
  ),
  add constraint quick_tasks_expired_shape_check check (
    (state = 'expired') = (expired_at is not null)
  ),
  add constraint quick_tasks_recovery_shape_check check (
    (state in ('expired', 'discarded') and recoverable_until is not null
      and recoverable_until >= coalesce(expired_at, discarded_at))
    or (state not in ('expired', 'discarded') and recoverable_until is null)
  ),
  add constraint quick_tasks_purge_shape_check check (
    (purged_at is null and current_revision_id is not null
      and purge_reason is null and final_content_sha256 is null)
    or
    (purged_at is not null and state in ('expired', 'discarded')
      and current_revision_id is null and title = '[purged]'
      and purge_reason is not null
      and char_length(btrim(purge_reason)) between 1 and 240
      and final_content_sha256 is not null
      and final_content_sha256 ~ '^[0-9a-f]{64}$')
  );

alter table public.quick_task_lifecycle_events
  alter column actor_id drop not null,
  add column actor_kind text not null default 'owner',
  add column reason text;

alter table public.quick_task_lifecycle_events
  drop constraint quick_task_lifecycle_events_event_type_check;

alter table public.quick_task_lifecycle_events
  add constraint quick_task_lifecycle_events_event_type_check check (event_type in (
    'created', 'revision_appended', 'forked_from', 'forked_to',
    'preserved', 'unpreserved', 'expired', 'recovered', 'restored',
    'discarded', 'purged', 'promoted'
  )),
  add constraint quick_task_lifecycle_events_actor_kind_check check (
    actor_kind in ('owner', 'service')
  ),
  add constraint quick_task_lifecycle_events_actor_shape_check check (
    (actor_kind = 'owner' and actor_id is not null)
    or (actor_kind = 'service' and actor_id is null)
  ),
  add constraint quick_task_lifecycle_events_reason_length_check check (
    reason is null or char_length(btrim(reason)) between 1 and 240
  );

alter table public.ai_runs
  drop constraint ai_runs_quick_task_context_check;

alter table public.ai_runs
  add constraint ai_runs_quick_task_context_check check (
    (
      capability = 'quick_task_chat'
      and project_id is null and engagement_id is null
      and quick_task_id is not null
      and department_id is not null and connector_connection_id is not null
      and proposed_action is null and human_decision = 'not_applicable'
      and (
        (redacted_at is null and quick_task_revision_id is not null)
        or
        (redacted_at is not null and quick_task_revision_id is null
          and input_text = '' and output_text = '')
      )
    )
    or
    (
      capability <> 'quick_task_chat'
      and quick_task_id is null and quick_task_revision_id is null
      and department_id is null and connector_connection_id is null
    )
  );

drop index if exists public.idx_quick_tasks_expiry_candidates;
create index idx_quick_tasks_expiry_candidates
  on public.quick_tasks(expires_at, id)
  where state = 'active' and purged_at is null;
create index idx_quick_tasks_purge_candidates
  on public.quick_tasks(recoverable_until, id)
  where state in ('expired', 'discarded') and purged_at is null;

create or replace function private.reject_quick_task_history_mutation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op = 'DELETE'
    and tg_table_schema = 'public'
    and tg_table_name in ('quick_task_revisions', 'quick_task_messages')
    and current_user in ('postgres', 'service_role')
    and current_setting('anka.quick_task_controlled_purge', true) = 'on'
  then
    return old;
  end if;
  raise exception 'Quick Task history is append-only.';
end;
$$;

create function private.require_owned_quick_task_lifecycle(
  p_quick_task_id uuid,
  p_actor_id uuid
) returns public.quick_tasks
language plpgsql
security invoker
set search_path = ''
as $$
declare v_task public.quick_tasks;
begin
  select task.* into v_task
  from public.quick_tasks task
  where task.id = p_quick_task_id and task.owner_id = p_actor_id
  for update;
  if not found then raise exception 'Owned Quick Task not found.'; end if;
  if not exists (
    select 1 from public.organization_memberships membership
    where membership.organization_id = v_task.organization_id
      and membership.user_id = p_actor_id
      and membership.member_kind = 'team'
      and membership.status = 'active'
  ) then
    raise exception 'Active team membership required.';
  end if;
  return v_task;
end;
$$;

create function private.apply_quick_task_expiry(
  p_quick_task_id uuid,
  p_actor_id uuid,
  p_actor_kind text,
  p_reason text
) returns public.quick_tasks
language plpgsql
security invoker
set search_path = ''
as $$
declare v_task public.quick_tasks;
begin
  select task.* into v_task from public.quick_tasks task
  where task.id = p_quick_task_id for update;
  if not found then raise exception 'Quick Task not found.'; end if;
  if p_actor_kind = 'owner' then
    if p_actor_id is distinct from v_task.owner_id then raise exception 'Only the owner can expire this Quick Task.'; end if;
    if not exists (
      select 1 from public.organization_memberships membership
      where membership.organization_id = v_task.organization_id
        and membership.user_id = p_actor_id
        and membership.member_kind = 'team'
        and membership.status = 'active'
    ) then raise exception 'Active team membership required.'; end if;
  elsif p_actor_kind = 'service' then
    if p_actor_id is not null then raise exception 'Service lifecycle events cannot impersonate an actor.'; end if;
  else
    raise exception 'Unsupported lifecycle actor kind.';
  end if;
  if v_task.state = 'expired' then return v_task; end if;
  if v_task.purged_at is not null or v_task.state <> 'active' then
    raise exception 'Only active Quick Tasks can expire.';
  end if;
  if v_task.expires_at is null or v_task.expires_at > now() then
    raise exception 'Quick Task is not due to expire.';
  end if;
  update public.quick_tasks task set
    state = 'expired', expires_at = null, expired_at = now(),
    recoverable_until = now() + interval '30 days', updated_at = now()
  where task.id = v_task.id returning * into v_task;
  insert into public.quick_task_lifecycle_events (
    quick_task_id, organization_id, owner_id, actor_id, actor_kind,
    event_type, revision_number, from_state, to_state, reason
  ) values (
    v_task.id, v_task.organization_id, v_task.owner_id, p_actor_id, p_actor_kind,
    'expired', v_task.current_revision_number, 'active', 'expired',
    left(coalesce(nullif(btrim(p_reason), ''), 'inactivity_expiry'), 240)
  );
  return v_task;
end;
$$;

create function private.apply_quick_task_purge(
  p_quick_task_id uuid,
  p_actor_id uuid,
  p_actor_kind text,
  p_reason text
) returns public.quick_tasks
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_task public.quick_tasks;
  v_checksum text;
  v_from_state text;
begin
  select task.* into v_task from public.quick_tasks task
  where task.id = p_quick_task_id for update;
  if not found then raise exception 'Quick Task not found.'; end if;
  if p_actor_kind = 'owner' then
    if p_actor_id is distinct from v_task.owner_id then raise exception 'Only the owner can purge this Quick Task.'; end if;
    if not exists (
      select 1 from public.organization_memberships membership
      where membership.organization_id = v_task.organization_id
        and membership.user_id = p_actor_id
        and membership.member_kind = 'team'
        and membership.status = 'active'
    ) then raise exception 'Active team membership required.'; end if;
  elsif p_actor_kind = 'service' then
    if p_actor_id is not null then raise exception 'Service lifecycle events cannot impersonate an actor.'; end if;
  else
    raise exception 'Unsupported lifecycle actor kind.';
  end if;
  if v_task.purged_at is not null then return v_task; end if;
  if v_task.state = 'promoted' then raise exception 'Promoted Quick Tasks are never purged.'; end if;
  if v_task.state not in ('expired', 'discarded') then
    raise exception 'Only expired or discarded Quick Tasks can purge.';
  end if;
  if v_task.recoverable_until is null or v_task.recoverable_until > now() then
    raise exception 'Quick Task recovery window is still open.';
  end if;
  select revision.content_sha256 into v_checksum
  from public.quick_task_revisions revision
  where revision.id = v_task.current_revision_id
    and revision.quick_task_id = v_task.id
    and revision.organization_id = v_task.organization_id
    and revision.owner_id = v_task.owner_id;
  if v_checksum is null then raise exception 'Quick Task current revision is unavailable for tombstone checksum.'; end if;
  v_from_state := v_task.state;

  perform set_config('anka.quick_task_controlled_purge', 'on', true);

  update public.ai_runs run set
    input_text = '',
    output_text = '',
    context_manifest = jsonb_build_object(
      'purpose', 'quick_task_sandbox_revision',
      'redacted', true,
      'upstream_retention', 'disabled'
    ),
    quick_task_revision_id = null,
    redacted_at = coalesce(run.redacted_at, now())
  where run.quick_task_id = v_task.id
    and run.organization_id = v_task.organization_id
    and run.user_id = v_task.owner_id
    and run.capability = 'quick_task_chat';

  delete from public.quick_task_messages message
  where message.quick_task_id = v_task.id
    and message.organization_id = v_task.organization_id
    and message.owner_id = v_task.owner_id;

  update public.quick_tasks fork set
    forked_from_quick_task_id = null,
    forked_from_revision_id = null,
    updated_at = now()
  where fork.forked_from_quick_task_id = v_task.id
    and fork.organization_id = v_task.organization_id
    and fork.owner_id = v_task.owner_id;

  update public.quick_tasks task set
    title = '[purged]',
    current_revision_id = null,
    purged_at = now(),
    purge_reason = left(coalesce(nullif(btrim(p_reason), ''), 'recovery_window_elapsed'), 240),
    final_content_sha256 = v_checksum,
    updated_at = now()
  where task.id = v_task.id returning * into v_task;

  delete from public.quick_task_revisions revision
  where revision.quick_task_id = v_task.id
    and revision.organization_id = v_task.organization_id
    and revision.owner_id = v_task.owner_id;

  perform set_config('anka.quick_task_controlled_purge', 'off', true);

  insert into public.quick_task_lifecycle_events (
    quick_task_id, organization_id, owner_id, actor_id, actor_kind,
    event_type, revision_number, from_state, to_state, reason
  ) values (
    v_task.id, v_task.organization_id, v_task.owner_id, p_actor_id, p_actor_kind,
    'purged', v_task.current_revision_number, v_from_state, v_from_state,
    v_task.purge_reason
  );
  return v_task;
end;
$$;

create function public.preserve_quick_task(p_quick_task_id uuid, p_actor_id uuid)
returns public.quick_tasks
language plpgsql security invoker set search_path = ''
as $$
declare v_task public.quick_tasks; v_from_state text;
begin
  v_task := private.require_owned_quick_task_lifecycle(p_quick_task_id, p_actor_id);
  if v_task.purged_at is not null then raise exception 'Purged Quick Tasks cannot change lifecycle.'; end if;
  if v_task.state = 'preserved' then return v_task; end if;
  if v_task.state not in ('active', 'expired', 'discarded') then
    raise exception 'Only active or recoverable Quick Tasks can be preserved.';
  end if;
  if v_task.state in ('expired', 'discarded')
    and (v_task.recoverable_until is null or v_task.recoverable_until <= now())
  then raise exception 'Quick Task recovery window has closed.'; end if;
  v_from_state := v_task.state;
  update public.quick_tasks task set
    state = 'preserved', preserved_at = now(), discarded_at = null, expired_at = null,
    expires_at = null, recoverable_until = null, updated_at = now()
  where task.id = v_task.id returning * into v_task;
  insert into public.quick_task_lifecycle_events (
    quick_task_id, organization_id, owner_id, actor_id, actor_kind,
    event_type, revision_number, from_state, to_state
  ) values (
    v_task.id, v_task.organization_id, v_task.owner_id, p_actor_id, 'owner',
    'preserved', v_task.current_revision_number, v_from_state, 'preserved'
  );
  return v_task;
end;
$$;

create function public.unpreserve_quick_task(p_quick_task_id uuid, p_actor_id uuid)
returns public.quick_tasks
language plpgsql security invoker set search_path = ''
as $$
declare v_task public.quick_tasks;
begin
  v_task := private.require_owned_quick_task_lifecycle(p_quick_task_id, p_actor_id);
  if v_task.purged_at is not null then raise exception 'Purged Quick Tasks cannot change lifecycle.'; end if;
  if v_task.state = 'active' then return v_task; end if;
  if v_task.state <> 'preserved' then raise exception 'Only preserved Quick Tasks can be unpreserved.'; end if;
  update public.quick_tasks task set
    state = 'active', preserved_at = null, last_activity_at = now(),
    expires_at = now() + interval '30 days', updated_at = now()
  where task.id = v_task.id returning * into v_task;
  insert into public.quick_task_lifecycle_events (
    quick_task_id, organization_id, owner_id, actor_id, actor_kind,
    event_type, revision_number, from_state, to_state
  ) values (
    v_task.id, v_task.organization_id, v_task.owner_id, p_actor_id, 'owner',
    'unpreserved', v_task.current_revision_number, 'preserved', 'active'
  );
  return v_task;
end;
$$;

create function public.discard_quick_task(p_quick_task_id uuid, p_actor_id uuid)
returns public.quick_tasks
language plpgsql security invoker set search_path = ''
as $$
declare v_task public.quick_tasks; v_from_state text;
begin
  v_task := private.require_owned_quick_task_lifecycle(p_quick_task_id, p_actor_id);
  if v_task.purged_at is not null then raise exception 'Purged Quick Tasks cannot change lifecycle.'; end if;
  if v_task.state = 'discarded' then return v_task; end if;
  if v_task.state not in ('active', 'preserved', 'expired') then
    raise exception 'Only active, preserved, or recoverable expired Quick Tasks can be discarded.';
  end if;
  if v_task.state = 'expired'
    and (v_task.recoverable_until is null or v_task.recoverable_until <= now())
  then raise exception 'Quick Task recovery window has closed.'; end if;
  v_from_state := v_task.state;
  update public.quick_tasks task set
    state = 'discarded', preserved_at = null, discarded_at = now(),
    expired_at = null, expires_at = null,
    recoverable_until = case when v_from_state = 'expired'
      then v_task.recoverable_until else now() + interval '30 days' end,
    updated_at = now()
  where task.id = v_task.id returning * into v_task;
  insert into public.quick_task_lifecycle_events (
    quick_task_id, organization_id, owner_id, actor_id, actor_kind,
    event_type, revision_number, from_state, to_state
  ) values (
    v_task.id, v_task.organization_id, v_task.owner_id, p_actor_id, 'owner',
    'discarded', v_task.current_revision_number, v_from_state, 'discarded'
  );
  return v_task;
end;
$$;

create function public.restore_quick_task(p_quick_task_id uuid, p_actor_id uuid)
returns public.quick_tasks
language plpgsql security invoker set search_path = ''
as $$
declare v_task public.quick_tasks; v_from_state text;
begin
  v_task := private.require_owned_quick_task_lifecycle(p_quick_task_id, p_actor_id);
  if v_task.purged_at is not null then raise exception 'Purged Quick Tasks cannot be restored.'; end if;
  if v_task.state = 'active' then return v_task; end if;
  if v_task.state not in ('expired', 'discarded') then
    raise exception 'Only expired or discarded Quick Tasks can be restored.';
  end if;
  if v_task.recoverable_until is null or v_task.recoverable_until <= now() then
    raise exception 'Quick Task recovery window has closed.';
  end if;
  v_from_state := v_task.state;
  update public.quick_tasks task set
    state = 'active', preserved_at = null, discarded_at = null, expired_at = null,
    last_activity_at = now(), expires_at = now() + interval '30 days',
    recoverable_until = null, updated_at = now()
  where task.id = v_task.id returning * into v_task;
  insert into public.quick_task_lifecycle_events (
    quick_task_id, organization_id, owner_id, actor_id, actor_kind,
    event_type, revision_number, from_state, to_state
  ) values (
    v_task.id, v_task.organization_id, v_task.owner_id, p_actor_id, 'owner',
    'restored', v_task.current_revision_number, v_from_state, 'active'
  );
  return v_task;
end;
$$;

create function public.expire_quick_task(p_quick_task_id uuid, p_actor_id uuid)
returns public.quick_tasks
language sql security invoker set search_path = ''
as $$
  select private.apply_quick_task_expiry($1, $2, 'owner', 'owner_due_expiry');
$$;

create function public.purge_quick_task(p_quick_task_id uuid, p_actor_id uuid)
returns public.quick_tasks
language sql security invoker set search_path = ''
as $$
  select private.apply_quick_task_purge($1, $2, 'owner', 'owner_due_purge');
$$;

create function public.expire_due_quick_tasks(p_limit integer default 100)
returns jsonb
language plpgsql security invoker set search_path = ''
as $$
declare
  v_task public.quick_tasks;
  v_ids uuid[] := '{}'::uuid[];
begin
  if p_limit is null or p_limit not between 1 and 500 then
    raise exception 'Expiry batch limit must be between 1 and 500.';
  end if;
  for v_task in
    select task.* from public.quick_tasks task
    where task.state = 'active' and task.purged_at is null
      and task.expires_at <= now()
    order by task.expires_at, task.id
    limit p_limit
    for update skip locked
  loop
    perform private.apply_quick_task_expiry(
      v_task.id, null, 'service', 'inactivity_expiry'
    );
    v_ids := array_append(v_ids, v_task.id);
  end loop;
  return jsonb_build_object('processed', cardinality(v_ids), 'quick_task_ids', to_jsonb(v_ids));
end;
$$;

create function public.purge_due_quick_tasks(p_limit integer default 100)
returns jsonb
language plpgsql security invoker set search_path = ''
as $$
declare
  v_task public.quick_tasks;
  v_ids uuid[] := '{}'::uuid[];
begin
  if p_limit is null or p_limit not between 1 and 500 then
    raise exception 'Purge batch limit must be between 1 and 500.';
  end if;
  for v_task in
    select task.* from public.quick_tasks task
    where task.state in ('expired', 'discarded') and task.purged_at is null
      and task.recoverable_until <= now()
    order by task.recoverable_until, task.id
    limit p_limit
    for update skip locked
  loop
    perform private.apply_quick_task_purge(
      v_task.id, null, 'service', 'recovery_window_elapsed'
    );
    v_ids := array_append(v_ids, v_task.id);
  end loop;
  return jsonb_build_object('processed', cardinality(v_ids), 'quick_task_ids', to_jsonb(v_ids));
end;
$$;

revoke all on function private.require_owned_quick_task_lifecycle(uuid, uuid) from public, anon, authenticated;
revoke all on function private.apply_quick_task_expiry(uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function private.apply_quick_task_purge(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function private.require_owned_quick_task_lifecycle(uuid, uuid) to service_role;
grant execute on function private.apply_quick_task_expiry(uuid, uuid, text, text) to service_role;
grant execute on function private.apply_quick_task_purge(uuid, uuid, text, text) to service_role;

revoke all on function public.preserve_quick_task(uuid, uuid) from public, anon, authenticated;
revoke all on function public.unpreserve_quick_task(uuid, uuid) from public, anon, authenticated;
revoke all on function public.discard_quick_task(uuid, uuid) from public, anon, authenticated;
revoke all on function public.restore_quick_task(uuid, uuid) from public, anon, authenticated;
revoke all on function public.expire_quick_task(uuid, uuid) from public, anon, authenticated;
revoke all on function public.purge_quick_task(uuid, uuid) from public, anon, authenticated;
revoke all on function public.expire_due_quick_tasks(integer) from public, anon, authenticated;
revoke all on function public.purge_due_quick_tasks(integer) from public, anon, authenticated;
grant execute on function public.preserve_quick_task(uuid, uuid) to service_role;
grant execute on function public.unpreserve_quick_task(uuid, uuid) to service_role;
grant execute on function public.discard_quick_task(uuid, uuid) to service_role;
grant execute on function public.restore_quick_task(uuid, uuid) to service_role;
grant execute on function public.expire_quick_task(uuid, uuid) to service_role;
grant execute on function public.purge_quick_task(uuid, uuid) to service_role;
grant execute on function public.expire_due_quick_tasks(integer) to service_role;
grant execute on function public.purge_due_quick_tasks(integer) to service_role;

comment on function public.expire_due_quick_tasks(integer) is
  'Bounded idempotent service-role routine for due active Quick Tasks. Scheduling is intentionally not configured.';
comment on function public.purge_due_quick_tasks(integer) is
  'Bounded idempotent service-role routine that purges elapsed recoverable payload and redacts linked QTS AI content.';
comment on column public.quick_tasks.final_content_sha256 is
  'Final current-revision checksum retained in the content-free purge tombstone.';

commit;