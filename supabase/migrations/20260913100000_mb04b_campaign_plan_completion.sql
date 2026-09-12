-- MB04B - planning budget, retry-safe draft duplication, and exact campaign-brief review submission.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

create table public.marketing_campaign_plan_budgets (
  plan_version_id uuid primary key,
  organization_id uuid not null,
  planned_budget numeric not null check (planned_budget >= 0 and planned_budget::text !~ '^(NaN|-?Infinity)$'),
  currency_code text not null check (currency_code ~ '^[A-Z]{3}$'),
  created_at timestamptz not null default now(),
  foreign key (plan_version_id, organization_id) references public.marketing_campaign_plan_versions(id, organization_id) on delete cascade
);

create table public.marketing_campaign_plan_duplicate_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  actor_id uuid not null references auth.users(id) on delete restrict,
  idempotency_key uuid not null,
  payload_checksum text not null check (payload_checksum ~ '^[a-f0-9]{64}$'),
  source_plan_version_id uuid not null,
  created_plan_version_id uuid not null,
  created_at timestamptz not null default now(),
  foreign key (source_plan_version_id, organization_id) references public.marketing_campaign_plan_versions(id, organization_id) on delete cascade,
  foreign key (created_plan_version_id, organization_id) references public.marketing_campaign_plan_versions(id, organization_id) on delete cascade,
  unique (organization_id, actor_id, idempotency_key)
);

create table public.marketing_campaign_plan_review_submissions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  campaign_id uuid not null,
  plan_version_id uuid not null,
  artifact_id uuid not null,
  artifact_version_id uuid not null,
  artifact_version_number integer not null check (artifact_version_number > 0),
  approval_request_id uuid not null,
  submitted_by uuid not null references auth.users(id) on delete restrict,
  idempotency_key uuid not null,
  payload_checksum text not null check (payload_checksum ~ '^[a-f0-9]{64}$'),
  submitted_at timestamptz not null default now(),
  foreign key (campaign_id, organization_id) references public.marketing_campaigns(id, organization_id) on delete cascade,
  foreign key (plan_version_id, organization_id) references public.marketing_campaign_plan_versions(id, organization_id) on delete restrict,
  foreign key (artifact_id, organization_id) references public.artifacts(id, organization_id) on delete restrict,
  foreign key (artifact_version_id, organization_id) references public.artifact_versions(id, organization_id) on delete restrict,
  foreign key (approval_request_id, organization_id) references public.artifact_approval_requests(id, organization_id) on delete restrict,
  unique (organization_id, submitted_by, idempotency_key),
  unique (organization_id, plan_version_id),
  unique (id, organization_id)
);

create index idx_marketing_campaign_plan_budgets_org on public.marketing_campaign_plan_budgets(organization_id, plan_version_id);
create index idx_marketing_campaign_plan_duplicate_source on public.marketing_campaign_plan_duplicate_requests(organization_id, source_plan_version_id);
create index idx_marketing_campaign_plan_review_campaign on public.marketing_campaign_plan_review_submissions(organization_id, campaign_id, submitted_at desc);
create index idx_marketing_campaign_plan_review_artifact_version on public.marketing_campaign_plan_review_submissions(organization_id, artifact_version_id);
create index idx_marketing_campaign_plan_review_request on public.marketing_campaign_plan_review_submissions(organization_id, approval_request_id);

create trigger trg_marketing_campaign_plan_budgets_immutable before update or delete on public.marketing_campaign_plan_budgets for each row execute function private.reject_immutable_artifact_history_change();
create trigger trg_marketing_campaign_plan_review_submissions_immutable before update or delete on public.marketing_campaign_plan_review_submissions for each row execute function private.reject_immutable_artifact_history_change();

alter table public.marketing_campaign_plan_budgets enable row level security;
alter table public.marketing_campaign_plan_duplicate_requests enable row level security;
alter table public.marketing_campaign_plan_review_submissions enable row level security;
create policy "Team can read campaign plan budgets" on public.marketing_campaign_plan_budgets for select to authenticated using (public.is_team_organization_member(organization_id));
create policy "Team can read campaign plan review submissions" on public.marketing_campaign_plan_review_submissions for select to authenticated using (public.is_team_organization_member(organization_id));
revoke all on public.marketing_campaign_plan_budgets, public.marketing_campaign_plan_duplicate_requests, public.marketing_campaign_plan_review_submissions from anon, authenticated, service_role;
grant select on public.marketing_campaign_plan_budgets, public.marketing_campaign_plan_review_submissions to authenticated;
grant select, insert on public.marketing_campaign_plan_budgets, public.marketing_campaign_plan_duplicate_requests, public.marketing_campaign_plan_review_submissions to service_role;

create or replace function public.save_marketing_campaign_plan_draft_with_budget(
  p_organization_id uuid, p_engagement_id uuid, p_campaign_id uuid, p_expected_latest_version_id uuid,
  p_title text, p_objective text, p_channels text[], p_starts_on date, p_ends_on date,
  p_audience text, p_landing_page_url text, p_planned_budget numeric, p_currency_code text,
  p_approved_message_version_id uuid, p_measurement_plan_version_id uuid,
  p_creative_requirements jsonb, p_change_summary text, p_source_plan_version_id uuid, p_actor_id uuid
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_saved jsonb; v_version_id uuid; v_membership record;
begin
  select role,department_id into v_membership from public.organization_memberships where organization_id=p_organization_id and user_id=p_actor_id and member_kind='team' and status='active';
  if not found or not (coalesce(v_membership.role in ('system_owner','operations_admin','executive'),false) or coalesce(v_membership.department_id='marketing',false)) then raise exception 'Marketing department access required'; end if;
  if (p_planned_budget is null) <> (nullif(trim(coalesce(p_currency_code, '')), '') is null) then
    raise exception 'Planning budget and currency must be provided together';
  end if;
  if p_planned_budget is not null and (p_planned_budget < 0 or p_planned_budget::text ~ '^(NaN|-?Infinity)$') then
    raise exception 'Planning budget must be a non-negative finite number';
  end if;
  if p_currency_code is not null and trim(p_currency_code) !~ '^[A-Z]{3}$' then
    raise exception 'Currency must use a three-letter uppercase code';
  end if;
  select public.save_marketing_campaign_plan_draft(
    p_organization_id,p_engagement_id,p_campaign_id,p_expected_latest_version_id,
    p_title,p_objective,p_channels,p_starts_on,p_ends_on,p_audience,p_landing_page_url,
    p_approved_message_version_id,p_measurement_plan_version_id,p_creative_requirements,
    p_change_summary,p_source_plan_version_id,p_actor_id) into v_saved;
  v_version_id := (v_saved->>'id')::uuid;
  if p_planned_budget is not null then
    insert into public.marketing_campaign_plan_budgets(plan_version_id,organization_id,planned_budget,currency_code)
    values(v_version_id,p_organization_id,p_planned_budget,trim(p_currency_code));
  end if;
  return v_saved || jsonb_build_object('planned_budget',p_planned_budget,'currency_code',case when p_planned_budget is null then null else trim(p_currency_code) end);
end;
$$;

create or replace function public.duplicate_marketing_campaign_plan_draft(
  p_organization_id uuid, p_engagement_id uuid, p_campaign_id uuid, p_source_plan_version_id uuid,
  p_expected_latest_version_id uuid, p_idempotency_key uuid, p_payload_checksum text, p_actor_id uuid
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_source public.marketing_campaign_plan_versions%rowtype; v_budget public.marketing_campaign_plan_budgets%rowtype;
  v_replay public.marketing_campaign_plan_duplicate_requests%rowtype; v_result jsonb; v_requirements jsonb;
  v_membership record;
begin
  if p_organization_id is null or p_engagement_id is null or p_campaign_id is null or p_source_plan_version_id is null or p_actor_id is null or p_idempotency_key is null then raise exception 'Duplicate context is required'; end if;
  if p_payload_checksum !~ '^[a-f0-9]{64}$' then raise exception 'Valid payload checksum required'; end if;
  select role,department_id into v_membership from public.organization_memberships where organization_id=p_organization_id and user_id=p_actor_id and member_kind='team' and status='active';
  if not found or not (coalesce(v_membership.role in ('system_owner','operations_admin','executive'),false) or coalesce(v_membership.department_id='marketing',false)) then raise exception 'Marketing department access required'; end if;
  if not exists(select 1 from public.organizations where id=p_organization_id and status='active') then raise exception 'Active organization required'; end if;
  if not exists(select 1 from public.engagements e join public.engagement_services es on es.engagement_id=e.id and es.organization_id=e.organization_id join public.service_catalog sc on sc.id=es.service_id where e.id=p_engagement_id and e.organization_id=p_organization_id and es.status='active' and sc.department_id='marketing' and sc.is_active) then raise exception 'Active Marketing engagement required'; end if;
  if not exists(select 1 from public.marketing_campaigns where id=p_campaign_id and organization_id=p_organization_id and engagement_id=p_engagement_id) then raise exception 'Campaign does not match this Marketing engagement'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_organization_id::text||':'||p_actor_id::text||':duplicate_campaign_plan:'||p_idempotency_key::text,0));
  select * into v_replay from public.marketing_campaign_plan_duplicate_requests where organization_id=p_organization_id and actor_id=p_actor_id and idempotency_key=p_idempotency_key;
  if found then
    if v_replay.payload_checksum<>p_payload_checksum then raise exception 'Idempotency key was already used with a different duplicate payload' using errcode='23505'; end if;
    select to_jsonb(plan)||jsonb_build_object('planned_budget',budget.planned_budget,'currency_code',budget.currency_code,'replayed',true) into v_result
    from public.marketing_campaign_plan_versions plan left join public.marketing_campaign_plan_budgets budget on budget.plan_version_id=plan.id and budget.organization_id=plan.organization_id
    where plan.id=v_replay.created_plan_version_id and plan.organization_id=p_organization_id;
    return v_result;
  end if;
  select * into v_source from public.marketing_campaign_plan_versions where id=p_source_plan_version_id and organization_id=p_organization_id and campaign_id=p_campaign_id and engagement_id=p_engagement_id;
  if not found then raise exception 'Source plan version is unavailable in this campaign'; end if;
  select * into v_budget from public.marketing_campaign_plan_budgets where plan_version_id=v_source.id and organization_id=p_organization_id;
  select coalesce(jsonb_agg(jsonb_build_object('format',format,'intended_placement',intended_placement,'message_version_id',message_version_id,'due_date',due_date) order by position),'[]'::jsonb) into v_requirements from public.marketing_campaign_plan_creative_requirements where plan_version_id=v_source.id and organization_id=p_organization_id;
  select public.save_marketing_campaign_plan_draft_with_budget(p_organization_id,p_engagement_id,p_campaign_id,p_expected_latest_version_id,v_source.title,v_source.objective,v_source.channels,v_source.starts_on,v_source.ends_on,v_source.audience,v_source.landing_page_url,v_budget.planned_budget,v_budget.currency_code,v_source.approved_message_version_id,v_source.measurement_plan_version_id,v_requirements,'Duplicated from plan version '||v_source.version_number,p_source_plan_version_id,p_actor_id) into v_result;
  insert into public.marketing_campaign_plan_duplicate_requests(organization_id,actor_id,idempotency_key,payload_checksum,source_plan_version_id,created_plan_version_id)
  values(p_organization_id,p_actor_id,p_idempotency_key,p_payload_checksum,p_source_plan_version_id,(v_result->>'id')::uuid);
  return v_result||jsonb_build_object('replayed',false);
end;
$$;

create or replace function public.submit_marketing_campaign_plan_review(
  p_organization_id uuid, p_engagement_id uuid, p_campaign_id uuid, p_plan_version_id uuid,
  p_expected_latest_plan_version_id uuid, p_expected_latest_brief_version_id uuid,
  p_approval_policy text, p_required_approver_ids uuid[], p_idempotency_key uuid,
  p_payload_checksum text, p_actor_id uuid
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_plan public.marketing_campaign_plan_versions%rowtype; v_budget public.marketing_campaign_plan_budgets%rowtype;
  v_membership record; v_latest_plan_id uuid; v_artifact_id uuid; v_latest_brief_id uuid;
  v_requirements jsonb; v_content jsonb; v_content_checksum text; v_brief_payload_checksum text;
  v_version jsonb; v_request jsonb; v_submission public.marketing_campaign_plan_review_submissions%rowtype;
begin
  if p_organization_id is null or p_engagement_id is null or p_campaign_id is null or p_plan_version_id is null or p_actor_id is null or p_idempotency_key is null then raise exception 'Review submission context is required'; end if;
  if p_payload_checksum !~ '^[a-f0-9]{64}$' then raise exception 'Valid payload checksum required'; end if;
  select role,department_id into v_membership from public.organization_memberships where organization_id=p_organization_id and user_id=p_actor_id and member_kind='team' and status='active';
  if not found or not (coalesce(v_membership.role in ('system_owner','operations_admin','executive'),false) or coalesce(v_membership.department_id='marketing',false)) then raise exception 'Marketing department access required'; end if;
  if not exists(select 1 from public.organizations where id=p_organization_id and status='active') then raise exception 'Active organization required'; end if;
  if not exists(select 1 from public.engagements e join public.engagement_services es on es.engagement_id=e.id and es.organization_id=e.organization_id join public.service_catalog sc on sc.id=es.service_id where e.id=p_engagement_id and e.organization_id=p_organization_id and es.status='active' and sc.department_id='marketing' and sc.is_active) then raise exception 'Active Marketing engagement required'; end if;
  if not exists(select 1 from public.marketing_campaigns where id=p_campaign_id and organization_id=p_organization_id and engagement_id=p_engagement_id) then raise exception 'Campaign does not match this Marketing engagement'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_organization_id::text||':'||p_actor_id::text||':submit_campaign_plan:'||p_idempotency_key::text,0));
  select * into v_submission from public.marketing_campaign_plan_review_submissions where organization_id=p_organization_id and submitted_by=p_actor_id and idempotency_key=p_idempotency_key;
  if found then
    if v_submission.payload_checksum<>p_payload_checksum then raise exception 'Idempotency key was already used with a different review payload' using errcode='23505'; end if;
    return to_jsonb(v_submission)||jsonb_build_object('replayed',true);
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_organization_id::text||':'||p_campaign_id::text||':campaign_plan',0));
  select id into v_latest_plan_id from public.marketing_campaign_plan_versions where organization_id=p_organization_id and campaign_id=p_campaign_id order by version_number desc limit 1;
  if v_latest_plan_id is distinct from p_expected_latest_plan_version_id or v_latest_plan_id is distinct from p_plan_version_id then raise exception 'Campaign plan changed since review was previewed; reload before submitting' using errcode='40001'; end if;
  select * into v_plan from public.marketing_campaign_plan_versions where id=p_plan_version_id and organization_id=p_organization_id and campaign_id=p_campaign_id and engagement_id=p_engagement_id;
  if not found then raise exception 'Exact campaign plan version is unavailable'; end if;
  if exists(select 1 from public.marketing_campaign_plan_review_submissions where organization_id=p_organization_id and plan_version_id=p_plan_version_id) then raise exception 'This exact plan version is already submitted for review'; end if;
  select * into v_budget from public.marketing_campaign_plan_budgets where plan_version_id=v_plan.id and organization_id=p_organization_id;
  select coalesce(jsonb_agg(jsonb_build_object('format',format,'intended_placement',intended_placement,'message_version_id',message_version_id,'due_date',due_date) order by position),'[]'::jsonb) into v_requirements from public.marketing_campaign_plan_creative_requirements where plan_version_id=v_plan.id and organization_id=p_organization_id;
  select artifact_id into v_artifact_id from public.marketing_campaign_artifacts where organization_id=p_organization_id and campaign_id=p_campaign_id and relation_type='campaign_brief';
  if v_artifact_id is not null then select id into v_latest_brief_id from public.artifact_versions where organization_id=p_organization_id and artifact_id=v_artifact_id order by version_number desc limit 1; end if;
  if v_latest_brief_id is distinct from p_expected_latest_brief_version_id then raise exception 'Campaign brief changed since review was previewed; reload before submitting' using errcode='40001'; end if;
  v_content:=jsonb_build_object('campaign_goal',v_plan.objective,'channels',to_jsonb(v_plan.channels),'market','','audience',v_plan.audience,'offer','','key_message','','starts_on',coalesce(v_plan.starts_on::text,''),'ends_on',coalesce(v_plan.ends_on::text,''),'measurement_target','','measurement_value',null,'measurement_unit','','measurement_evidence','','deliverables','[]'::jsonb,'existing_asset_version_ids',to_jsonb(array_remove(array[v_plan.approved_message_version_id,v_plan.measurement_plan_version_id],null)),'campaign_plan_source',jsonb_build_object('plan_version_id',v_plan.id,'plan_version_number',v_plan.version_number,'planning_budget',v_budget.planned_budget,'currency_code',v_budget.currency_code,'landing_page_url',v_plan.landing_page_url,'creative_requirements',v_requirements));
  v_content_checksum:=encode(extensions.digest(convert_to(v_content::text,'UTF8'),'sha256'),'hex');
  v_brief_payload_checksum:=encode(extensions.digest(convert_to(jsonb_build_object('organization_id',p_organization_id,'campaign_id',p_campaign_id,'plan_version_id',p_plan_version_id,'content',v_content,'actor_id',p_actor_id)::text,'UTF8'),'sha256'),'hex');
  select public.save_marketing_campaign_brief(p_organization_id,p_engagement_id,p_campaign_id,v_artifact_id,p_expected_latest_brief_version_id,v_plan.title,v_content,v_content_checksum,'Submitted from campaign plan version '||v_plan.version_number,false,p_idempotency_key,v_brief_payload_checksum,p_actor_id) into v_version;
  select public.create_marketing_campaign_brief_approval_request((v_version->>'id')::uuid,p_approval_policy,p_required_approver_ids,p_actor_id) into v_request;
  insert into public.marketing_campaign_plan_review_submissions(organization_id,campaign_id,plan_version_id,artifact_id,artifact_version_id,artifact_version_number,approval_request_id,submitted_by,idempotency_key,payload_checksum)
  values(p_organization_id,p_campaign_id,p_plan_version_id,(v_version->>'artifact_id')::uuid,(v_version->>'id')::uuid,(v_version->>'version_number')::integer,(v_request->>'id')::uuid,p_actor_id,p_idempotency_key,p_payload_checksum) returning * into v_submission;
  return to_jsonb(v_submission)||jsonb_build_object('replayed',false);
end;
$$;

revoke all on function public.save_marketing_campaign_plan_draft_with_budget(uuid,uuid,uuid,uuid,text,text,text[],date,date,text,text,numeric,text,uuid,uuid,jsonb,text,uuid,uuid) from public,anon,authenticated;
grant execute on function public.save_marketing_campaign_plan_draft_with_budget(uuid,uuid,uuid,uuid,text,text,text[],date,date,text,text,numeric,text,uuid,uuid,jsonb,text,uuid,uuid) to service_role;
revoke all on function public.duplicate_marketing_campaign_plan_draft(uuid,uuid,uuid,uuid,uuid,uuid,text,uuid) from public,anon,authenticated;
grant execute on function public.duplicate_marketing_campaign_plan_draft(uuid,uuid,uuid,uuid,uuid,uuid,text,uuid) to service_role;
revoke all on function public.submit_marketing_campaign_plan_review(uuid,uuid,uuid,uuid,uuid,uuid,text,uuid[],uuid,text,uuid) from public,anon,authenticated;
grant execute on function public.submit_marketing_campaign_plan_review(uuid,uuid,uuid,uuid,uuid,uuid,text,uuid[],uuid,text,uuid) to service_role;

comment on table public.marketing_campaign_plan_budgets is 'Optional exact-version planning estimates only; never spend authority.';
comment on table public.marketing_campaign_plan_review_submissions is 'Exact immutable plan to canonical campaign_brief artifact-version and approval-request history; never approval or release.';
commit;
