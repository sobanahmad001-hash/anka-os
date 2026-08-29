begin;

create table public.artifact_approval_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  artifact_version_id uuid not null,
  approval_policy text not null check (approval_policy in ('sequential', 'parallel')),
  status text not null default 'pending' check (status in ('pending', 'completed', 'cancelled')),
  requested_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  foreign key (artifact_version_id, organization_id)
    references public.artifact_versions(id, organization_id) on delete restrict,
  unique (artifact_version_id),
  unique (id, organization_id)
);

create table public.artifact_approval_signoffs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  request_id uuid not null,
  required_approver_id uuid not null references auth.users(id) on delete restrict,
  sequence_position integer,
  signed_off_at timestamptz,
  foreign key (request_id, organization_id)
    references public.artifact_approval_requests(id, organization_id) on delete cascade,
  unique (request_id, required_approver_id)
);

create unique index artifact_approval_signoffs_request_sequence_key
  on public.artifact_approval_signoffs (request_id, sequence_position)
  where sequence_position is not null;
create index artifact_approval_requests_organization_status_idx
  on public.artifact_approval_requests (organization_id, status, created_at desc);
create index artifact_approval_signoffs_organization_approver_idx
  on public.artifact_approval_signoffs (organization_id, required_approver_id, signed_off_at);

alter table public.artifact_approval_requests enable row level security;
alter table public.artifact_approval_signoffs enable row level security;

create policy "Team can read artifact approval requests"
  on public.artifact_approval_requests for select to authenticated
  using (public.is_team_organization_member(organization_id));

create policy "Team can read artifact approval signoffs"
  on public.artifact_approval_signoffs for select to authenticated
  using (public.is_team_organization_member(organization_id));

revoke all on public.artifact_approval_requests from anon, authenticated;
revoke all on public.artifact_approval_signoffs from anon, authenticated;
grant select on public.artifact_approval_requests, public.artifact_approval_signoffs to authenticated;
grant all on public.artifact_approval_requests, public.artifact_approval_signoffs to service_role;

create or replace function private.validate_artifact_approval_request_update()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.id is distinct from old.id
    or new.organization_id is distinct from old.organization_id
    or new.artifact_version_id is distinct from old.artifact_version_id
    or new.approval_policy is distinct from old.approval_policy
    or new.requested_by is distinct from old.requested_by
    or new.created_at is distinct from old.created_at
  then
    raise exception 'Approval request details are immutable';
  end if;

  if old.status <> 'pending' or new.status not in ('completed', 'cancelled') then
    raise exception 'Invalid approval request status transition';
  end if;
  if new.status = 'completed' and exists (
    select 1 from public.artifact_approval_signoffs
    where request_id = old.id and signed_off_at is null
  ) then
    raise exception 'Every required approver must sign before completion';
  end if;
  return new;
end;
$$;

create trigger validate_artifact_approval_request_update
before update on public.artifact_approval_requests
for each row execute function private.validate_artifact_approval_request_update();

create or replace function private.validate_artifact_approval_signoff()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  request_row public.artifact_approval_requests%rowtype;
begin
  select * into request_row
  from public.artifact_approval_requests
  where id = new.request_id and organization_id = new.organization_id;

  if not found then
    raise exception 'Approval request not found';
  end if;

  if tg_op = 'INSERT' then
    if new.signed_off_at is not null then
      raise exception 'A new sign-off must start unsigned';
    end if;
    if request_row.approval_policy = 'sequential'
      and (new.sequence_position is null or new.sequence_position < 1) then
      raise exception 'Sequential approval requires a positive sequence position';
    end if;
    if request_row.approval_policy = 'parallel' and new.sequence_position is not null then
      raise exception 'Parallel approval does not use sequence positions';
    end if;
    return new;
  end if;

  if new.id is distinct from old.id
    or new.organization_id is distinct from old.organization_id
    or new.request_id is distinct from old.request_id
    or new.required_approver_id is distinct from old.required_approver_id
    or new.sequence_position is distinct from old.sequence_position
  then
    raise exception 'Approval sign-off assignments are immutable';
  end if;
  if request_row.status <> 'pending' or old.signed_off_at is not null or new.signed_off_at is null then
    raise exception 'This approval sign-off cannot be changed';
  end if;
  if request_row.approval_policy = 'sequential' and exists (
    select 1 from public.artifact_approval_signoffs earlier
    where earlier.request_id = new.request_id
      and earlier.sequence_position < new.sequence_position
      and earlier.signed_off_at is null
  ) then
    raise exception 'Earlier sequential approvers must sign first';
  end if;
  return new;
end;
$$;

create trigger validate_artifact_approval_signoff
before insert or update on public.artifact_approval_signoffs
for each row execute function private.validate_artifact_approval_signoff();

create or replace function private.guard_pending_multi_approval()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  perform 1 from public.artifact_versions
  where id = new.artifact_version_id and organization_id = new.organization_id
  for update;

  if exists (
    select 1 from public.artifact_approval_requests
    where artifact_version_id = new.artifact_version_id
      and organization_id = new.organization_id
      and status = 'pending'
  ) then
    raise exception 'This version is governed by a pending multi-approver request';
  end if;
  return new;
end;
$$;

create trigger guard_pending_multi_approval
before insert on public.artifact_approvals
for each row execute function private.guard_pending_multi_approval();

revoke all on function private.validate_artifact_approval_request_update() from public, anon, authenticated;
revoke all on function private.validate_artifact_approval_signoff() from public, anon, authenticated;
revoke all on function private.guard_pending_multi_approval() from public, anon, authenticated;
grant execute on function private.validate_artifact_approval_request_update() to service_role;
grant execute on function private.validate_artifact_approval_signoff() to service_role;
grant execute on function private.guard_pending_multi_approval() to service_role;

create or replace function public.create_artifact_approval_request(
  p_artifact_version_id uuid,
  p_approval_policy text,
  p_required_approver_ids uuid[],
  p_requested_by uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  version_row record;
  request_row public.artifact_approval_requests%rowtype;
  approver_count integer;
begin
  if p_approval_policy not in ('sequential', 'parallel') then
    raise exception 'Approval policy must be sequential or parallel';
  end if;
  if p_required_approver_ids is null
    or cardinality(p_required_approver_ids) < 2
    or cardinality(p_required_approver_ids) > 50
    or array_position(p_required_approver_ids, null) is not null
  then
    raise exception 'Select between 2 and 50 required approvers';
  end if;
  select count(distinct approver_id) into approver_count
  from unnest(p_required_approver_ids) approver_id;
  if approver_count <> cardinality(p_required_approver_ids) then
    raise exception 'Required approvers must be unique';
  end if;

  select av.id, av.organization_id, av.artifact_id
  into version_row
  from public.artifact_versions av
  where av.id = p_artifact_version_id
  for update;
  if not found then raise exception 'Artifact version not found'; end if;

  if not exists (
    select 1 from public.organization_memberships
    where organization_id = version_row.organization_id and user_id = p_requested_by
      and member_kind = 'team' and status = 'active'
  ) then
    raise exception 'Requester must be an active team member';
  end if;
  if exists (
    select 1 from unnest(p_required_approver_ids) approver_id
    where not exists (
      select 1 from public.organization_memberships membership
      where membership.organization_id = version_row.organization_id
        and membership.user_id = approver_id
        and membership.member_kind = 'team' and membership.status = 'active'
    )
  ) then
    raise exception 'Every required approver must be an active team member';
  end if;
  if exists (select 1 from public.artifact_approvals where artifact_version_id = version_row.id) then
    raise exception 'This artifact version is already approved';
  end if;

  insert into public.artifact_approval_requests (
    organization_id, artifact_version_id, approval_policy, requested_by
  ) values (
    version_row.organization_id, version_row.id, p_approval_policy, p_requested_by
  ) returning * into request_row;

  insert into public.artifact_approval_signoffs (
    organization_id, request_id, required_approver_id, sequence_position
  )
  select version_row.organization_id, request_row.id, approver_id,
    case when p_approval_policy = 'sequential' then ordinal::integer else null end
  from unnest(p_required_approver_ids) with ordinality selected(approver_id, ordinal);

  return to_jsonb(request_row);
end;
$$;

create or replace function public.sign_off_artifact_approval(
  p_request_id uuid,
  p_actor_id uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  request_row public.artifact_approval_requests%rowtype;
  signoff_row public.artifact_approval_signoffs%rowtype;
  artifact_row record;
  remaining_count integer;
  approval_row public.artifact_approvals%rowtype;
begin
  select * into request_row
  from public.artifact_approval_requests
  where id = p_request_id
  for update;
  if not found then raise exception 'Approval request not found'; end if;
  if request_row.status <> 'pending' then raise exception 'Approval request is not pending'; end if;

  if not exists (
    select 1 from public.organization_memberships
    where organization_id = request_row.organization_id and user_id = p_actor_id
      and member_kind = 'team' and status = 'active'
  ) then
    raise exception 'Approver must be an active team member';
  end if;

  select * into signoff_row
  from public.artifact_approval_signoffs
  where request_id = request_row.id and required_approver_id = p_actor_id
  for update;
  if not found then raise exception 'Only a named approver can sign this request'; end if;
  if signoff_row.signed_off_at is not null then raise exception 'This approver has already signed'; end if;

  update public.artifact_approval_signoffs
  set signed_off_at = statement_timestamp()
  where id = signoff_row.id
  returning * into signoff_row;

  select count(*) into remaining_count
  from public.artifact_approval_signoffs
  where request_id = request_row.id and signed_off_at is null;

  if remaining_count = 0 then
    update public.artifact_approval_requests set status = 'completed'
    where id = request_row.id;

    select av.artifact_id, artifact.engagement_id, artifact.artifact_type
    into artifact_row
    from public.artifact_versions av
    join public.artifacts artifact on artifact.id = av.artifact_id
      and artifact.organization_id = av.organization_id
    where av.id = request_row.artifact_version_id
      and av.organization_id = request_row.organization_id;

    insert into public.artifact_approvals (
      organization_id, artifact_id, artifact_version_id, engagement_id, approved_by
    ) values (
      request_row.organization_id, artifact_row.artifact_id,
      request_row.artifact_version_id, artifact_row.engagement_id, p_actor_id
    ) returning * into approval_row;

    insert into public.engagement_events (
      organization_id, engagement_id, event_type, actor_id, payload
    ) values (
      request_row.organization_id, artifact_row.engagement_id,
      'artifact_approved', p_actor_id,
      jsonb_build_object(
        'record_type', 'artifact', 'record_id', artifact_row.artifact_id,
        'version_id', request_row.artifact_version_id, 'action', 'approved',
        'artifact_type', artifact_row.artifact_type,
        'approval_request_id', request_row.id,
        'approval_policy', request_row.approval_policy
      )
    );
  end if;

  return jsonb_build_object(
    'request_id', request_row.id,
    'status', case when remaining_count = 0 then 'completed' else 'pending' end,
    'signed_off_at', signoff_row.signed_off_at,
    'approval_id', approval_row.id
  );
end;
$$;

revoke all on function public.create_artifact_approval_request(uuid, text, uuid[], uuid) from public, anon, authenticated;
revoke all on function public.sign_off_artifact_approval(uuid, uuid) from public, anon, authenticated;
grant execute on function public.create_artifact_approval_request(uuid, text, uuid[], uuid) to service_role;
grant execute on function public.sign_off_artifact_approval(uuid, uuid) to service_role;

commit;
