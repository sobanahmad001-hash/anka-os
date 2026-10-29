-- Production targets are independently bound; staging and public reference URLs grant no release authority.
begin;
set local lock_timeout='5s';set local statement_timeout='30s';
do $$begin
 if (select md5(prosrc) from pg_proc where oid='private.website_block_actor(uuid,uuid,uuid,uuid,boolean)'::regprocedure)<>'8f5dc822d22c66f39116226f85f935aa'
 or (select md5(prosrc) from pg_proc where oid='private.website_qa_context(uuid,uuid,uuid,uuid,uuid,uuid)'::regprocedure)<>'61ee89b349b231d80ce174317aa82741'
 then raise exception 'Reviewed production publication prerequisites differ';end if;
end$$;

create table private.website_publication_targets(
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null,project_id uuid not null,engagement_id uuid not null,
 connection_id uuid not null references public.integration_connections(id),connection_revision timestamptz not null,
 site_id uuid not null,base_url text not null check(length(base_url)<=500 and base_url~'^https://'),
 version_number integer not null check(version_number>0),
 identity jsonb not null check(jsonb_typeof(identity)='object' and octet_length(identity::text)<=2000),
 request_id uuid not null,request_sha256 text not null check(request_sha256~'^[a-f0-9]{64}$'),
 created_by uuid not null references auth.users(id),created_at timestamptz not null default clock_timestamp(),
 unique(created_by,request_id),unique(organization_id,project_id,connection_id,version_number),
 foreign key(engagement_id,project_id,organization_id) references public.engagements(id,project_id,organization_id)
);
create index website_publication_targets_scope on private.website_publication_targets(engagement_id,project_id,organization_id,created_at desc);
create index website_publication_targets_connection on private.website_publication_targets(connection_id,version_number desc);
create index website_publication_targets_site on private.website_publication_targets(site_id,base_url);
alter table private.website_publication_targets enable row level security;
revoke all on private.website_publication_targets from public,anon,authenticated,service_role;
create trigger website_publication_target_immutable before update or delete on private.website_publication_targets for each row execute function private.website_native_immutable();

create function private.website_publication_actor(o uuid,p uuid,e uuid,a uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 perform private.website_block_actor(o,p,e,a,true);
 perform 1 from public.organization_memberships where organization_id=o and user_id=a and member_kind='team' and status='active' and role in ('system_owner','operations_admin') for share;
 if not found then raise exception 'Current organization owner or operations admin must review production publication' using errcode='42501';end if;
end$$;

create function public.get_website_publication_target(p_organization_id uuid,p_project_id uuid,p_engagement_id uuid,p_actor_id uuid,p_target_id uuid default null,p_connection_id uuid default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare t private.website_publication_targets;c jsonb;
begin
 perform private.website_publication_actor(p_organization_id,p_project_id,p_engagement_id,p_actor_id);
 if p_target_id is null then
  c:=private.website_staging_connection(p_organization_id,p_project_id,p_engagement_id,p_actor_id,p_connection_id);
  return jsonb_build_object('connection',c);
 end if;
 select * into t from private.website_publication_targets where id=p_target_id and organization_id=p_organization_id and project_id=p_project_id and engagement_id=p_engagement_id for share;
 if t.id is null then raise exception 'Exact separately bound production target required' using errcode='42501';end if;
 c:=private.website_staging_connection(p_organization_id,p_project_id,p_engagement_id,p_actor_id,t.connection_id);
 if t.connection_revision is distinct from (c->>'revision')::timestamptz or t.base_url is distinct from c->>'base_url'
 or t.version_number<>(select max(version_number) from private.website_publication_targets where organization_id=t.organization_id and project_id=t.project_id and connection_id=t.connection_id)
 then raise exception 'Production connection changed; inspect and bind its current exact identity' using errcode='40001';end if;
 return jsonb_build_object('target',to_jsonb(t),'connection',c);
end$$;

create function public.bind_website_publication_target(p_organization_id uuid,p_project_id uuid,p_engagement_id uuid,p_actor_id uuid,p_connection_id uuid,p_connection_revision timestamptz,p_identity jsonb,p_confirmed boolean,p_request_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare c jsonb;prior private.website_publication_targets;row private.website_publication_targets;digest text;
begin
 perform private.website_publication_actor(p_organization_id,p_project_id,p_engagement_id,p_actor_id);
 if p_confirmed is distinct from true or p_request_id is null or p_identity is null or jsonb_typeof(p_identity)<>'object' or octet_length(p_identity::text)>2000 then raise exception 'Explicit reviewed production binding required' using errcode='22023';end if;
 if (select count(*) from jsonb_object_keys(p_identity))<>9 or not p_identity?&array['protocol','receiver_version','environment','wordpress_version','php_version','compiler','base_url','site_id','publication_enabled']
 or p_identity->>'receiver_version' is distinct from '1.0.0' or p_identity->>'protocol' is distinct from 'anka-publication-v1' or p_identity->>'environment' is distinct from 'production'
 or p_identity->>'wordpress_version' is distinct from '7.1.3' or coalesce(p_identity->>'php_version','')!~'^8\.3\.[0-9]+$'
 or p_identity->>'compiler' is distinct from 'anka-native-block-v1' or p_identity->'publication_enabled' is distinct from 'true'::jsonb
 or p_identity->>'site_id' is null or p_identity->>'site_id'!~*'^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
 then raise exception 'Exact enabled production receiver identity required' using errcode='22023';end if;
 c:=private.website_staging_connection(p_organization_id,p_project_id,p_engagement_id,p_actor_id,p_connection_id);
 if p_connection_revision is distinct from (c->>'revision')::timestamptz or p_identity->>'base_url' is distinct from c->>'base_url' then raise exception 'Production identity or connection changed' using errcode='40001';end if;
 digest:=encode(sha256(convert_to(jsonb_build_array(p_organization_id,p_project_id,p_engagement_id,p_connection_id,p_connection_revision,p_identity,p_confirmed)::text,'UTF8')),'hex');
 perform pg_advisory_xact_lock(hashtextextended('website-publication-bind-request:'||p_actor_id::text||':'||p_request_id::text,0));
 select * into prior from private.website_publication_targets where created_by=p_actor_id and request_id=p_request_id;
 if found then
  if prior.request_sha256<>digest then raise exception 'Original production binding request has different inputs' using errcode='23505';end if;
  return to_jsonb(prior);
 end if;
 -- Lock exact origin globally, independent of organization or connection ID.
 perform pg_advisory_xact_lock(hashtextextended('website-publication-origin:'||(p_identity->>'base_url'),0));
 perform pg_advisory_xact_lock(hashtextextended('website-publication-site:'||(p_identity->>'site_id'),0));
 if exists(select 1 from private.website_publication_targets x where (x.base_url=p_identity->>'base_url' or x.site_id=(p_identity->>'site_id')::uuid) and (x.organization_id<>p_organization_id or x.project_id<>p_project_id or x.engagement_id<>p_engagement_id)) then raise exception 'Production site already belongs to another retained project binding' using errcode='42501';end if;
 insert into private.website_publication_targets(organization_id,project_id,engagement_id,connection_id,connection_revision,site_id,base_url,version_number,identity,request_id,request_sha256,created_by)
 values(p_organization_id,p_project_id,p_engagement_id,p_connection_id,p_connection_revision,(p_identity->>'site_id')::uuid,p_identity->>'base_url',1+(select coalesce(max(version_number),0) from private.website_publication_targets where organization_id=p_organization_id and project_id=p_project_id and connection_id=p_connection_id),p_identity,p_request_id,digest,p_actor_id) returning * into row;
 return to_jsonb(row);
end$$;

-- Resolve QA and delivery approval from canonical records. Caller flags cannot grant either.
create function public.get_website_publication_sources(p_organization_id uuid,p_project_id uuid,p_engagement_id uuid,p_actor_id uuid,p_pages jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare item jsonb;q private.website_qa_acceptances;v public.artifact_versions;ap public.artifact_approvals;governed public.artifact_approval_requests;ctx jsonb;snapshot jsonb;original jsonb;source jsonb;job public.wordpress_export_jobs;pages jsonb:='[]';packages jsonb:='[]';seen uuid[]:='{}';common_site uuid;site_version uuid;k text;
begin
 perform private.website_publication_actor(p_organization_id,p_project_id,p_engagement_id,p_actor_id);
 if p_pages is null or jsonb_typeof(p_pages)<>'array' or jsonb_array_length(p_pages) not between 1 and 100 or octet_length(p_pages::text)>20000 then raise exception 'Bounded exact saved QA and delivery approval selection required' using errcode='22023';end if;
 for item in select value from jsonb_array_elements(p_pages) order by value->>'qa_receipt_id' loop
  if jsonb_typeof(item)<>'object' or (select count(*) from jsonb_object_keys(item))<>2 or not item?&array['qa_receipt_id','approval_id'] or item->>'qa_receipt_id' is null or item->>'approval_id' is null then raise exception 'Exact QA receipt and delivery approval IDs required' using errcode='22023';end if;
  select * into q from private.website_qa_acceptances where id=(item->>'qa_receipt_id')::uuid and organization_id=p_organization_id and project_id=p_project_id and engagement_id=p_engagement_id for share;
  if q.id is null then raise exception 'Selected QA receipt is outside this project' using errcode='42501';end if;
  select * into v from public.artifact_versions where id=q.artifact_version_id and organization_id=q.organization_id for share;
  perform pg_advisory_xact_lock(hashtextextended(v.artifact_id::text,0));
  ctx:=private.website_qa_context(p_organization_id,p_project_id,p_engagement_id,p_actor_id,q.run_id,v.artifact_id);snapshot:=ctx->'snapshot';original:=v.content->'website_qa'->'snapshot';
  if v.content->'website_qa'->>'schema' is distinct from 'anka-website-qa-v1' or v.content->'website_qa'->>'assessment' is distinct from 'human_reported_pass'
  or exists(select 1 from private.website_qa_acceptances x where x.run_id=q.run_id and (x.created_at,x.id)>(q.created_at,q.id)) then raise exception 'Current exact saved QA acceptance required' using errcode='40001';end if;
  foreach k in array array['organization_id','project_id','engagement_id','run_id','page_id','job_id','package_sha256','source_review_sha256','target_id','site_id','base_url','preview_request_id','preview_url','issue_heads'] loop
   if snapshot->k is distinct from original->k then raise exception 'Saved QA sources, preview or issue history changed' using errcode='40001';end if;
  end loop;
  if (snapshot->>'page_id')::uuid=any(seen) then raise exception 'Select each registered page once' using errcode='22023';end if;
  seen:=array_append(seen,(snapshot->>'page_id')::uuid);
  select * into ap from public.artifact_approvals where organization_id=p_organization_id and artifact_version_id=v.id order by approved_at desc,id desc limit 1 for share;
  select * into governed from public.artifact_approval_requests where organization_id=p_organization_id and artifact_version_id=v.id order by created_at desc,id desc limit 1 for share;
  if ap.id is distinct from (item->>'approval_id')::uuid or ap.decision is distinct from 'approved' or ap.artifact_id is distinct from v.artifact_id or ap.engagement_id is distinct from p_engagement_id or (governed.id is not null and governed.status<>'completed') then raise exception 'Existing current exact deliverable approval required separately from QA' using errcode='42501';end if;
  select i.source into source from private.website_block_inputs i where i.job_id=(snapshot->>'job_id')::uuid and i.organization_id=p_organization_id;
  select * into job from public.wordpress_export_jobs where id=(snapshot->>'job_id')::uuid and organization_id=p_organization_id and status='complete' and provider_job_id='anka-native-block-v1' for share;
  if job.id is null then raise exception 'Original complete native package required' using errcode='40001';end if;
  packages:=packages||jsonb_build_array(jsonb_build_object('page_id',snapshot->>'page_id','source',source,'job',to_jsonb(job)));
  site_version:=(source->'manifest'->'sources'->'site_system'->>'version_id')::uuid;
  if site_version is null or (common_site is not null and common_site<>site_version) then raise exception 'Selected pages must share one exact site system version' using errcode='40001';end if;
  common_site:=site_version;
  pages:=pages||jsonb_build_array(jsonb_build_object('page_id',snapshot->>'page_id','page_key',source->'manifest'->'scope'->>'page_key','path',source->'context'->'page'->>'path','job_id',snapshot->>'job_id','package_sha256',snapshot->>'package_sha256','source_review_sha256',snapshot->>'source_review_sha256','site_version_id',site_version,'qa',jsonb_build_object('receipt_id',q.id,'artifact_version_id',v.id,'run_id',q.run_id,'page_id',snapshot->>'page_id','package_sha256',snapshot->>'package_sha256','current',true),'release_approval',jsonb_build_object('id',ap.id,'artifact_version_id',v.id,'decision','approved','current',true)));
 end loop;
 return jsonb_build_object('pages',pages,'site_version_id',common_site,'packages',packages);
end$$;

create table private.website_publication_reviews(
 id uuid primary key default gen_random_uuid(),target_id uuid not null references private.website_publication_targets(id),
 kind text not null default 'publication' check(kind in ('publication','rollback')),publication_command_id uuid,registry_before jsonb not null default '[]',source_selection jsonb not null check(jsonb_typeof(source_selection)='array' and octet_length(source_selection::text)<=20000),
 snapshot jsonb not null check(jsonb_typeof(snapshot)='object' and octet_length(snapshot::text)<=1048576),
 review_sha256 text not null check(review_sha256~'^[a-f0-9]{64}$'),context_sha256 text not null check(context_sha256~'^[a-f0-9]{64}$'),
 request_id uuid not null,request_sha256 text not null check(request_sha256~'^[a-f0-9]{64}$'),
 created_by uuid not null references auth.users(id),created_at timestamptz not null default clock_timestamp(),unique(created_by,request_id)
);
create table private.website_publication_commands(
 id uuid primary key default gen_random_uuid(),review_id uuid not null unique references private.website_publication_reviews(id),
 request_id uuid not null unique,created_by uuid not null references auth.users(id),created_at timestamptz not null default clock_timestamp()
);
create table private.website_publication_results(
 command_id uuid primary key references private.website_publication_commands(id),
 outcome text not null check(outcome in ('succeeded','failed')),remote_state jsonb,projection_status text not null default 'not_required' check(projection_status in ('applied','conflict','not_required')),registry_before jsonb not null default '[]',registry_after jsonb not null default '[]',
 receipt jsonb not null check(jsonb_typeof(receipt)='object' and octet_length(receipt::text)<=4000),
 recorded_by uuid not null references auth.users(id),created_at timestamptz not null default clock_timestamp()
);
alter table private.website_publication_reviews add foreign key(publication_command_id) references private.website_publication_commands(id);
create index website_publication_reviews_publication on private.website_publication_reviews(publication_command_id);
create index website_publication_reviews_target on private.website_publication_reviews(target_id,created_at desc);
create index website_publication_commands_actor on private.website_publication_commands(created_by);
create index website_publication_results_actor on private.website_publication_results(recorded_by);
alter table private.website_publication_reviews enable row level security;
alter table private.website_publication_commands enable row level security;
alter table private.website_publication_results enable row level security;
revoke all on private.website_publication_reviews,private.website_publication_commands,private.website_publication_results from public,anon,authenticated,service_role;
create trigger website_publication_review_immutable before update or delete on private.website_publication_reviews for each row execute function private.website_native_immutable();
create trigger website_publication_command_immutable before update or delete on private.website_publication_commands for each row execute function private.website_native_immutable();
create trigger website_publication_result_immutable before update or delete on private.website_publication_results for each row execute function private.website_native_immutable();

create function private.website_publication_current(o uuid,p uuid,e uuid,a uuid,tid uuid,selection jsonb) returns text language plpgsql security definer set search_path='' as $$
declare target jsonb;sources jsonb;
begin
 target:=public.get_website_publication_target(o,p,e,a,tid,null);
 sources:=public.get_website_publication_sources(o,p,e,a,selection);
 return encode(sha256(convert_to(jsonb_build_array(target->'target',sources)::text,'UTF8')),'hex');
end$$;


create function private.website_publication_registry_snapshot(snapshot jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb:='[]';item jsonb;row public.project_website_page_revisions;
begin
 for item in select value from jsonb_array_elements(coalesce(snapshot->'pages','[]')) loop
  select * into row from public.project_website_page_revisions where organization_id=(snapshot->'scope'->>'organization_id')::uuid and project_id=(snapshot->'scope'->>'project_id')::uuid and page_id=(item->>'page_id')::uuid order by revision_number desc limit 1;
  if row.id is null then raise exception 'Current canonical page operations required before publication review' using errcode='40001';end if;
  result:=result||jsonb_build_array(to_jsonb(row));
 end loop;return result;
end$$;
create function private.website_publication_project_registry(rid uuid,state jsonb,actor uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare review private.website_publication_reviews;original private.website_publication_results;before_rows jsonb;expected_rows jsonb;item jsonb;expected jsonb;current_row public.project_website_page_revisions;row public.project_website_page_revisions;post jsonb;after_rows jsonb:='[]';live text;status text;
begin
 select * into review from private.website_publication_reviews where id=rid;
 if state->>'observed_inventory_sha256' is distinct from state->'inventory'->>'inventory_sha256' then return jsonb_build_object('status','conflict','before',review.registry_before,'after','[]'::jsonb);end if;
 if review.kind='publication' then before_rows:=review.registry_before;expected_rows:=before_rows;
 else select * into original from private.website_publication_results where command_id=review.publication_command_id;before_rows:=original.registry_before;expected_rows:=original.registry_after;
  if original.projection_status<>'applied' then return jsonb_build_object('status','conflict','before',before_rows,'after','[]'::jsonb);end if;
 end if;
 -- Lock each existing canonical page using the same lock as its manual writer.
 for item in select value from jsonb_array_elements(before_rows) order by value->>'page_id' loop
  perform 1 from public.project_website_pages where id=(item->>'page_id')::uuid and organization_id=(item->>'organization_id')::uuid and project_id=(item->>'project_id')::uuid for update;
  if not found then raise exception 'Canonical project page no longer available' using errcode='42501';end if;
  select * into current_row from public.project_website_page_revisions where organization_id=(item->>'organization_id')::uuid and page_id=(item->>'page_id')::uuid order by revision_number desc limit 1;
  select value into expected from jsonb_array_elements(expected_rows) where value->>'page_id'=item->>'page_id';
  if current_row.id is distinct from (expected->>'id')::uuid then return jsonb_build_object('status','conflict','before',before_rows,'after','[]'::jsonb);end if;
 end loop;
 for item in select value from jsonb_array_elements(before_rows) loop
  select * into current_row from public.project_website_page_revisions where organization_id=(item->>'organization_id')::uuid and page_id=(item->>'page_id')::uuid order by revision_number desc limit 1;
  if review.kind='publication' then
   select value into post from jsonb_array_elements(state->'inventory'->'posts') where value->>'managed_page_id'=item->>'page_id';
   if post is null or post->>'post_type'<>'page' or post->>'post_status'<>'publish' or coalesce(post->>'path','')!~'^/' then raise exception 'Verified selected live page required for registry projection' using errcode='22023';end if;
   live:=(select base_url from private.website_publication_targets where id=review.target_id)||(post->>'path');status:='published';
  else live:=item->>'recorded_live_url';status:=item->>'publication_state';end if;
  insert into public.project_website_page_revisions(organization_id,project_id,page_id,revision_number,architecture_artifact_id,architecture_version_id,architecture_approval_id,architecture_checksum,planned_path,planned_url,recorded_live_url,redirect_url,publication_state,template,work_item_id,implementation_notes,qa_evidence,created_by)
  values((item->>'organization_id')::uuid,(item->>'project_id')::uuid,(item->>'page_id')::uuid,current_row.revision_number+1,(item->>'architecture_artifact_id')::uuid,(item->>'architecture_version_id')::uuid,(item->>'architecture_approval_id')::uuid,item->>'architecture_checksum',item->>'planned_path',item->>'planned_url',live,item->>'redirect_url',status,item->>'template',(item->>'work_item_id')::uuid,item->>'implementation_notes',item->>'qa_evidence',actor) returning * into row;
  after_rows:=after_rows||jsonb_build_array(to_jsonb(row));
 end loop;return jsonb_build_object('status','applied','before',before_rows,'after',after_rows);
end$$;

-- Server-only recording of an inspected review is never human publication authorization.
create function public.record_website_publication_review(p_organization_id uuid,p_project_id uuid,p_engagement_id uuid,p_actor_id uuid,p_target_id uuid,p_source_selection jsonb,p_snapshot jsonb,p_review_sha256 text,p_request_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare current_sha text;digest text;prior private.website_publication_reviews;row private.website_publication_reviews;
begin
 current_sha:=private.website_publication_current(p_organization_id,p_project_id,p_engagement_id,p_actor_id,p_target_id,p_source_selection);
 if p_request_id is null or p_review_sha256 is null or p_review_sha256!~'^[a-f0-9]{64}$' or p_snapshot is null or jsonb_typeof(p_snapshot)<>'object' or octet_length(p_snapshot::text)>1048576
 or p_snapshot->'scope' is distinct from jsonb_build_object('organization_id',p_organization_id,'project_id',p_project_id,'engagement_id',p_engagement_id)
 or (p_snapshot->'target'->>'target_id')::uuid is distinct from p_target_id then raise exception 'Exact server-inspected publication review required' using errcode='22023';end if;
 digest:=encode(sha256(convert_to(jsonb_build_array(p_target_id,p_source_selection,p_snapshot,p_review_sha256)::text,'UTF8')),'hex');
 perform pg_advisory_xact_lock(hashtextextended('website-publication-review-request:'||p_actor_id::text||':'||p_request_id::text,0));
 select * into prior from private.website_publication_reviews where created_by=p_actor_id and request_id=p_request_id;
 if found then
  if prior.request_sha256<>digest then raise exception 'Original publication review has different inputs' using errcode='23505';end if;
  return to_jsonb(prior);
 end if;
 insert into private.website_publication_reviews(target_id,source_selection,snapshot,review_sha256,context_sha256,request_id,request_sha256,created_by,registry_before)
 values(p_target_id,p_source_selection,p_snapshot,p_review_sha256,current_sha,p_request_id,digest,p_actor_id,private.website_publication_registry_snapshot(p_snapshot)) returning * into row;
 return to_jsonb(row);
end$$;

-- The authenticated Edge worker supplies the actual actor only after explicit unchecked-by-default confirmation.
-- Claiming appends the human authorization and original command atomically; it never publishes from SQL.
create function public.start_website_publication_command(p_organization_id uuid,p_project_id uuid,p_engagement_id uuid,p_actor_id uuid,p_review_id uuid,p_review_sha256 text,p_confirmed boolean,p_request_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare review private.website_publication_reviews;target private.website_publication_targets;prior private.website_publication_commands;row private.website_publication_commands;current_sha text;
begin
 perform private.website_publication_actor(p_organization_id,p_project_id,p_engagement_id,p_actor_id);
 if p_confirmed is distinct from true or p_request_id is null then raise exception 'Explicit exact-target live publication confirmation required' using errcode='22023';end if;
 select * into review from private.website_publication_reviews where id=p_review_id and created_by=p_actor_id;
 select * into target from private.website_publication_targets where id=review.target_id and organization_id=p_organization_id and project_id=p_project_id and engagement_id=p_engagement_id;
 if review.kind is distinct from 'publication' then raise exception 'Publication review required' using errcode='22023';end if;
 if review.id is null or target.id is null or review.review_sha256 is distinct from p_review_sha256 then raise exception 'Exact retained production review required' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended('website-publication-command-request:'||p_request_id::text,0));
 select * into prior from private.website_publication_commands where request_id=p_request_id;
 if found then
  if prior.review_id<>p_review_id or prior.created_by<>p_actor_id then raise exception 'Original publication command owns different inputs' using errcode='23505';end if;
  return jsonb_build_object('created',false,'command',to_jsonb(prior));
 end if;
 if review.created_at+interval '10 minutes'<=clock_timestamp() then raise exception 'Publication review expired; inspect current exact inputs' using errcode='40001';end if;
 current_sha:=private.website_publication_current(p_organization_id,p_project_id,p_engagement_id,p_actor_id,target.id,review.source_selection);
 if current_sha<>review.context_sha256 then raise exception 'Publication source, approval or target changed since review' using errcode='40001';end if;
 perform pg_advisory_xact_lock(hashtextextended('website-publication-site:'||target.site_id::text,0));
 if exists(select 1 from private.website_publication_commands c join private.website_publication_reviews r on r.id=c.review_id join private.website_publication_targets t on t.id=r.target_id where (t.site_id=target.site_id or t.base_url=target.base_url) and not exists(select 1 from private.website_publication_results z where z.command_id=c.id)) then raise exception 'Recover original uncertain publication before any replacement command' using errcode='55000';end if;
 if review.created_at+interval '10 minutes'<=clock_timestamp() then raise exception 'Publication review expired while waiting; inspect current inputs' using errcode='40001';end if;
 insert into private.website_publication_commands(review_id,request_id,created_by) values(review.id,p_request_id,p_actor_id) returning * into row;
 return jsonb_build_object('created',true,'command',to_jsonb(row));
end$$;

create function public.get_website_publication_command(p_organization_id uuid,p_project_id uuid,p_engagement_id uuid,p_actor_id uuid,p_request_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare command private.website_publication_commands;review private.website_publication_reviews;target private.website_publication_targets;
begin
 perform private.website_publication_actor(p_organization_id,p_project_id,p_engagement_id,p_actor_id);
 select * into command from private.website_publication_commands where request_id=p_request_id;
 select * into review from private.website_publication_reviews where id=command.review_id;
 select * into target from private.website_publication_targets where id=review.target_id and organization_id=p_organization_id and project_id=p_project_id and engagement_id=p_engagement_id;
 if target.id is null then return null;end if;
 -- Historical recovery does not require old package sources to remain current and has no writer.
 return jsonb_build_object('command',to_jsonb(command),'review',to_jsonb(review),'target',to_jsonb(target),'result',(select to_jsonb(x) from private.website_publication_results x where command_id=command.id));
end$$;

create function public.record_website_publication_result(p_organization_id uuid,p_project_id uuid,p_engagement_id uuid,p_actor_id uuid,p_command_id uuid,p_receipt jsonb,p_remote_state jsonb default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare command private.website_publication_commands;review private.website_publication_reviews;target private.website_publication_targets;prior private.website_publication_results;row private.website_publication_results;projection jsonb;
begin
 perform private.website_publication_actor(p_organization_id,p_project_id,p_engagement_id,p_actor_id);
 select * into command from private.website_publication_commands where id=p_command_id for share;
 select * into review from private.website_publication_reviews where id=command.review_id;
 select * into target from private.website_publication_targets where id=review.target_id and organization_id=p_organization_id and project_id=p_project_id and engagement_id=p_engagement_id;
 if target.id is null then raise exception 'Original publication command is outside this project' using errcode='42501';end if;
 if p_receipt is null or jsonb_typeof(p_receipt)<>'object' or octet_length(p_receipt::text)>4000
 or p_receipt->>'status' is null or p_receipt->>'status' not in ('succeeded','failed')
 or p_receipt->>'kind' is distinct from review.kind
 or (p_receipt->>'request_id')::uuid is distinct from command.request_id or (p_receipt->>'command_id')::uuid is distinct from command.id
 or p_receipt->>'review_sha256' is distinct from review.review_sha256
 then raise exception 'Exact bounded original publication outcome required' using errcode='22023';end if;
 if p_receipt->>'status'='succeeded' then
  if (select count(*) from jsonb_object_keys(p_receipt))<>7 or not p_receipt?&array['request_id','status','kind','command_id','review_sha256','head','backup_snapshot_sha256']
  or (p_receipt->>'head')::uuid is distinct from command.request_id or coalesce(p_receipt->>'backup_snapshot_sha256','')!~'^[a-f0-9]{64}$' then raise exception 'Verified successful original publication and retained backup required' using errcode='22023';end if;
 elsif (select count(*) from jsonb_object_keys(p_receipt))<>5 or not p_receipt?&array['request_id','status','kind','command_id','review_sha256'] then raise exception 'Only fixed safe failure receipt fields are accepted' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended('website-publication-result:'||command.id::text,0));
 select * into prior from private.website_publication_results where command_id=command.id;
 if found then
  if prior.receipt<>p_receipt or prior.remote_state is distinct from p_remote_state then raise exception 'Original publication result is immutable' using errcode='23505';end if;
  return to_jsonb(prior);
 end if;
 if p_receipt->>'status'='succeeded' then
  if p_remote_state is null or jsonb_typeof(p_remote_state)<>'object' or octet_length(p_remote_state::text)>2097152 or (select count(*) from jsonb_object_keys(p_remote_state))<>2 or not p_remote_state?&array['inventory','observed_inventory_sha256'] or coalesce(p_remote_state->>'observed_inventory_sha256','')!~'^[a-f0-9]{64}$'
  or p_remote_state->'inventory'->>'site_id' is distinct from target.site_id::text or p_remote_state->'inventory'->>'origin' is distinct from target.base_url or p_remote_state->'inventory'->>'head' is distinct from command.request_id::text or p_remote_state->'inventory'->'complete' is distinct from 'true'::jsonb
  or jsonb_typeof(p_remote_state->'inventory'->'posts') is distinct from 'array' then raise exception 'Exact verified terminal inventory required' using errcode='22023';end if;
  projection:=private.website_publication_project_registry(review.id,p_remote_state,p_actor_id);
 else
  if p_remote_state is not null then raise exception 'Failed result cannot include a published state' using errcode='22023';end if;projection:=jsonb_build_object('status','not_required','before','[]'::jsonb,'after','[]'::jsonb);
 end if;
 insert into private.website_publication_results(command_id,outcome,receipt,recorded_by,remote_state,projection_status,registry_before,registry_after) values(command.id,p_receipt->>'status',p_receipt,p_actor_id,p_remote_state,projection->>'status',projection->'before',projection->'after') returning * into row;
 return to_jsonb(row);
end$$;


create function public.record_website_rollback_review(p_organization_id uuid,p_project_id uuid,p_engagement_id uuid,p_actor_id uuid,p_publication_request_id uuid,p_snapshot jsonb,p_review_sha256 text,p_request_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare original jsonb;t jsonb;prior private.website_publication_reviews;row private.website_publication_reviews;context text;digest text;
begin
 perform private.website_publication_actor(p_organization_id,p_project_id,p_engagement_id,p_actor_id);
 original:=public.get_website_publication_command(p_organization_id,p_project_id,p_engagement_id,p_actor_id,p_publication_request_id);
 if original is null or original->'review'->>'kind'<>'publication' or original->'result'->>'outcome'<>'succeeded' then raise exception 'Exact successful original publication required' using errcode='42501';end if;
 t:=public.get_website_publication_target(p_organization_id,p_project_id,p_engagement_id,p_actor_id,(original->'target'->>'id')::uuid,null);
 if p_request_id is null or p_review_sha256!~'^[a-f0-9]{64}$' or jsonb_typeof(p_snapshot)<>'object' or octet_length(p_snapshot::text)>1048576
 or p_snapshot->'scope' is distinct from jsonb_build_object('organization_id',p_organization_id,'project_id',p_project_id,'engagement_id',p_engagement_id)
 or p_snapshot->'retained'->>'published_head' is distinct from p_publication_request_id::text or p_snapshot->'retained'->>'publication_id' is distinct from original->'command'->>'id'
 or p_snapshot->'retained'->>'backup_snapshot_sha256' is distinct from original->'result'->'receipt'->>'backup_snapshot_sha256' then raise exception 'Exact inspected original rollback review required' using errcode='22023';end if;
 context:=encode(sha256(convert_to(jsonb_build_array(t->'target',original->'result')::text,'UTF8')),'hex');digest:=encode(sha256(convert_to(jsonb_build_array(p_snapshot,p_review_sha256)::text,'UTF8')),'hex');
 perform pg_advisory_xact_lock(hashtextextended('website-publication-review-request:'||p_actor_id::text||':'||p_request_id::text,0));
 select * into prior from private.website_publication_reviews where created_by=p_actor_id and request_id=p_request_id;
 if found then if prior.kind<>'rollback' or prior.request_sha256<>digest then raise exception 'Original rollback review differs' using errcode='23505';end if;return to_jsonb(prior);end if;
 insert into private.website_publication_reviews(kind,publication_command_id,target_id,source_selection,snapshot,review_sha256,context_sha256,request_id,request_sha256,created_by)
 values('rollback',(original->'command'->>'id')::uuid,(original->'target'->>'id')::uuid,'[]',p_snapshot,p_review_sha256,context,p_request_id,digest,p_actor_id) returning * into row;return to_jsonb(row);
end$$;
create function public.start_website_rollback_command(p_organization_id uuid,p_project_id uuid,p_engagement_id uuid,p_actor_id uuid,p_review_id uuid,p_review_sha256 text,p_confirmed boolean,p_request_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare review private.website_publication_reviews;t jsonb;original private.website_publication_results;prior private.website_publication_commands;row private.website_publication_commands;context text;
begin
 perform private.website_publication_actor(p_organization_id,p_project_id,p_engagement_id,p_actor_id);
 select * into review from private.website_publication_reviews where id=p_review_id and created_by=p_actor_id and kind='rollback';
 if review.id is null or p_confirmed is distinct from true or p_request_id is null or review.review_sha256 is distinct from p_review_sha256 then raise exception 'Explicit exact original rollback confirmation required' using errcode='42501';end if;
 t:=public.get_website_publication_target(p_organization_id,p_project_id,p_engagement_id,p_actor_id,review.target_id,null);
 perform pg_advisory_xact_lock(hashtextextended('website-publication-command-request:'||p_request_id::text,0));select * into prior from private.website_publication_commands where request_id=p_request_id;
 if found then if prior.review_id<>review.id or prior.created_by<>p_actor_id then raise exception 'Original rollback command differs' using errcode='23505';end if;return jsonb_build_object('created',false,'command',to_jsonb(prior));end if;
 select * into original from private.website_publication_results where command_id=review.publication_command_id;
 context:=encode(sha256(convert_to(jsonb_build_array(t->'target',to_jsonb(original))::text,'UTF8')),'hex');
 if context<>review.context_sha256 or review.created_at+interval '10 minutes'<=clock_timestamp() then raise exception 'Rollback review expired or target changed' using errcode='40001';end if;
 perform pg_advisory_xact_lock(hashtextextended('website-publication-site:'||(t->'target'->>'site_id'),0));
 if exists(select 1 from private.website_publication_commands c join private.website_publication_reviews r on r.id=c.review_id join private.website_publication_targets target on target.id=r.target_id where (target.site_id=(t->'target'->>'site_id')::uuid or target.base_url=t->'target'->>'base_url') and not exists(select 1 from private.website_publication_results z where z.command_id=c.id)) then raise exception 'Recover original uncertain command before rollback' using errcode='55000';end if;
 if review.created_at+interval '10 minutes'<=clock_timestamp() then raise exception 'Rollback review expired while waiting' using errcode='40001';end if;
 insert into private.website_publication_commands(review_id,request_id,created_by) values(review.id,p_request_id,p_actor_id) returning * into row;return jsonb_build_object('created',true,'command',to_jsonb(row));
end$$;

revoke all on function private.website_publication_registry_snapshot(jsonb),private.website_publication_project_registry(uuid,jsonb,uuid) from public,anon,authenticated,service_role;
revoke all on function public.record_website_rollback_review(uuid,uuid,uuid,uuid,uuid,jsonb,text,uuid),public.start_website_rollback_command(uuid,uuid,uuid,uuid,uuid,text,boolean,uuid) from public,anon,authenticated,service_role;
grant execute on function public.record_website_rollback_review(uuid,uuid,uuid,uuid,uuid,jsonb,text,uuid),public.start_website_rollback_command(uuid,uuid,uuid,uuid,uuid,text,boolean,uuid) to service_role;
create function public.get_website_publication_workspace(p_organization_id uuid,p_project_id uuid,p_engagement_id uuid,p_actor_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare connections jsonb;targets jsonb;choices jsonb;history jsonb;
begin
 perform private.website_publication_actor(p_organization_id,p_project_id,p_engagement_id,p_actor_id);
 select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'display_name',c.display_name,'base_url',c.base_url)),'[]') into connections from public.integration_connections c where c.organization_id=p_organization_id and c.provider='wordpress' and c.status='verified' and c.archived_at is null
 and exists(select 1 from public.integration_connection_departments d where d.organization_id=c.organization_id and d.connection_id=c.id and d.department_id='development') and exists(select 1 from public.integration_connection_engagements e where e.organization_id=c.organization_id and e.connection_id=c.id and e.engagement_id=p_engagement_id and e.department_id='development');
 select coalesce(jsonb_agg(to_jsonb(x)),'[]') into targets from(select t.id,t.request_id,t.created_by,t.connection_id,t.base_url,t.site_id,t.version_number,(t.connection_revision=c.updated_at and t.version_number=(select max(version_number) from private.website_publication_targets y where y.organization_id=t.organization_id and y.project_id=t.project_id and y.connection_id=t.connection_id)) as current from private.website_publication_targets t join public.integration_connections c on c.id=t.connection_id and c.organization_id=t.organization_id where t.organization_id=p_organization_id and t.project_id=p_project_id and t.engagement_id=p_engagement_id order by t.created_at desc,t.id limit 20)x;
 select coalesce(jsonb_agg(to_jsonb(x)),'[]') into choices from(select q.id as qa_receipt_id,a.id as approval_id,st.page_id,q.run_id,q.created_at,p.page_key from private.website_qa_acceptances q join private.website_staging_runs st on st.id=q.run_id and st.organization_id=q.organization_id join public.project_website_pages p on p.id=st.page_id and p.organization_id=q.organization_id join lateral(select * from public.artifact_approvals ap where ap.organization_id=q.organization_id and ap.artifact_version_id=q.artifact_version_id order by approved_at desc,id desc limit 1)a on a.decision='approved' where q.organization_id=p_organization_id and q.project_id=p_project_id and q.engagement_id=p_engagement_id order by q.created_at desc,q.id limit 50)x;
 select coalesce(jsonb_agg(to_jsonb(x)),'[]') into history from(select c.request_id,c.id as command_id,r.kind,r.target_id,t.base_url,c.created_at,coalesce(z.outcome,'uncertain') as status,z.projection_status,z.receipt from private.website_publication_commands c join private.website_publication_reviews r on r.id=c.review_id join private.website_publication_targets t on t.id=r.target_id left join private.website_publication_results z on z.command_id=c.id where t.organization_id=p_organization_id and t.project_id=p_project_id and t.engagement_id=p_engagement_id order by c.created_at desc,c.id limit 20)x;
 return jsonb_build_object('organization_id',p_organization_id,'project_id',p_project_id,'engagement_id',p_engagement_id,'connections',connections,'targets',targets,'choices',choices,'history',history);
end$$;
revoke all on function public.get_website_publication_workspace(uuid,uuid,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.get_website_publication_workspace(uuid,uuid,uuid,uuid) to service_role;

revoke all on function private.website_publication_actor(uuid,uuid,uuid,uuid),private.website_publication_current(uuid,uuid,uuid,uuid,uuid,jsonb) from public,anon,authenticated,service_role;
revoke all on function public.record_website_publication_review(uuid,uuid,uuid,uuid,uuid,jsonb,jsonb,text,uuid),public.start_website_publication_command(uuid,uuid,uuid,uuid,uuid,text,boolean,uuid),public.get_website_publication_command(uuid,uuid,uuid,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.record_website_publication_review(uuid,uuid,uuid,uuid,uuid,jsonb,jsonb,text,uuid),public.start_website_publication_command(uuid,uuid,uuid,uuid,uuid,text,boolean,uuid),public.get_website_publication_command(uuid,uuid,uuid,uuid,uuid) to service_role;
revoke all on function public.record_website_publication_result(uuid,uuid,uuid,uuid,uuid,jsonb,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.record_website_publication_result(uuid,uuid,uuid,uuid,uuid,jsonb,jsonb) to service_role;
revoke all on function public.get_website_publication_target(uuid,uuid,uuid,uuid,uuid,uuid),public.bind_website_publication_target(uuid,uuid,uuid,uuid,uuid,timestamptz,jsonb,boolean,uuid),public.get_website_publication_sources(uuid,uuid,uuid,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.get_website_publication_target(uuid,uuid,uuid,uuid,uuid,uuid),public.bind_website_publication_target(uuid,uuid,uuid,uuid,uuid,timestamptz,jsonb,boolean,uuid),public.get_website_publication_sources(uuid,uuid,uuid,uuid,jsonb) to service_role;
commit;
