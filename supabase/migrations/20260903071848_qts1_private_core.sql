-- Anka OS - QTS1 owner-private Quick Tasks core.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

create table public.quick_tasks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  owner_id uuid not null references auth.users(id) on delete restrict,
  title text not null,
  state text not null default 'active',
  current_revision_id uuid not null,
  current_revision_number integer not null default 1,
  forked_from_quick_task_id uuid,
  forked_from_revision_id uuid,
  last_activity_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '30 days'),
  recoverable_until timestamptz,
  promoted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint quick_tasks_title_length_check check (char_length(btrim(title)) between 1 and 240),
  constraint quick_tasks_state_check check (state in ('active', 'preserved', 'expired', 'discarded', 'promoted')),
  constraint quick_tasks_revision_number_check check (current_revision_number >= 1),
  constraint quick_tasks_fork_source_pair_check check ((forked_from_quick_task_id is null) = (forked_from_revision_id is null)),
  constraint quick_tasks_expiry_order_check check (expires_at >= last_activity_at),
  constraint quick_tasks_recovery_window_check check (recoverable_until is null or recoverable_until >= expires_at),
  constraint quick_tasks_promotion_state_check check ((state = 'promoted') = (promoted_at is not null)),
  unique (id, organization_id),
  unique (id, organization_id, owner_id)
);

create table public.quick_task_revisions (
  id uuid primary key default gen_random_uuid(),
  quick_task_id uuid not null,
  organization_id uuid not null,
  owner_id uuid not null references auth.users(id) on delete restrict,
  revision_number integer not null check (revision_number >= 1),
  content jsonb not null check (jsonb_typeof(content) = 'object'),
  content_sha256 text not null check (content_sha256 ~ '^[0-9a-f]{64}$'),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint quick_task_revisions_task_fkey foreign key (quick_task_id, organization_id, owner_id)
    references public.quick_tasks(id, organization_id, owner_id) on delete restrict,
  unique (quick_task_id, revision_number),
  unique (id, quick_task_id, organization_id, owner_id)
);

alter table public.quick_tasks add constraint quick_tasks_current_revision_fkey
  foreign key (current_revision_id, id, organization_id, owner_id)
  references public.quick_task_revisions(id, quick_task_id, organization_id, owner_id)
  on delete restrict deferrable initially deferred;
alter table public.quick_tasks add constraint quick_tasks_forked_from_task_fkey
  foreign key (forked_from_quick_task_id, organization_id, owner_id)
  references public.quick_tasks(id, organization_id, owner_id) on delete restrict;
alter table public.quick_tasks add constraint quick_tasks_forked_from_revision_fkey
  foreign key (forked_from_revision_id, forked_from_quick_task_id, organization_id, owner_id)
  references public.quick_task_revisions(id, quick_task_id, organization_id, owner_id) on delete restrict;

create table public.quick_task_lifecycle_events (
  id uuid primary key default gen_random_uuid(),
  quick_task_id uuid not null,
  organization_id uuid not null,
  owner_id uuid not null references auth.users(id) on delete restrict,
  actor_id uuid not null references auth.users(id) on delete restrict,
  event_type text not null check (event_type in (
    'created', 'revision_appended', 'forked_from', 'forked_to',
    'preserved', 'expired', 'recovered', 'discarded', 'promoted'
  )),
  revision_number integer check (revision_number is null or revision_number >= 1),
  from_state text check (from_state is null or from_state in ('active', 'preserved', 'expired', 'discarded', 'promoted')),
  to_state text check (to_state is null or to_state in ('active', 'preserved', 'expired', 'discarded', 'promoted')),
  related_quick_task_id uuid,
  occurred_at timestamptz not null default now(),
  constraint quick_task_lifecycle_events_task_fkey foreign key (quick_task_id, organization_id, owner_id)
    references public.quick_tasks(id, organization_id, owner_id) on delete restrict,
  constraint quick_task_lifecycle_events_related_task_fkey foreign key (related_quick_task_id, organization_id, owner_id)
    references public.quick_tasks(id, organization_id, owner_id) on delete restrict
);

create index idx_quick_tasks_owner_activity on public.quick_tasks(owner_id, state, last_activity_at desc);
create index idx_quick_tasks_organization_owner on public.quick_tasks(organization_id, owner_id, updated_at desc);
create index idx_quick_tasks_expiry_candidates on public.quick_tasks(expires_at) where state = 'active';
create index idx_quick_tasks_current_revision on public.quick_tasks(current_revision_id, id, organization_id, owner_id);
create index idx_quick_tasks_fork_source on public.quick_tasks(forked_from_quick_task_id, organization_id, owner_id)
  where forked_from_quick_task_id is not null;
create index idx_quick_tasks_fork_revision on public.quick_tasks(forked_from_revision_id, forked_from_quick_task_id, organization_id, owner_id)
  where forked_from_revision_id is not null;
create index idx_quick_task_revisions_task_created on public.quick_task_revisions(quick_task_id, revision_number desc);
create index idx_quick_task_revisions_task_owner on public.quick_task_revisions(quick_task_id, organization_id, owner_id);
create index idx_quick_task_revisions_organization_owner on public.quick_task_revisions(organization_id, owner_id, created_at desc);
create index idx_quick_task_revisions_owner on public.quick_task_revisions(owner_id);
create index idx_quick_task_revisions_created_by on public.quick_task_revisions(created_by);
create index idx_quick_task_lifecycle_events_task on public.quick_task_lifecycle_events(quick_task_id, occurred_at desc);
create index idx_quick_task_lifecycle_events_task_owner on public.quick_task_lifecycle_events(quick_task_id, organization_id, owner_id);
create index idx_quick_task_lifecycle_events_audit on public.quick_task_lifecycle_events(organization_id, occurred_at desc);
create index idx_quick_task_lifecycle_events_actor on public.quick_task_lifecycle_events(actor_id, occurred_at desc);
create index idx_quick_task_lifecycle_events_owner on public.quick_task_lifecycle_events(owner_id, occurred_at desc);
create index idx_quick_task_lifecycle_events_related on public.quick_task_lifecycle_events(related_quick_task_id, organization_id, owner_id)
  where related_quick_task_id is not null;

create function private.reject_quick_task_history_mutation() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin raise exception 'Quick Task history is append-only.'; end;
$$;
create trigger trg_quick_task_revisions_append_only before update or delete on public.quick_task_revisions
for each row execute function private.reject_quick_task_history_mutation();
create trigger trg_quick_task_lifecycle_events_append_only before update or delete on public.quick_task_lifecycle_events
for each row execute function private.reject_quick_task_history_mutation();

alter table public.quick_tasks enable row level security;
alter table public.quick_task_revisions enable row level security;
alter table public.quick_task_lifecycle_events enable row level security;
create policy "Owners can read their Quick Tasks" on public.quick_tasks for select to authenticated
using (owner_id = (select auth.uid()) and public.is_team_organization_member(organization_id));
create policy "Owners can read their Quick Task revisions" on public.quick_task_revisions for select to authenticated
using (owner_id = (select auth.uid()) and public.is_team_organization_member(organization_id));
create policy "Owners and leaders can read Quick Task lifecycle metadata"
on public.quick_task_lifecycle_events for select to authenticated using (
  (owner_id = (select auth.uid()) and public.is_team_organization_member(organization_id))
  or public.has_organization_role(organization_id, array['system_owner', 'operations_admin', 'executive'])
);

revoke all on table public.quick_tasks, public.quick_task_revisions, public.quick_task_lifecycle_events
  from public, anon, authenticated;
grant select on table public.quick_tasks, public.quick_task_revisions, public.quick_task_lifecycle_events
  to authenticated, service_role;
grant all on table public.quick_tasks, public.quick_task_revisions, public.quick_task_lifecycle_events
  to service_role;

create function public.create_quick_task(p_organization_id uuid, p_actor_id uuid, p_title text, p_content jsonb)
returns public.quick_tasks language plpgsql security invoker set search_path = '' as $$
declare v_task_id uuid := gen_random_uuid(); v_revision_id uuid := gen_random_uuid(); v_task public.quick_tasks;
begin
  if not exists (select 1 from public.organization_memberships m where m.organization_id = p_organization_id
    and m.user_id = p_actor_id and m.member_kind = 'team' and m.status = 'active') then
    raise exception 'Active team membership required.';
  end if;
  if char_length(btrim(coalesce(p_title, ''))) not between 1 and 240 then raise exception 'Quick Task title must be between 1 and 240 characters.'; end if;
  if jsonb_typeof(p_content) is distinct from 'object' then raise exception 'Quick Task content must be a JSON object.'; end if;
  insert into public.quick_tasks (id, organization_id, owner_id, title, current_revision_id)
  values (v_task_id, p_organization_id, p_actor_id, btrim(p_title), v_revision_id) returning * into v_task;
  insert into public.quick_task_revisions (id, quick_task_id, organization_id, owner_id, revision_number, content, content_sha256, created_by)
  values (v_revision_id, v_task.id, v_task.organization_id, v_task.owner_id, 1, p_content,
    encode(extensions.digest(convert_to(p_content::text, 'UTF8'), 'sha256'), 'hex'), p_actor_id);
  insert into public.quick_task_lifecycle_events (quick_task_id, organization_id, owner_id, actor_id, event_type, revision_number, to_state)
  values (v_task.id, v_task.organization_id, v_task.owner_id, p_actor_id, 'created', 1, 'active');
  return v_task;
end; $$;

create function public.append_quick_task_revision(p_quick_task_id uuid, p_actor_id uuid, p_expected_revision_id uuid, p_title text, p_content jsonb)
returns public.quick_tasks language plpgsql security invoker set search_path = '' as $$
declare v_task public.quick_tasks; v_revision_id uuid := gen_random_uuid(); v_number integer;
begin
  select task.* into v_task from public.quick_tasks task
  where task.id = p_quick_task_id and task.owner_id = p_actor_id for update;
  if not found then raise exception 'Owned Quick Task not found.'; end if;
  if not exists (select 1 from public.organization_memberships m where m.organization_id = v_task.organization_id
    and m.user_id = p_actor_id and m.member_kind = 'team' and m.status = 'active') then
    raise exception 'Active team membership required.';
  end if;
  if v_task.state <> 'active' then raise exception 'Only active Quick Tasks can be edited.'; end if;
  if v_task.current_revision_id <> p_expected_revision_id then raise exception 'Quick Task changed; reload before saving.'; end if;
  if char_length(btrim(coalesce(p_title, ''))) not between 1 and 240 then raise exception 'Quick Task title must be between 1 and 240 characters.'; end if;
  if jsonb_typeof(p_content) is distinct from 'object' then raise exception 'Quick Task content must be a JSON object.'; end if;
  v_number := v_task.current_revision_number + 1;
  insert into public.quick_task_revisions (id, quick_task_id, organization_id, owner_id, revision_number, content, content_sha256, created_by)
  values (v_revision_id, v_task.id, v_task.organization_id, v_task.owner_id, v_number, p_content,
    encode(extensions.digest(convert_to(p_content::text, 'UTF8'), 'sha256'), 'hex'), p_actor_id);
  update public.quick_tasks task set title = btrim(p_title), current_revision_id = v_revision_id,
    current_revision_number = v_number, last_activity_at = now(), expires_at = now() + interval '30 days',
    recoverable_until = null, updated_at = now() where task.id = v_task.id returning * into v_task;
  insert into public.quick_task_lifecycle_events (quick_task_id, organization_id, owner_id, actor_id, event_type, revision_number, from_state, to_state)
  values (v_task.id, v_task.organization_id, v_task.owner_id, p_actor_id, 'revision_appended', v_number, 'active', 'active');
  return v_task;
end; $$;

create function public.fork_quick_task(p_source_quick_task_id uuid, p_source_revision_id uuid, p_actor_id uuid, p_title text default null)
returns public.quick_tasks language plpgsql security invoker set search_path = '' as $$
declare v_source public.quick_tasks; v_source_revision public.quick_task_revisions;
  v_task_id uuid := gen_random_uuid(); v_revision_id uuid := gen_random_uuid(); v_task public.quick_tasks; v_title text;
begin
  select task.* into v_source from public.quick_tasks task where task.id = p_source_quick_task_id
    and task.owner_id = p_actor_id and task.state in ('active', 'preserved', 'expired') for share;
  if not found then raise exception 'Forkable owned Quick Task not found.'; end if;
  if not exists (select 1 from public.organization_memberships m where m.organization_id = v_source.organization_id
    and m.user_id = p_actor_id and m.member_kind = 'team' and m.status = 'active') then
    raise exception 'Active team membership required.';
  end if;
  if v_source.state = 'expired' and (v_source.recoverable_until is null or v_source.recoverable_until < now()) then
    raise exception 'Quick Task recovery window has closed.';
  end if;
  select revision.* into v_source_revision from public.quick_task_revisions revision
  where revision.id = p_source_revision_id and revision.quick_task_id = v_source.id
    and revision.organization_id = v_source.organization_id;
  if not found then raise exception 'Source revision does not belong to this Quick Task.'; end if;
  v_title := btrim(coalesce(nullif(p_title, ''), v_source.title || ' (fork)'));
  if char_length(v_title) not between 1 and 240 then raise exception 'Quick Task title must be between 1 and 240 characters.'; end if;
  insert into public.quick_tasks (id, organization_id, owner_id, title, current_revision_id, forked_from_quick_task_id, forked_from_revision_id)
  values (v_task_id, v_source.organization_id, p_actor_id, v_title, v_revision_id, v_source.id, v_source_revision.id) returning * into v_task;
  insert into public.quick_task_revisions (id, quick_task_id, organization_id, owner_id, revision_number, content, content_sha256, created_by)
  values (v_revision_id, v_task.id, v_task.organization_id, v_task.owner_id, 1, v_source_revision.content, v_source_revision.content_sha256, p_actor_id);
  insert into public.quick_task_lifecycle_events (quick_task_id, organization_id, owner_id, actor_id, event_type, revision_number, to_state, related_quick_task_id)
  values (v_task.id, v_task.organization_id, v_task.owner_id, p_actor_id, 'forked_from', 1, 'active', v_source.id),
    (v_source.id, v_source.organization_id, v_source.owner_id, p_actor_id, 'forked_to', v_source_revision.revision_number, v_source.state, v_task.id);
  return v_task;
end; $$;

revoke all on function private.reject_quick_task_history_mutation() from public, anon, authenticated;
grant execute on function private.reject_quick_task_history_mutation() to service_role;
revoke all on function public.create_quick_task(uuid, uuid, text, jsonb) from public, anon, authenticated;
revoke all on function public.append_quick_task_revision(uuid, uuid, uuid, text, jsonb) from public, anon, authenticated;
revoke all on function public.fork_quick_task(uuid, uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.create_quick_task(uuid, uuid, text, jsonb) to service_role;
grant execute on function public.append_quick_task_revision(uuid, uuid, uuid, text, jsonb) to service_role;
grant execute on function public.fork_quick_task(uuid, uuid, uuid, text) to service_role;

comment on table public.quick_tasks is 'Owner-private, non-canonical working-memory records with a 30-day inactivity clock.';
comment on table public.quick_task_revisions is 'Immutable Quick Task content snapshots; readable only by their owner.';
comment on table public.quick_task_lifecycle_events is 'Append-only metadata audit. It intentionally contains no title or content fields.';
commit;
