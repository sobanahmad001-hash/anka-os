-- N3: discussion-linked change proposals; the canonical task is the only work record.
begin;
set local lock_timeout='5s';
set local statement_timeout='120s';

create table public.project_task_change_proposals (
  id uuid primary key,
  organization_id uuid not null,
  project_id uuid not null references public.projects(id) on delete restrict,
  task_id uuid not null references public.tasks(id) on delete restrict,
  source_comment_id uuid references public.comments(id) on delete restrict,
  supersedes_id uuid references public.project_task_change_proposals(id) on delete restrict,
  expected_row_version bigint not null check (expected_row_version>0),
  before_status text not null,
  proposed_status text not null,
  rationale text not null check (length(trim(rationale)) between 1 and 4000),
  impact text not null check (length(trim(impact)) between 1 and 4000),
  cost_note text not null check (length(trim(cost_note)) between 1 and 2000),
  proposed_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  status text not null default 'pending' check (status in ('pending','superseded','rejected','applied','approved_failed')),
  decided_by uuid references auth.users(id),
  decided_at timestamptz,
  failure_reason text,
  applied_row_version bigint,
  constraint n3_proposal_decision_shape check (
    (status in ('pending','superseded') and decided_by is null and decided_at is null and failure_reason is null and applied_row_version is null)
    or (status='rejected' and decided_by is not null and decided_at is not null and failure_reason is null and applied_row_version is null)
    or (status='applied' and decided_by is not null and decided_at is not null and failure_reason is null and applied_row_version is not null)
    or (status='approved_failed' and decided_by is not null and decided_at is not null and failure_reason is not null and applied_row_version is null)
  )
);
create index n3_project_proposals_page on public.project_task_change_proposals
  (organization_id,project_id,created_at desc,id desc);
create unique index n3_project_proposals_single_revision on public.project_task_change_proposals(supersedes_id)
  where supersedes_id is not null;
alter table public.project_task_change_proposals enable row level security;
create policy n3_team_read_project_task_proposals on public.project_task_change_proposals for select to authenticated
  using (public.is_team_organization_member(organization_id));
revoke all on public.project_task_change_proposals from public,anon,authenticated;
grant select on public.project_task_change_proposals to authenticated;
grant all on public.project_task_change_proposals to service_role;

create function public.create_project_task_change_proposal(
  p_organization_id uuid,p_project_id uuid,p_proposal_id uuid,p_task_id uuid,
  p_expected_row_version bigint,p_before_status text,p_proposed_status text,
  p_rationale text,p_impact text,p_cost_note text,
  p_source_comment_id uuid default null,p_supersedes_id uuid default null
) returns public.project_task_change_proposals language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); task public.tasks%rowtype; old public.project_task_change_proposals%rowtype;
  created public.project_task_change_proposals%rowtype;
begin
  perform private.n3_require_project_member(p_organization_id,p_project_id);
  if p_proposal_id is null or p_task_id is null or p_expected_row_version is null or p_expected_row_version<1
    or p_proposed_status is null or p_proposed_status not in ('backlog','ready','in_progress','blocked','ready_for_review','changes_required','done','cancelled')
    or length(trim(coalesce(p_rationale,''))) not between 1 and 4000
    or length(trim(coalesce(p_impact,''))) not between 1 and 4000
    or length(trim(coalesce(p_cost_note,''))) not between 1 and 2000 then
    raise exception 'Complete bounded task change proposal required.' using errcode='22023'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('n3-proposal:'||p_proposal_id::text,0));
  select * into created from public.project_task_change_proposals where id=p_proposal_id;
  if found then
    if created.organization_id is distinct from p_organization_id or created.project_id is distinct from p_project_id
      or created.task_id is distinct from p_task_id or created.expected_row_version is distinct from p_expected_row_version
      or created.before_status is distinct from p_before_status or created.proposed_status is distinct from p_proposed_status
      or created.rationale is distinct from trim(p_rationale) or created.impact is distinct from trim(p_impact)
      or created.cost_note is distinct from trim(p_cost_note) or created.source_comment_id is distinct from p_source_comment_id
      or created.supersedes_id is distinct from p_supersedes_id or created.proposed_by is distinct from actor then
      raise exception 'Proposal ID already used with different inputs.' using errcode='23505'; end if;
    return created;
  end if;
  if p_supersedes_id is not null then
    select * into old from public.project_task_change_proposals where id=p_supersedes_id
      and organization_id=p_organization_id and project_id=p_project_id and task_id=p_task_id
      and proposed_by=actor and status='pending' for update;
    if not found then raise exception 'Only your pending same-task proposal can be revised.' using errcode='42501'; end if;
  end if;
  select * into task from public.tasks where id=p_task_id and organization_id=p_organization_id
    and project_id=p_project_id and archived_at is null for share;
  if not found then raise exception 'Same-project active task required.' using errcode='42501'; end if;
  if task.row_version is distinct from p_expected_row_version or task.status is distinct from p_before_status
    or task.status=p_proposed_status then
    raise exception 'Task changed or proposal has no effect; reload before proposing.' using errcode='40001'; end if;
  if p_source_comment_id is not null and not exists (
    select 1 from public.comments c where c.id=p_source_comment_id and c.organization_id=p_organization_id
      and c.project_id=p_project_id and c.entity_type='project' and c.entity_id=p_project_id
      and c.visibility='internal_only'
  ) then raise exception 'Source must be a same-project discussion message.' using errcode='42501'; end if;
  if p_supersedes_id is not null then
    update public.project_task_change_proposals set status='superseded' where id=old.id;
  end if;
  insert into public.project_task_change_proposals(id,organization_id,project_id,task_id,source_comment_id,
    supersedes_id,expected_row_version,before_status,proposed_status,rationale,impact,cost_note,proposed_by)
  values(p_proposal_id,p_organization_id,p_project_id,p_task_id,p_source_comment_id,p_supersedes_id,
    p_expected_row_version,p_before_status,p_proposed_status,trim(p_rationale),trim(p_impact),trim(p_cost_note),actor)
  returning * into created;
  return created;
end; $$;

-- Called only by the existing authenticated work-items edge through its service-role client.
-- The P5 command rechecks N1 action authority and the exact task row version at execution.
create function public.decide_project_task_change_proposal(
  p_organization_id uuid,p_project_id uuid,p_proposal_id uuid,p_actor_id uuid,p_decision text
) returns public.project_task_change_proposals language plpgsql security definer set search_path='' as $$
declare proposal public.project_task_change_proposals%rowtype; task public.tasks%rowtype;
  changed public.tasks%rowtype; reason text;
begin
  if p_actor_id is null or p_decision is null or p_decision not in ('approve','reject') then
    raise exception 'Valid human decision required.' using errcode='22023'; end if;
  perform 1 from public.projects p join public.organizations o on o.id=p.organization_id
    join public.organization_memberships m on m.organization_id=p.organization_id and m.user_id=p_actor_id
    where p.id=p_project_id and p.organization_id=p_organization_id and p.archived_at is null
      and o.status='active' and m.member_kind='team' and m.status='active' for share of p,o,m;
  if not found then raise exception 'Active same-project team authority required.' using errcode='42501'; end if;
  select * into proposal from public.project_task_change_proposals where id=p_proposal_id
    and organization_id=p_organization_id and project_id=p_project_id for update;
  if not found then raise exception 'Proposal unavailable.' using errcode='42501'; end if;
  if proposal.status<>'pending' then
    if (proposal.status='rejected' and p_decision='reject')
      or (proposal.status in ('applied','approved_failed') and p_decision='approve') then
      return proposal;
    end if;
    raise exception 'Proposal is no longer pending for this decision.' using errcode='23505';
  end if;
  select * into task from public.tasks where id=proposal.task_id and organization_id=p_organization_id
    and project_id=p_project_id and archived_at is null for update;
  if not found then raise exception 'Target task unavailable.' using errcode='42501'; end if;
  if (private.n1c_can_assign_department(p_organization_id,p_project_id,task.department_id,p_actor_id)
    or task.user_id=p_actor_id or task.assigned_to=p_actor_id) is not true then
    raise exception 'Scoped task action authority required.' using errcode='42501'; end if;
  if p_decision='reject' then
    update public.project_task_change_proposals set status='rejected',decided_by=p_actor_id,decided_at=now()
      where id=proposal.id returning * into proposal;
    return proposal;
  end if;
  if task.row_version is distinct from proposal.expected_row_version or task.status is distinct from proposal.before_status then
    reason:='Target task changed since this proposal was created.';
  else
    begin
      perform private.n1c_set_actor(p_actor_id);
      select * into changed from public.transition_p5_project_task(p_organization_id,proposal.task_id,
        proposal.expected_row_version,proposal.proposed_status,task.completion_evidence,p_actor_id);
    exception when others then
      reason:=left(SQLERRM,500);
    end;
  end if;
  if reason is not null then
    update public.project_task_change_proposals set status='approved_failed',decided_by=p_actor_id,
      decided_at=now(),failure_reason=reason where id=proposal.id returning * into proposal;
  else
    update public.project_task_change_proposals set status='applied',decided_by=p_actor_id,
      decided_at=now(),applied_row_version=changed.row_version where id=proposal.id returning * into proposal;
  end if;
  return proposal;
end; $$;
revoke all on function public.create_project_task_change_proposal(uuid,uuid,uuid,uuid,bigint,text,text,text,text,text,uuid,uuid),
  public.decide_project_task_change_proposal(uuid,uuid,uuid,uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.create_project_task_change_proposal(uuid,uuid,uuid,uuid,bigint,text,text,text,text,text,uuid,uuid) to authenticated;
grant execute on function public.decide_project_task_change_proposal(uuid,uuid,uuid,uuid,text) to service_role;
commit;
