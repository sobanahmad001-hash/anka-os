-- Provider-free import proposals reuse the existing private Chat contract.
-- The NULL department is deliberate: Project Chat has no Workshop department.
-- Existing provider paths keep their required provider/model/department binding.
begin;
set local lock_timeout='5s';
set local statement_timeout='120s';
alter table public.department_chat_proposals
  add column proposal_origin text not null default 'provider',
  add column import_attachment_id uuid references public.department_chat_attachments(id) on delete restrict,
  add column import_source_receipt jsonb not null default '{}'::jsonb,
  add column import_result jsonb,
  alter column department_id drop not null,
  alter column connector_connection_id drop not null,
  alter column model_id drop not null,
  alter column ai_run_id drop not null;
alter table public.department_chat_proposals drop constraint department_chat_proposals_proposal_kind_check;
alter table public.department_chat_proposals add constraint department_chat_proposals_proposal_kind_check
  check(proposal_kind in ('artifact_version','work_item','spreadsheet_import'));
-- Carry the installed provider allowlist forward without replacing its scope.
do $$ declare original text; begin
  select pg_get_expr(conbin,conrelid) into original from pg_constraint
    where conrelid='public.department_chat_proposals'::regclass and conname='department_chat_proposals_target_allowlist_check';
  if original is null then raise exception 'Expected provider target allowlist unavailable'; end if;
  alter table public.department_chat_proposals drop constraint department_chat_proposals_target_allowlist_check;
  execute 'alter table public.department_chat_proposals add constraint department_chat_proposals_target_allowlist_check check ((proposal_origin=''provider'' and ('||original||')) or (proposal_origin=''spreadsheet_import'' and proposal_kind=''spreadsheet_import'' and department_id is null and target_key in (''website_architecture'',''keyword_strategy'',''content_calendar'')))';
end; $$;
alter table public.department_chat_proposals add constraint department_chat_proposals_origin_check check (
  coalesce(
    proposal_origin='provider' and proposal_kind in ('artifact_version','work_item')
      and department_id is not null and connector_connection_id is not null and model_id is not null and ai_run_id is not null
      and import_attachment_id is null and import_source_receipt='{}'::jsonb and import_result is null
    or proposal_origin='spreadsheet_import' and proposal_kind='spreadsheet_import'
      and department_id is null and connector_connection_id is null and model_id is null and ai_run_id is null and model_configuration_id is null
      and conversation_id is not null and conversation_owner_id=proposer_id and import_attachment_id is not null
      and target_key in ('website_architecture','keyword_strategy','content_calendar') and cardinality(context_artifact_version_ids)=0
      and safe_prompt_metadata='{}'::jsonb and engagement_stage_instance_id is null
      and jsonb_typeof(import_source_receipt)='object' and octet_length(import_source_receipt::text)<=80000
      and (import_result is null or jsonb_typeof(import_result)='object' and octet_length(import_result::text)<=80000),false)
);
-- Preserve all provider lifecycle branches; imports have their own receipt.
alter table public.department_chat_proposals drop constraint department_chat_proposals_lifecycle_check;
alter table public.department_chat_proposals add constraint department_chat_proposals_lifecycle_check check (
  status='pending' and decided_by is null and decided_at is null and accepted_artifact_id is null and accepted_artifact_version_id is null and accepted_work_item_id is null and import_result is null
  or status='accepted' and decided_by is not null and decided_at is not null and (
    proposal_origin='provider' and (proposal_kind='artifact_version' and accepted_artifact_id is not null and accepted_artifact_version_id is not null and accepted_work_item_id is null
      or proposal_kind='work_item' and accepted_artifact_id is null and accepted_artifact_version_id is null and accepted_work_item_id is not null)
    or proposal_origin='spreadsheet_import' and import_result is not null and accepted_work_item_id is null and (
      target_key in ('website_architecture','keyword_strategy') and accepted_artifact_id is not null and accepted_artifact_version_id is not null
      or target_key='content_calendar' and accepted_artifact_id is null and accepted_artifact_version_id is null))
  or status in ('rejected','expired','stale') and decided_by is not null and decided_at is not null and accepted_artifact_id is null and accepted_artifact_version_id is null and accepted_work_item_id is null and import_result is null
);

create function private.guard_project_import_proposal()
returns trigger language plpgsql security invoker set search_path='' as $$
declare attachment public.department_chat_attachments;
begin
  if tg_op='UPDATE' and (new.proposal_origin is distinct from old.proposal_origin
    or new.import_attachment_id is distinct from old.import_attachment_id
    or new.import_source_receipt is distinct from old.import_source_receipt) then
    raise exception 'Import proposal source is immutable' using errcode='23514';
  end if;
  if tg_op='UPDATE' and new.import_result is distinct from old.import_result
    and not (old.proposal_origin='spreadsheet_import' and old.status='pending' and new.status='accepted' and old.import_result is null) then
    raise exception 'Import result is immutable outside confirmation' using errcode='23514';
  end if;
  if new.proposal_origin='spreadsheet_import' then
    select * into attachment from public.department_chat_attachments where id=new.import_attachment_id;
    if not found or attachment.source_kind<>'project_spreadsheet' or attachment.status<>'reference_only'
      or attachment.organization_id<>new.organization_id or attachment.project_id<>new.project_id
      or attachment.conversation_id<>new.conversation_id or attachment.uploaded_by<>new.proposer_id
      or attachment.share_with_recipients or attachment.ai_use_allowed then
      raise exception 'Exact verified private import source required' using errcode='42501';
    end if;
  end if;
  return new;
end; $$;
create trigger project_import_proposal_guard before insert or update on public.department_chat_proposals
  for each row execute function private.guard_project_import_proposal();

-- Keep provider audit semantics unchanged. An all-error import receipt records
-- confirmation, but cannot claim an official record was created.
create or replace function private.audit_department_chat_proposal()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
  insert into public.department_chat_audit_events(organization_id,actor_id,proposal_id,ai_run_id,event_kind,reason_code)
  values(new.organization_id,coalesce(new.decided_by,new.proposer_id),new.id,new.ai_run_id,
    case new.status when 'pending' then 'preview_generated' when 'accepted' then 'confirmed' else new.status end,
    case new.status when 'stale' then 'context_changed' when 'expired' then 'proposal_expired' else '' end);
  if new.status='accepted' and (new.proposal_origin='provider' or exists(
    select 1 from jsonb_array_elements(new.import_result->'rows') r where r->>'outcome'='verified' and r->>'action'<>'skip')) then
    insert into public.department_chat_audit_events(organization_id,actor_id,proposal_id,ai_run_id,event_kind)
      values(new.organization_id,new.decided_by,new.id,new.ai_run_id,'official_record_created');
  end if;
  return new;
end; $$;

create function private.require_project_import_target(
  p_org uuid,p_project uuid,p_engagement uuid,p_actor uuid,p_target text
) returns public.engagements language plpgsql security invoker set search_path='' as $$
declare engagement public.engagements; department text;
begin
  department:=case when p_target='content_calendar' then 'marketing' else 'content' end;
  if p_target is null or p_target not in ('website_architecture','keyword_strategy','content_calendar') then
    raise exception 'Unsupported import target' using errcode='22023';
  end if;
  select * into engagement from public.engagements e where e.id=p_engagement and e.project_id=p_project
    and e.organization_id=p_org and e.status<>'cancelled' for share;
  if not found then raise exception 'Exact active project engagement required' using errcode='42501'; end if;
  if p_target<>'content_calendar' and not private.can_edit_content_artifacts(p_org,p_actor) then
    raise exception 'Current Content draft authority required' using errcode='42501';
  end if;
  if p_target='content_calendar' then perform private.n1c_require_scope(p_org,p_project,p_actor); end if;
  perform 1 from public.engagement_services s join public.service_catalog c on c.id=s.service_id and c.organization_id=s.organization_id
    where s.organization_id=p_org and s.engagement_id=p_engagement and s.status='active' and c.is_active and c.department_id=department
    for share of s,c;
  if not found then raise exception 'Current scoped service required' using errcode='42501'; end if;
  return engagement;
end; $$;

create function public.save_project_chat_import_proposal(
  p_org uuid,p_conversation uuid,p_actor uuid,p_attachment uuid,p_engagement uuid,p_target text,
  p_request uuid,p_artifact uuid,p_parent uuid,p_payload jsonb,p_preview jsonb,p_source_receipt jsonb
) returns jsonb language plpgsql security invoker set search_path='' as $$
declare conversation public.department_chat_conversations; attachment public.department_chat_attachments;
  proposal public.department_chat_proposals; root public.artifacts; sha text; row jsonb;
begin
  conversation:=private.require_owned_project_import_chat(p_conversation,p_org,p_actor);
  perform private.require_project_import_target(p_org,conversation.project_id,p_engagement,p_actor,p_target);
  select * into attachment from public.department_chat_attachments where id=p_attachment and organization_id=p_org
    and conversation_id=conversation.id and uploaded_by=p_actor and source_kind='project_spreadsheet' and status='reference_only' for share;
  if not found then raise exception 'Verified owned private source required' using errcode='42501'; end if;
  if p_request is null or p_payload is null or jsonb_typeof(p_payload)<>'object' or octet_length(p_payload::text)>80000
    or p_preview is null or jsonb_typeof(p_preview)<>'object' or octet_length(p_preview::text)>80000
    or p_source_receipt is null or jsonb_typeof(p_source_receipt)<>'object' or octet_length(p_source_receipt::text)>80000
    or p_source_receipt->>'origin' is distinct from 'spreadsheet_import'
    or p_source_receipt->>'attachment_id' is distinct from p_attachment::text
    or coalesce(p_source_receipt->>'batch_sha256','') !~ '^[0-9a-f]{64}$'
    or jsonb_typeof(p_source_receipt->'rows') is distinct from 'array'
    or jsonb_array_length(p_source_receipt->'rows') not between 1 and 25 then
    raise exception 'Bounded exact import proposal and provenance required' using errcode='22023';
  end if;
  for row in select value from jsonb_array_elements(p_source_receipt->'rows') loop
    if coalesce(row->>'row_id','') !~ '^[0-9a-f]{64}$' or row->'source'->>'fileSha256' is distinct from attachment.sha256_hex
      or row->'source'->>'fileName' is distinct from attachment.original_name
      or coalesce(row->'source'->>'sheet','')='' or coalesce(row->'source'->>'row','') !~ '^[1-9][0-9]*$'
      or (row->'source'->>'row')::bigint<2 then raise exception 'Exact source file/sheet/row required' using errcode='22023'; end if;
  end loop;
  if (select count(distinct value->>'row_id') from jsonb_array_elements(p_source_receipt->'rows'))<>jsonb_array_length(p_source_receipt->'rows') then
    raise exception 'Duplicate import row identity' using errcode='22023';
  end if;
  if p_target='content_calendar' then
    if p_artifact is not null or p_parent is not null or jsonb_typeof(p_payload->'rows') is distinct from 'array'
      or jsonb_array_length(p_payload->'rows')<>jsonb_array_length(p_source_receipt->'rows') then
      raise exception 'Exact bounded calendar row commands required' using errcode='22023';
    end if;
    if (select count(distinct value->>'row_id') from jsonb_array_elements(p_payload->'rows'))<>jsonb_array_length(p_source_receipt->'rows')
      or exists(select 1 from jsonb_array_elements(p_payload->'rows') r where
        not exists(select 1 from jsonb_array_elements(p_source_receipt->'rows') s where s->>'row_id'=r->>'row_id')
        or r-array['row_id','record_kind','record_id','expected_row_version','start_date','due_date','action']<>'{}'::jsonb) then
      raise exception 'Calendar commands must match the exact reviewed source rows' using errcode='22023';
    end if;
  else
    if jsonb_typeof(p_payload->'content') is distinct from 'object' or coalesce(btrim(p_payload->>'title'),'')='' or char_length(p_payload->>'title')>240
      or p_payload->>'expected_parent_version_id' is distinct from p_parent::text then
      raise exception 'Exact unapproved artifact draft required' using errcode='22023';
    end if;
    if p_artifact is not null then
      select * into root from public.artifacts where id=p_artifact and organization_id=p_org and project_id=conversation.project_id
        and engagement_id=p_engagement and artifact_type=p_target for share;
      if not found or p_parent is null or not exists(select 1 from public.artifact_versions v where v.id=p_parent and v.artifact_id=root.id and v.organization_id=p_org) then
        raise exception 'Exact same-project artifact/version required' using errcode='42501'; end if;
    elsif p_parent is not null then raise exception 'New root cannot claim a parent' using errcode='22023'; end if;
  end if;
  sha:=encode(sha256(convert_to(jsonb_build_object('org',p_org,'conversation',conversation.id,'actor',p_actor,'attachment',p_attachment,
    'engagement',p_engagement,'target',p_target,'artifact',p_artifact,'parent',p_parent,'payload',p_payload,'preview',p_preview,'source',p_source_receipt)::text,'UTF8')),'hex');
  perform pg_advisory_xact_lock(hashtextextended(p_org::text||':project-import:'||p_request::text,0));
  select * into proposal from public.department_chat_proposals where idempotency_key=p_request;
  if found then
    if proposal.proposal_origin<>'spreadsheet_import' or proposal.proposer_id<>p_actor or proposal.organization_id<>p_org
      or proposal.context_checksum<>sha then raise exception 'Import request UUID has different original input' using errcode='23505'; end if;
  else
    insert into public.department_chat_proposals(organization_id,project_id,engagement_id,proposer_id,proposal_kind,target_key,artifact_id,
      validated_payload,preview_payload,context_checksum,database_context_checksum,idempotency_key,conversation_id,conversation_owner_id,
      proposal_origin,import_attachment_id,import_source_receipt)
    values(p_org,conversation.project_id,p_engagement,p_actor,'spreadsheet_import',p_target,p_artifact,p_payload,p_preview,sha,sha,p_request,
      conversation.id,conversation.owner_id,'spreadsheet_import',p_attachment,p_source_receipt) returning * into proposal;
  end if;
  return jsonb_build_object('proposal_id',proposal.id,'request_id',proposal.idempotency_key,'project_id',proposal.project_id,
    'conversation_id',proposal.conversation_id,'actor_id',proposal.proposer_id,'review_sha256',proposal.context_checksum,
    'status',proposal.status,'expires_at',proposal.expires_at,'preview',proposal.preview_payload,'provider_request_made',false,'canonical_write_made',false);
end; $$;

create function public.get_project_chat_import_proposal(p_org uuid,p_conversation uuid,p_actor uuid,p_request uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare conversation public.department_chat_conversations; proposal public.department_chat_proposals;
begin
  conversation:=private.require_owned_project_import_chat(p_conversation,p_org,p_actor);
  select * into proposal from public.department_chat_proposals where idempotency_key=p_request and organization_id=p_org
    and conversation_id=conversation.id and proposer_id=p_actor and proposal_origin='spreadsheet_import';
  if not found then return null; end if;
  return jsonb_build_object('proposal_id',proposal.id,'request_id',proposal.idempotency_key,'organization_id',proposal.organization_id,
    'project_id',proposal.project_id,'conversation_id',proposal.conversation_id,'actor_id',proposal.proposer_id,'review_sha256',proposal.context_checksum,
    'status',proposal.status,'target',proposal.target_key,'preview',proposal.preview_payload,'source_receipt',proposal.import_source_receipt,
    'result',proposal.import_result,'expires_at',proposal.expires_at,'provider_request_made',false);
end; $$;

create function public.confirm_project_chat_import_proposal(
  p_org uuid,p_conversation uuid,p_actor uuid,p_request uuid,p_review_sha256 text
) returns jsonb language plpgsql security invoker set search_path='' as $$
declare conversation public.department_chat_conversations; proposal public.department_chat_proposals;
  engagement public.engagements; root public.artifacts; latest public.artifact_versions; version public.artifact_versions;
  source_root public.artifacts; source_version public.artifact_versions; sha text; result jsonb; rows jsonb:='[]'::jsonb;
  row jsonb; reference jsonb; command jsonb; target_task public.tasks; target_work public.work_items;
  reason text; state text; operation uuid; target_identity uuid; version_number bigint;
begin
  conversation:=private.require_owned_project_import_chat(p_conversation,p_org,p_actor);
  -- Per-project serialization gives deterministic lock ordering for batches and
  -- freezes the root choice, including competing new-root import proposals.
  perform pg_advisory_xact_lock(hashtextextended(p_org::text||':project-import-project:'||conversation.project_id::text,0));
  select * into proposal from public.department_chat_proposals where organization_id=p_org and conversation_id=conversation.id
    and proposer_id=p_actor and idempotency_key=p_request and proposal_origin='spreadsheet_import' for update;
  if not found then raise exception 'Owned import proposal unavailable' using errcode='42501'; end if;
  if p_review_sha256 is null or p_review_sha256 is distinct from proposal.context_checksum then
    raise exception 'Confirm the exact original reviewed import' using errcode='40001'; end if;
  engagement:=private.require_project_import_target(p_org,conversation.project_id,proposal.engagement_id,p_actor,proposal.target_key);
  if proposal.status='accepted' then return proposal.import_result||jsonb_build_object('replayed',true); end if;
  if proposal.status<>'pending' then return jsonb_build_object('status',proposal.status,'proposal_id',proposal.id); end if;
  if proposal.expires_at<=now() then
    update public.department_chat_proposals set status='expired',decided_by=p_actor,decided_at=now(),failure_reason='proposal_expired' where id=proposal.id;
    return jsonb_build_object('status','expired','proposal_id',proposal.id);
  end if;
  if proposal.target_key='content_calendar' then
    if jsonb_array_length(proposal.validated_payload->'rows') not between 1 and 25 then raise exception 'Bounded calendar commands required' using errcode='22023'; end if;
    for row in select value from jsonb_array_elements(proposal.validated_payload->'rows') loop
      -- Independent subtransaction: a failed row cannot leave orphan changes.
      -- Results are frozen on this proposal; retry requires fresh review of only
      -- failed rows, never a repeat of a successful original row.
      begin
        select value into reference from jsonb_array_elements(proposal.import_source_receipt->'rows') where value->>'row_id'=row->>'row_id';
        if reference is null or coalesce(row->>'row_id','') !~ '^[0-9a-f]{64}$'
          or coalesce(row->>'record_kind','') not in ('project_task','engagement_work_item')
          or coalesce(row->>'action','') not in ('update','skip')
          or coalesce(row->>'expected_row_version','') !~ '^[1-9][0-9]*$' then
          raise exception 'Exact reviewed calendar row required' using errcode='22023';
        end if;
        target_identity:=(row->>'record_id')::uuid;
        -- Deterministic row operation identity, scoped to the original private
        -- proposal rather than a browser-created provider/job identifier.
        sha:=md5(proposal.id::text||':'||(row->>'row_id'));
        operation:=(substr(sha,1,8)||'-'||substr(sha,9,4)||'-4'||substr(sha,14,3)||'-8'||substr(sha,18,3)||'-'||substr(sha,21,12))::uuid;
        if row->>'action'='skip' then
          if row->>'record_kind'='project_task' then
            select * into target_task from public.tasks where id=target_identity and organization_id=p_org
              and project_id=proposal.project_id and department_id='marketing' and archived_at is null for share;
            if not found or (private.n1c_can_assign_department(p_org,proposal.project_id,'marketing',p_actor)
              or target_task.user_id=p_actor or target_task.assigned_to=p_actor) is not true then
              raise exception 'Current calendar target authority required' using errcode='42501'; end if;
            if target_task.row_version<>(row->>'expected_row_version')::bigint or target_task.due_date is distinct from (row->>'due_date')::date
              or row->>'start_date' is not null then raise exception 'Skipped row changed; review again' using errcode='40001'; end if;
            version_number:=target_task.row_version;
          else
            select * into target_work from public.work_items where id=target_identity and organization_id=p_org and project_id=proposal.project_id
              and engagement_id=proposal.engagement_id and department_id='marketing' and deleted_at is null for share;
            if not found or (private.n1c_can_assign_department(p_org,proposal.project_id,'marketing',p_actor)
              or target_work.created_by=p_actor or target_work.assignee_id=p_actor) is not true then
              raise exception 'Current calendar target authority required' using errcode='42501'; end if;
            if target_work.row_version<>(row->>'expected_row_version')::bigint or target_work.due_date is distinct from (row->>'due_date')::date
              or target_work.start_date is distinct from (row->>'start_date')::date then raise exception 'Skipped row changed; review again' using errcode='40001'; end if;
            version_number:=target_work.row_version;
          end if;
          command:=jsonb_build_object('record_id',target_identity,'row_version',version_number);
        else
          command:=public.schedule_marketing_calendar_entry(p_org,proposal.project_id,proposal.engagement_id,operation,
            row->>'record_kind',target_identity,(row->>'expected_row_version')::bigint,(row->>'start_date')::date,(row->>'due_date')::date,p_actor);
        end if;
        rows:=rows||jsonb_build_array(jsonb_build_object('row_id',row->>'row_id','action',row->>'action','outcome','verified','result',command));
      exception when others then
        get stacked diagnostics state=returned_sqlstate;
        -- Keep diagnostic content out of retained receipts: error code only.
        rows:=rows||jsonb_build_array(jsonb_build_object('row_id',row->>'row_id','outcome','error','error_code',state,'requires_fresh_review',true));
      end;
    end loop;
  else
    -- Recheck exact parent under the canonical root lock; no latest substitution.
    if proposal.artifact_id is not null then
      select * into root from public.artifacts where id=proposal.artifact_id and organization_id=p_org and project_id=proposal.project_id
        and engagement_id=proposal.engagement_id and artifact_type=proposal.target_key for update;
      if not found then raise exception 'Exact canonical root unavailable' using errcode='42501'; end if;
      select * into latest from public.artifact_versions where artifact_id=root.id and organization_id=p_org order by version_number desc limit 1;
      if latest.id::text is distinct from proposal.validated_payload->>'expected_parent_version_id' then
        raise exception 'Newer canonical work exists; review again' using errcode='40001'; end if;
    else
      if exists(select 1 from public.artifacts where organization_id=p_org and project_id=proposal.project_id
        and engagement_id=proposal.engagement_id and artifact_type=proposal.target_key) then
        raise exception 'Existing canonical root found; explicitly select and review it' using errcode='40001'; end if;
    end if;
    if proposal.target_key='keyword_strategy' then
      select * into source_version from public.artifact_versions where id=(proposal.validated_payload->'content'->>'source_architecture_version_id')::uuid and organization_id=p_org;
      select * into source_root from public.artifacts where id=source_version.artifact_id and organization_id=p_org and project_id=proposal.project_id
        and engagement_id=proposal.engagement_id and artifact_type='website_architecture' for share;
      if not found then raise exception 'Exact project keyword target architecture required' using errcode='42501'; end if;
      if exists(select 1 from jsonb_array_elements(proposal.validated_payload->'content'->'keywords') k where k->>'target_kind'='page'
        and not exists(select 1 from jsonb_array_elements(source_version.content->'pages') page where page->>'page_key'=k->>'target_page_key')) then
        raise exception 'Keyword target outside exact project architecture' using errcode='42501'; end if;
    end if;
    if root.id is null then
      insert into public.artifacts(organization_id,project_id,brand_id,engagement_id,artifact_type,title,created_by)
        values(p_org,proposal.project_id,engagement.brand_id,proposal.engagement_id,proposal.target_key,proposal.validated_payload->>'title',p_actor) returning * into root;
    end if;
    sha:=encode(sha256(convert_to((proposal.validated_payload->'content')::text,'UTF8')),'hex');
    if latest.id is not null and latest.content_checksum=sha then version:=latest;
    else
      insert into public.artifact_versions(organization_id,artifact_id,version_number,parent_version_id,content,content_checksum,
        change_summary,ai_use_allowed,data_classification,created_by)
      values(p_org,root.id,coalesce(latest.version_number,0)+1,latest.id,proposal.validated_payload->'content',sha,
        'Reviewed spreadsheet import; unapproved draft',false,'internal',p_actor) returning * into version;
    end if;
    for reference in select value from jsonb_array_elements(proposal.import_source_receipt->'rows') loop
      rows:=rows||jsonb_build_array(jsonb_build_object('row_id',reference->>'row_id','action',reference->>'action','outcome','verified',
        'result',jsonb_build_object('artifact_id',root.id,'artifact_version_id',version.id,'unapproved',true)));
    end loop;
    insert into public.engagement_events(organization_id,engagement_id,event_type,actor_id,payload)
      values(p_org,proposal.engagement_id,'artifact_draft_proposed_via_chat',p_actor,jsonb_build_object('record_type','artifact','record_id',root.id,
        'version_id',version.id,'source','project_chat_import','action','confirmed_import_draft','proposal_id',proposal.id));
  end if;
  result:=jsonb_build_object('proposal_id',proposal.id,'request_id',proposal.idempotency_key,'organization_id',p_org,'project_id',proposal.project_id,
    'conversation_id',proposal.conversation_id,'actor_id',p_actor,'review_sha256',proposal.context_checksum,'rows',rows,
    'approval_created',false,'publication_authorized',false,'provider_request_made',false,'replayed',false);
  update public.department_chat_proposals set status='accepted',decided_by=p_actor,decided_at=now(),
    accepted_artifact_id=root.id,accepted_artifact_version_id=version.id,import_result=result where id=proposal.id;
  return result;
end; $$;

revoke all on function private.guard_project_import_proposal(),private.require_project_import_target(uuid,uuid,uuid,uuid,text),
  public.save_project_chat_import_proposal(uuid,uuid,uuid,uuid,uuid,text,uuid,uuid,uuid,jsonb,jsonb,jsonb),
  public.get_project_chat_import_proposal(uuid,uuid,uuid,uuid),public.confirm_project_chat_import_proposal(uuid,uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function private.guard_project_import_proposal(),private.require_project_import_target(uuid,uuid,uuid,uuid,text),
  public.save_project_chat_import_proposal(uuid,uuid,uuid,uuid,uuid,text,uuid,uuid,uuid,jsonb,jsonb,jsonb),
  public.get_project_chat_import_proposal(uuid,uuid,uuid,uuid),public.confirm_project_chat_import_proposal(uuid,uuid,uuid,uuid,text) to service_role;
commit;
