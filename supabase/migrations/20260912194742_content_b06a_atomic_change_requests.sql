-- Content B06a - atomic, replay-safe exact-version change-request comments.
begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

alter table public.artifact_version_comments
  add column approval_request_id uuid,
  add column request_change_key uuid;

alter table public.artifact_version_comments
  add constraint artifact_version_comments_approval_request_fk
    foreign key (approval_request_id, organization_id)
      references public.artifact_approval_requests(id, organization_id) on delete restrict,
  add constraint artifact_version_comments_request_change_metadata_check check (
    (approval_request_id is null and request_change_key is null)
    or (
      approval_request_id is not null
      and request_change_key is not null
      and artifact_version_id is not null
      and design_direction_version_id is null
      and content_request_id is null
    )
  );

create unique index artifact_version_comments_request_change_replay_key
  on public.artifact_version_comments(approval_request_id, author_id, request_change_key)
  where approval_request_id is not null;

create or replace function private.enforce_artifact_version_comment_append_only()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Proofing comments are append-only.' using errcode = '55000';
  end if;

  if new.id is distinct from old.id
    or new.organization_id is distinct from old.organization_id
    or new.artifact_version_id is distinct from old.artifact_version_id
    or new.design_direction_version_id is distinct from old.design_direction_version_id
    or new.content_request_id is distinct from old.content_request_id
    or new.approval_request_id is distinct from old.approval_request_id
    or new.request_change_key is distinct from old.request_change_key
    or new.author_id is distinct from old.author_id
    or new.body is distinct from old.body
    or new.comment_position is distinct from old.comment_position
    or new.created_at is distinct from old.created_at then
    raise exception 'Proofing comment content, author, target, request metadata, and creation time are immutable.'
      using errcode = '55000';
  end if;

  if old.resolved or not new.resolved
    or new.resolved_by is null or new.resolved_at is null then
    raise exception 'Only a one-way resolution with resolver and time is permitted.'
      using errcode = '55000';
  end if;

  return new;
end;
$$;

create or replace function public.request_artifact_approval_changes(
  p_request_id uuid,
  p_actor_id uuid,
  p_comment text,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  request_row public.artifact_approval_requests%rowtype;
  signoff_row public.artifact_approval_signoffs%rowtype;
  existing_comment public.artifact_version_comments%rowtype;
  saved_comment public.artifact_version_comments%rowtype;
  normalized_comment text;
begin
  if p_request_id is null or p_actor_id is null or p_idempotency_key is null then
    raise exception 'Approval request, actor, and idempotency key are required';
  end if;

  normalized_comment := pg_catalog.btrim(coalesce(p_comment, ''));
  if normalized_comment = '' then
    raise exception 'A change request comment is required';
  end if;
  if pg_catalog.length(normalized_comment) > 8000 then
    raise exception 'A change request comment must be 8000 characters or fewer';
  end if;

  -- Match the canonical P7 approval lock order: request, current tenant/member,
  -- then the actor's exact signoff. These locks remain held through the insert.
  select * into request_row
  from public.artifact_approval_requests
  where id = p_request_id
  for update;
  if not found then
    raise exception 'Approval request is unavailable' using errcode = 'P0002';
  end if;

  perform 1
  from public.organizations
  where id = request_row.organization_id and status = 'active'
  for share;
  if not found then
    raise exception 'Active organization required' using errcode = '42501';
  end if;

  perform 1
  from public.organization_memberships
  where organization_id = request_row.organization_id
    and user_id = p_actor_id
    and member_kind = 'team'
    and status = 'active'
  for share;
  if not found then
    raise exception 'Active team membership required' using errcode = '42501';
  end if;

  select * into signoff_row
  from public.artifact_approval_signoffs
  where organization_id = request_row.organization_id
    and request_id = request_row.id
    and required_approver_id = p_actor_id
  for update;
  if not found then
    raise exception 'Only a named approver can request changes' using errcode = '42501';
  end if;

  select * into existing_comment
  from public.artifact_version_comments
  where approval_request_id = request_row.id
    and author_id = p_actor_id
    and request_change_key = p_idempotency_key
  for share;
  if found then
    if existing_comment.body is distinct from normalized_comment
      or existing_comment.artifact_version_id is distinct from request_row.artifact_version_id then
      raise exception 'Change request idempotency key was reused with different intent'
        using errcode = '23505';
    end if;
    return to_jsonb(existing_comment) || jsonb_build_object('idempotent_replay', true);
  end if;

  if request_row.status <> 'pending' then
    raise exception 'Only a pending approval request can receive requested changes'
      using errcode = '55000';
  end if;
  if signoff_row.signed_off_at is not null then
    raise exception 'Only an unsigned named approver can request changes'
      using errcode = '42501';
  end if;

  insert into public.artifact_version_comments (
    organization_id,
    artifact_version_id,
    author_id,
    body,
    comment_position,
    approval_request_id,
    request_change_key
  ) values (
    request_row.organization_id,
    request_row.artifact_version_id,
    p_actor_id,
    normalized_comment,
    null,
    request_row.id,
    p_idempotency_key
  ) returning * into saved_comment;

  return to_jsonb(saved_comment) || jsonb_build_object('idempotent_replay', false);
end;
$$;

revoke all on function public.request_artifact_approval_changes(uuid, uuid, text, uuid)
  from public, anon, authenticated;
grant execute on function public.request_artifact_approval_changes(uuid, uuid, text, uuid)
  to service_role;

comment on function public.request_artifact_approval_changes(uuid, uuid, text, uuid) is
  'Atomically records or exactly replays an immutable proofing comment for a current pending artifact approval request and unsigned named approver.';
comment on column public.artifact_version_comments.approval_request_id is
  'Optional factual origin for a proofing comment created through an exact artifact approval request; not a workflow decision state.';
comment on column public.artifact_version_comments.request_change_key is
  'Client-supplied exact-intent replay key for request-originated proofing comments.';

commit;
