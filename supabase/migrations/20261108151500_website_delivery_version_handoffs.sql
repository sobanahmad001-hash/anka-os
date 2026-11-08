begin;

create table private.website_delivery_version_handoffs (
  marketing_step_id uuid primary key references public.ai_execution_configured_steps(id),
  review_event_id uuid not null references public.ai_execution_step_action_events(id),
  page_id uuid not null references public.project_website_pages(id),
  architecture_version_id uuid not null references public.artifact_versions(id),
  copy_approval_id uuid not null references public.artifact_approvals(id),
  confirmed_by uuid not null references auth.users(id),
  confirmed_at timestamptz not null default now()
);
alter table private.website_delivery_version_handoffs enable row level security;
revoke all on private.website_delivery_version_handoffs from public, anon, authenticated, service_role;
create trigger protect_website_delivery_version_handoffs before update or delete
  on private.website_delivery_version_handoffs for each row execute function private.reject_pipeline_template_mutation();

create function public.confirm_website_delivery_version(
  p_organization_id uuid, p_project_id uuid, p_marketing_step_id uuid, p_page_id uuid,
  p_architecture_version_id uuid, p_copy_version_id uuid, p_copy_approval_id uuid
) returns void language plpgsql security definer set search_path='' as $$
declare
  decision uuid;
  source jsonb;
  saved private.website_delivery_version_handoffs;
begin
  perform private.n3_require_project_member(p_organization_id,p_project_id);
  perform 1 from public.project_members where project_id=p_project_id and user_id=auth.uid() for share;
  if not found then raise exception 'Project reviewer required' using errcode='42501'; end if;
  if not (private.n6_project_configuration_authorized(p_organization_id,p_project_id,auth.uid())
    or private.n1e_department_head(p_organization_id,p_project_id,'development',auth.uid())) then
    raise exception 'Current delivery reviewer authority required' using errcode='42501';
  end if;
  source := private.website_approved_source(p_organization_id,p_project_id,p_architecture_version_id);
  select ev.id into strict decision
  from public.ai_execution_configured_steps dest
  join public.project_pipeline_activations act on act.id=dest.project_activation_id
  join public.project_pipeline_configurations cfg on cfg.id=act.configuration_id and cfg.project_id=p_project_id
  join private.website_page_marketing_publications pub on pub.execution_publication_id=cfg.definition_publication_id
  join public.ai_execution_configured_steps gate on gate.job_id=dest.job_id
    and gate.step_key='website_page_review' and gate.project_activation_id=act.id
  join public.ai_execution_step_action_events ev on ev.configured_step_id=gate.id
    and ev.action='approve' and ev.actor_id=auth.uid()
  join public.ai_execution_step_progress progress on progress.configured_step_id=gate.id
    and progress.status='completed' and progress.completed_by=ev.actor_id
  join public.project_website_pages page on page.id=p_page_id and page.project_id=p_project_id
    and page.organization_id=p_organization_id and page.engagement_id=cfg.engagement_id
  join public.artifact_versions copy on copy.id=p_copy_version_id and copy.organization_id=page.organization_id
  join public.artifacts root on root.id=copy.artifact_id and root.engagement_id=page.engagement_id and root.brand_id=page.brand_id
  join public.artifact_approvals approval on approval.id=p_copy_approval_id and approval.artifact_version_id=copy.id
    and approval.engagement_id=page.engagement_id and approval.decision='approved'
  where dest.id=p_marketing_step_id and dest.organization_id=p_organization_id and dest.step_key='marketing_page_seo'
    and dest.definition_step->>'department_id'='marketing'
    and dest.definition_step->'depends_on' ? gate.step_key
    and page.architecture_artifact_id=(source->'reference'->>'artifact_id')::uuid
    and copy.content->>'source_architecture_version_id'=p_architecture_version_id::text
    and approval.id=(select a.id from public.artifact_approvals a where a.artifact_version_id=copy.id
      and a.organization_id=p_organization_id order by a.approved_at desc,a.id desc limit 1)
    and coalesce((select request.status from public.artifact_approval_requests request
      where request.artifact_version_id=copy.id and request.organization_id=p_organization_id
      order by request.created_at desc,request.id desc limit 1),'completed')='completed'
    and copy.content->>'output_type'='website_page_copy' and copy.content->>'target_page_key'=page.page_key
    and exists (select 1 from jsonb_array_elements(source->'pages') p
      where p->>'page_key'=page.page_key and p->>'path'=copy.content->>'target_page_path')
  for share of ev,progress,approval,copy,page;
  insert into private.website_delivery_version_handoffs(marketing_step_id,review_event_id,page_id,architecture_version_id,copy_approval_id,confirmed_by)
    values(p_marketing_step_id,decision,p_page_id,p_architecture_version_id,p_copy_approval_id,auth.uid())
    on conflict(marketing_step_id) do nothing;
  select * into strict saved from private.website_delivery_version_handoffs where marketing_step_id=p_marketing_step_id;
  if (saved.review_event_id,saved.page_id,saved.architecture_version_id,saved.copy_approval_id)
    is distinct from (decision,p_page_id,p_architecture_version_id,p_copy_approval_id) then
    raise exception 'This receiving step already has a confirmed version' using errcode='23505';
  end if;
exception when no_data_found or too_many_rows then
  raise exception 'Exact completed review, page and approved copy required' using errcode='42501';
end; $$;

create function public.read_website_delivery_version(p_organization_id uuid,p_project_id uuid,p_marketing_step_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare receipt jsonb;
begin
  perform private.n3_require_project_member(p_organization_id,p_project_id);
  perform 1 from public.project_members pm join public.organization_memberships om on om.user_id=pm.user_id
    where pm.project_id=p_project_id and pm.user_id=auth.uid() and om.organization_id=p_organization_id
      and om.status='active' and om.member_kind='team' and om.department_id='marketing' for share of pm,om;
  if not found then raise exception 'Marketing project access required' using errcode='42501'; end if;
  select jsonb_build_object('review_event_id',ev.id,'reviewed_at',ev.occurred_at,'marketing_step_id',h.marketing_step_id,
    'page_id',page.id,'page_key',page.page_key,'architecture_version_id',h.architecture_version_id,
    'copy_version_id',approval.artifact_version_id,'copy_approval_id',approval.id)
    into receipt from private.website_delivery_version_handoffs h
    join public.ai_execution_step_action_events ev on ev.id=h.review_event_id
    join public.project_website_pages page on page.id=h.page_id
    join public.artifact_approvals approval on approval.id=h.copy_approval_id
    where page.project_id=p_project_id and page.organization_id=p_organization_id and h.marketing_step_id=p_marketing_step_id;
  return receipt;
end; $$;
revoke all on function public.confirm_website_delivery_version(uuid,uuid,uuid,uuid,uuid,uuid,uuid),
  public.read_website_delivery_version(uuid,uuid,uuid) from public,anon,service_role;
grant execute on function public.confirm_website_delivery_version(uuid,uuid,uuid,uuid,uuid,uuid,uuid),
  public.read_website_delivery_version(uuid,uuid,uuid) to authenticated;
commit;
