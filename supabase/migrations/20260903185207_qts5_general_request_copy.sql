-- QTS5: unapplied migration reconciled by Admin immediately after live RET3.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

create table public.quick_task_request_copies (
  organization_id uuid not null,
  owner_id uuid not null,
  idempotency_key uuid not null,
  source_request_id uuid not null,
  quick_task_id uuid not null,
  created_at timestamptz not null default now(),
  constraint quick_task_request_copies_pkey primary key (organization_id, owner_id, idempotency_key),
  constraint quick_task_request_copies_task_unique unique (quick_task_id, organization_id, owner_id),
  constraint quick_task_request_copies_task_fkey foreign key (quick_task_id, organization_id, owner_id)
    references public.quick_tasks(id, organization_id, owner_id) on delete restrict,
  constraint quick_task_request_copies_source_fkey foreign key (source_request_id, organization_id)
    references public.content_requests(id, organization_id) on delete restrict
);
create index idx_quick_task_request_copies_source
  on public.quick_task_request_copies(source_request_id, organization_id);
-- The primary key covers owner-scoped reads; task uniqueness covers the task FK.
alter table public.quick_task_request_copies enable row level security;
create policy "Owners read General Request copy references"
on public.quick_task_request_copies for select to authenticated using (
  owner_id = (select auth.uid())
  and exists (
    select 1 from public.organization_memberships m
    join public.organizations o on o.id = m.organization_id
    where m.organization_id = quick_task_request_copies.organization_id
      and m.user_id = (select auth.uid()) and m.member_kind = 'team'
      and m.status = 'active' and o.status = 'active'
  )
);
revoke all on public.quick_task_request_copies from public, anon, authenticated, service_role;
grant select on public.quick_task_request_copies to authenticated;
grant select, insert on public.quick_task_request_copies to service_role;
create trigger trg_quick_task_request_copies_append_only
before update or delete on public.quick_task_request_copies
for each row execute function private.reject_quick_task_history_mutation();

create function public.copy_general_request_to_quick_task(
  p_organization_id uuid, p_source_request_id uuid, p_idempotency_key uuid, p_actor_id uuid
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_source public.content_requests;
  v_copy public.quick_task_request_copies;
  v_task public.quick_tasks;
  v_task_id uuid := gen_random_uuid();
  v_revision_id uuid := gen_random_uuid();
  v_notes text;
  v_content jsonb;
begin
  if p_organization_id is null or p_source_request_id is null
    or p_idempotency_key is null or p_actor_id is null then
    raise exception 'Copy identity is required.';
  end if;
  -- Service-only entry; actor is bound by the JWT-verified Edge Function.
  -- Share locks keep authorization stable until transaction completion.
  perform 1 from public.organizations o
    where o.id = p_organization_id and o.status = 'active' for share;
  if not found then raise insufficient_privilege using message = 'Active selected organization required.'; end if;
  perform 1 from public.organization_memberships m
    where m.organization_id = p_organization_id and m.user_id = p_actor_id
      and m.member_kind = 'team' and m.status = 'active' for share;
  if not found then raise insufficient_privilege using message = 'Active team membership required.'; end if;

  select r.* into v_source from public.content_requests r
    where r.id = p_source_request_id and r.organization_id = p_organization_id
      and r.mode = 'general' for share;
  if not found then raise insufficient_privilege using message = 'Accessible General Request required.'; end if;
  if v_source.brand_id is not null then
    perform 1 from public.brands b where b.id = v_source.brand_id
      and b.organization_id = p_organization_id for share;
    if not found then raise insufficient_privilege using message = 'Source brand organization mismatch.'; end if;
  end if;

  -- Serializes only retries for the same organization/actor/key. Hash collisions
  -- can serialize unrelated requests but cannot change their identity/result.
  perform pg_advisory_xact_lock(hashtextextended(
    p_organization_id::text || ':' || p_actor_id::text || ':' || p_idempotency_key::text, 0));
  select c.* into v_copy from public.quick_task_request_copies c
    where c.organization_id = p_organization_id and c.owner_id = p_actor_id
      and c.idempotency_key = p_idempotency_key;
  if found then
    if v_copy.source_request_id <> p_source_request_id then
      raise unique_violation using message = 'Idempotency key belongs to a different copy request.';
    end if;
    select t.* into strict v_task from public.quick_tasks t
      where t.id = v_copy.quick_task_id and t.organization_id = p_organization_id
        and t.owner_id = p_actor_id for share;
    return jsonb_build_object('quick_task_id', v_task.id, 'state', v_task.state,
      'purged', v_task.purged_at is not null, 'replayed', true);
  end if;

  -- Existing sandbox contract: all reference descriptions are inert notes.
  -- Preserve the entire brief verbatim; only the display title is an excerpt.
  v_notes := v_source.brief || E'\n\nFormat: ' || v_source.format
    || E'\nOutput path (reference only): ' || v_source.output_path
    || case when v_source.brand_id is null then '' else E'\nBrand reference: ' || v_source.brand_id::text end;
  if char_length(v_notes) > 50000 then
    raise exception 'Source exceeds Quick Task notes limit; nothing was copied.';
  end if;
  v_content := jsonb_build_object('notes', v_notes, 'checklist', '[]'::jsonb);
  insert into public.quick_tasks(id, organization_id, owner_id, title, current_revision_id)
    values (v_task_id, p_organization_id, p_actor_id,
      left(btrim(v_source.brief), 120), v_revision_id) returning * into v_task;
  insert into public.quick_task_revisions(
    id, quick_task_id, organization_id, owner_id, revision_number,
    content, content_sha256, created_by, source_kind
  ) values (
    v_revision_id, v_task_id, p_organization_id, p_actor_id, 1, v_content,
    encode(extensions.digest(convert_to(v_content::text, 'UTF8'), 'sha256'), 'hex'),
    p_actor_id, 'copied_general_request'
  );
  insert into public.quick_task_lifecycle_events(
    quick_task_id, organization_id, owner_id, actor_id, event_type, revision_number, to_state
  ) values (v_task_id, p_organization_id, p_actor_id, p_actor_id, 'created', 1, 'active');
  insert into public.quick_task_request_copies(
    organization_id, owner_id, idempotency_key, source_request_id, quick_task_id
  ) values (p_organization_id, p_actor_id, p_idempotency_key, p_source_request_id, v_task_id);
  return jsonb_build_object('quick_task_id', v_task_id, 'state', v_task.state, 'purged', false, 'replayed', false);
end;
$$;
revoke all on function public.copy_general_request_to_quick_task(uuid, uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.copy_general_request_to_quick_task(uuid, uuid, uuid, uuid) to service_role;
commit;
