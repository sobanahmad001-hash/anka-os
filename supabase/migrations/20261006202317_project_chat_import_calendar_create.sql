-- Approved new entries: canonical unassigned Marketing Work Items only.
-- Extends importer functions; no provider/model functions or new tables.
begin;
create or replace function public.save_project_chat_import_proposal(
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
        or r-array['row_id','record_kind','record_id','expected_row_version','start_date','due_date','action','calendar_key','title']<>'{}'::jsonb) then
      raise exception 'Calendar commands must match the exact reviewed source rows' using errcode='22023';
    end if;
    if exists(select 1 from jsonb_array_elements(p_payload->'rows') r where r->>'action'='create' and (
      r->>'record_kind' is distinct from 'engagement_work_item' or r->>'record_id' is not null or r->>'expected_row_version' is not null
      or coalesce(r->>'calendar_key','') !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$'
      or coalesce(btrim(r->>'title'),'')='' or char_length(r->>'title')>200
      or not exists(select 1 from jsonb_array_elements(p_source_receipt->'rows') s where s->>'row_id'=r->>'row_id' and s->>'identity'='calendar:'||(r->>'calendar_key'))))
      or (select count(*) from jsonb_array_elements(p_payload->'rows') r where r->>'action'='create')
        <> (select count(distinct r->>'calendar_key') from jsonb_array_elements(p_payload->'rows') r where r->>'action'='create') then
      raise exception 'Distinct reviewed stable calendar create identities required' using errcode='22023'; end if;
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

create or replace function public.confirm_project_chat_import_proposal(
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
          or coalesce(row->>'action','') not in ('create','update','skip')
          or row->>'action'<>'create' and coalesce(row->>'expected_row_version','') !~ '^[1-9][0-9]*$' then
          raise exception 'Exact reviewed calendar row required' using errcode='22023';
        end if;
        target_identity:=(row->>'record_id')::uuid;
        -- Deterministic row operation identity, scoped to the original private
        -- proposal rather than a browser-created provider/job identifier.
        sha:=md5(proposal.id::text||':'||(row->>'row_id'));
        operation:=(substr(sha,1,8)||'-'||substr(sha,9,4)||'-4'||substr(sha,14,3)||'-8'||substr(sha,18,3)||'-'||substr(sha,21,12))::uuid;
        if row->>'action'='create' then
          if row->>'record_kind' is distinct from 'engagement_work_item' or target_identity is not null or row->>'expected_row_version' is not null
            or coalesce(row->>'calendar_key','') !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$'
            or reference->>'identity' is distinct from 'calendar:'||(row->>'calendar_key')
            or coalesce(btrim(row->>'title'),'')='' or char_length(row->>'title')>200 then
            raise exception 'Exact reviewed unassigned Marketing create required' using errcode='22023'; end if;
          -- Same project lock serializes different proposals. Successful private
          -- receipts retain import identity without a competing canonical store.
          if exists(select 1 from public.department_chat_proposals prior,
            lateral jsonb_array_elements(prior.import_source_receipt->'rows') source,
            lateral jsonb_array_elements(prior.import_result->'rows') outcome
            where prior.organization_id=p_org and prior.project_id=proposal.project_id and prior.engagement_id=proposal.engagement_id
              and prior.proposal_origin='spreadsheet_import' and prior.target_key='content_calendar' and prior.status='accepted'
              and source->>'identity'=reference->>'identity' and outcome->>'row_id'=source->>'row_id'
              and outcome->>'action'='create' and outcome->>'outcome'='verified')
            or exists(select 1 from public.work_items w where w.organization_id=p_org and w.project_id=proposal.project_id
              and w.engagement_id=proposal.engagement_id and w.department_id='marketing' and w.deleted_at is null
              and lower(btrim(w.title))=lower(btrim(row->>'title'))) then
            raise exception 'Possible existing calendar identity; reload and review canonical match' using errcode='40001'; end if;
          if row->>'start_date' is not null and row->>'due_date' is not null and (row->>'start_date')::date>(row->>'due_date')::date then
            raise exception 'Reviewed schedule order invalid' using errcode='22023'; end if;
          target_work:=public.save_work_item(
            p_work_item_id=>null,p_engagement_id=>proposal.engagement_id,p_title=>btrim(row->>'title'),
            p_description=>'Created from reviewed Project Chat calendar import. Historical evidence remains in the private import receipt.',
            p_work_item_type=>'task',p_priority=>'medium',p_status=>'not_started',p_assignee_id=>null,p_department_id=>'marketing',
            p_linked_artifact_id=>null,p_linked_artifact_version_id=>null,p_linked_engagement_stage_instance_id=>null,
            p_start_date=>(row->>'start_date')::date,p_due_date=>(row->>'due_date')::date,p_position=>0,p_parent_work_item_id=>null,
            p_actor_id=>p_actor,p_created_via=>'manual');
          command:=jsonb_build_object('record_id',target_work.id,'row_version',target_work.row_version,'record_kind','engagement_work_item',
            'status',target_work.status,'unassigned',target_work.assignee_id is null);
        elsif row->>'action'='skip' then
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

commit;
