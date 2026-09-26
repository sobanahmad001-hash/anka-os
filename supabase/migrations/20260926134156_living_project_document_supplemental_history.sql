-- In-place serializer replacement preserves OID, ACL, public RPC and v1 snapshots.
begin;
set local lock_timeout='5s';
set local statement_timeout='120s';
-- Serialize cutover with source writers before taking any document lock.
lock table public.ai_project_memory, public.comments, public.engagements,
  public.project_pipeline_activations, public.project_pipeline_configurations,
  public.project_service_scopes, public.project_task_change_proposals,
  public.recurring_work_plan_template_items, public.recurring_work_plan_version_approvals,
  public.recurring_work_plan_versions, public.recurring_work_plans in share row exclusive mode;
create index ai_project_memory_source_comment_lookup
  on public.ai_project_memory(organization_id,project_id,source_comment_id);

create or replace function private.build_living_project_snapshot_projection(
  p_organization_id uuid,
  p_project_id uuid,
  p_projection_kind text,
  p_source_version bigint,
  p_generated_at timestamptz
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_project public.projects%rowtype;
  v_projection jsonb;
begin
  select project.* into strict v_project
  from public.projects project
  where project.id = p_project_id and project.organization_id = p_organization_id;

  if p_projection_kind = 'internal' then
    select jsonb_build_object(
      'schema_version', 1,
      'projection_kind', 'internal',
      'generated_at', p_generated_at,
      'source_version', p_source_version,
      'project', jsonb_strip_nulls(jsonb_build_object(
        'id', v_project.id, 'name', v_project.name, 'engagement_type', v_project.engagement_type,
        'status', v_project.status, 'health', v_project.health, 'priority', v_project.priority,
        'start_date', v_project.start_date, 'due_date', v_project.due_date,
        'description', v_project.description, 'scope_statement', v_project.scope_statement,
        'exclusions', v_project.exclusions, 'client_id', v_project.client_id, 'owner_id', v_project.owner_id
      )),
      'progress', jsonb_build_object(
        'workstreams', coalesce((select jsonb_object_agg(bucket.status, bucket.total order by bucket.status)
          from (select coalesce(nullif(row.status::text, ''), 'unknown') status, count(*) total
            from public.workstreams row
            where row.organization_id = p_organization_id and row.project_id = p_project_id
            group by coalesce(nullif(row.status::text, ''), 'unknown')) bucket), '{}'::jsonb),
        'tasks', coalesce((select jsonb_object_agg(bucket.status, bucket.total order by bucket.status)
          from (select coalesce(nullif(row.status::text, ''), 'unknown') status, count(*) total
            from public.tasks row
            where row.organization_id = p_organization_id and row.project_id = p_project_id
              and row.archived_at is null
            group by coalesce(nullif(row.status::text, ''), 'unknown')) bucket), '{}'::jsonb),
        'milestones', coalesce((select jsonb_object_agg(bucket.status, bucket.total order by bucket.status)
          from (select coalesce(nullif(row.status::text, ''), 'unknown') status, count(*) total
            from public.milestones row
            where row.organization_id = p_organization_id and row.project_id = p_project_id
              and row.archived_at is null
            group by coalesce(nullif(row.status::text, ''), 'unknown')) bucket), '{}'::jsonb),
        'deliverables', coalesce((select jsonb_object_agg(bucket.status, bucket.total order by bucket.status)
          from (select coalesce(nullif(row.status::text, ''), 'unknown') status, count(*) total
            from public.deliverables row
            where row.organization_id = p_organization_id and row.project_id = p_project_id
              and row.archived_at is null
            group by coalesce(nullif(row.status::text, ''), 'unknown')) bucket), '{}'::jsonb),
        'requests', coalesce((select jsonb_object_agg(bucket.status, bucket.total order by bucket.status)
          from (select coalesce(nullif(row.status::text, ''), 'unknown') status, count(*) total
            from public.requests row
            where row.organization_id = p_organization_id and row.project_id = p_project_id
              and row.archived_at is null
            group by coalesce(nullif(row.status::text, ''), 'unknown')) bucket), '{}'::jsonb)
      ),
      'workstreams', coalesce((select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
        'id', row.id, 'department_id', row.department_id, 'name', row.name,
        'status', row.status, 'owner_id', row.owner_id
      )) order by row.created_at, row.id) from public.workstreams row
        where row.organization_id = p_organization_id and row.project_id = p_project_id), '[]'::jsonb),
      'tasks', coalesce((select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
        'id', row.id, 'workstream_id', row.workstream_id, 'title', row.title,
        'description', row.description, 'status', row.status, 'priority', row.priority,
        'due_date', row.due_date, 'assigned_to', row.assigned_to,
        'acceptance_criteria', row.acceptance_criteria, 'completion_evidence', row.completion_evidence
      )) order by row.created_at, row.id) from public.tasks row
        where row.organization_id = p_organization_id and row.project_id = p_project_id
          and row.archived_at is null), '[]'::jsonb),
      'dependencies', coalesce((select jsonb_agg(jsonb_strip_nulls(to_jsonb(row)) order by row.created_at, row.id)
        from public.task_dependencies row
        join public.tasks task on task.id = row.task_id
          and task.organization_id = row.organization_id and task.project_id = p_project_id
        join public.tasks prerequisite on prerequisite.id = row.depends_on_task_id
          and prerequisite.organization_id = row.organization_id and prerequisite.project_id = p_project_id
        where row.organization_id = p_organization_id), '[]'::jsonb),
      'milestones', coalesce((select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
        'id', row.id, 'name', row.name, 'description', row.description, 'status', row.status,
        'target_date', row.target_date, 'completed_at', row.completed_at
      )) order by row.position::text, row.id) from public.milestones row
        where row.organization_id = p_organization_id and row.project_id = p_project_id
          and row.archived_at is null), '[]'::jsonb),
      'research', coalesce((select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
        'id', row.id, 'workstream_id', row.workstream_id, 'research_type', row.research_type,
        'title', row.title, 'question', row.question, 'findings', row.findings,
        'recommendation', row.recommendation, 'sources', row.sources,
        'confidence', row.confidence, 'status', row.status
      )) order by row.updated_at desc nulls last, row.id) from public.research_records row
        where row.organization_id = p_organization_id and row.project_id = p_project_id
          and row.archived_at is null), '[]'::jsonb),
      'deliverables', coalesce((select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
        'id', deliverable.id, 'workstream_id', deliverable.workstream_id, 'title', deliverable.title,
        'deliverable_type', deliverable.deliverable_type, 'status', deliverable.status,
        'due_date', deliverable.due_date, 'versions', coalesce((select jsonb_agg(
          jsonb_strip_nulls(jsonb_build_object(
            'id', version.id, 'version_number', version.version_number, 'title', version.title,
            'change_summary', version.change_summary, 'review_status', version.review_status,
            'created_at', version.created_at
          )) order by version.version_number::text, version.id)
          from public.deliverable_versions version
          where version.organization_id = p_organization_id
            and version.project_id = p_project_id and version.deliverable_id = deliverable.id
        ), '[]'::jsonb)
      )) order by deliverable.updated_at desc nulls last, deliverable.id) from public.deliverables deliverable
        where deliverable.organization_id = p_organization_id and deliverable.project_id = p_project_id
          and deliverable.archived_at is null), '[]'::jsonb),
      'requests', coalesce((select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
        'id', row.id, 'request_type', row.request_type, 'request_origin', row.request_origin,
        'title', row.title, 'requested_output', row.requested_output, 'status', row.status,
        'priority', row.priority, 'required_by', row.required_by, 'owner_id', row.owner_id
      )) order by row.updated_at desc nulls last, row.id) from public.requests row
        where row.organization_id = p_organization_id and row.project_id = p_project_id
          and row.archived_at is null), '[]'::jsonb),
      'recent_activity', coalesce((select jsonb_agg(event.payload order by event.occurred_at desc, event.id desc)
        from (select row.id, row.occurred_at, jsonb_strip_nulls(jsonb_build_object(
          'id', row.id, 'action', row.action, 'target_type', row.target_type,
          'target_id', row.target_id, 'metadata', row.metadata,
          'summary', initcap(replace(replace(row.action, '_', ' '), '.', ' ')),
          'actor_id', row.actor_id, 'occurred_at', row.occurred_at
        )) payload from public.activity_events row
        where row.organization_id = p_organization_id and row.project_id = p_project_id
        order by row.occurred_at desc, row.id desc limit 50) event), '[]'::jsonb),
      'recent_activity_is_complete', false
    ) into v_projection;
  elsif p_projection_kind = 'client' then
    select jsonb_build_object(
      'schema_version', 1,
      'projection_kind', 'client',
      'generated_at', p_generated_at,
      'source_version', p_source_version,
      'project', jsonb_strip_nulls(jsonb_build_object(
        'id', v_project.id, 'name', v_project.name, 'engagement_type', v_project.engagement_type,
        'status', v_project.status, 'health', v_project.health, 'priority', v_project.priority,
        'start_date', v_project.start_date, 'due_date', v_project.due_date,
        'summary', v_project.client_summary
      )),
      'progress', jsonb_build_object(
        'visible_workstreams', (select count(*) from public.workstreams row
          where row.organization_id = p_organization_id and row.project_id = p_project_id
            and row.client_visible = true),
        'completed_milestones', (select count(*) from public.milestones row
          where row.organization_id = p_organization_id and row.project_id = p_project_id
            and row.archived_at is null and row.status = 'completed'
            and row.visibility in ('client_visible', 'client_restricted')),
        'released_deliverables', (select count(*) from public.deliverables deliverable
          where deliverable.organization_id = p_organization_id and deliverable.project_id = p_project_id
            and deliverable.archived_at is null and exists (
              select 1 from public.deliverable_versions version
              join public.client_portal_items portal
                on portal.organization_id = version.organization_id
               and portal.project_id = version.project_id
               and portal.source_type = 'deliverable_version'
               and portal.source_id = version.id and portal.withdrawn_at is null
              where version.organization_id = p_organization_id and version.project_id = p_project_id
                and version.deliverable_id = deliverable.id
                and version.review_status in ('client_reviewing', 'revision_requested', 'client_approved', 'delivered_published')
            )),
        'open_client_requests', (select count(*) from public.requests row
          where row.organization_id = p_organization_id and row.project_id = p_project_id
            and row.archived_at is null and row.visibility = 'client_visible'
            and row.status not in ('completed', 'declined', 'withdrawn'))
      ),
      'workstreams', coalesce((select jsonb_agg(jsonb_build_object(
        'name', row.name, 'status', row.status
      ) order by row.created_at, row.id) from public.workstreams row
        where row.organization_id = p_organization_id and row.project_id = p_project_id
          and row.client_visible = true), '[]'::jsonb),
      'milestones', coalesce((select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
        'name', row.name, 'description', row.description, 'status', row.status,
        'target_date', row.target_date, 'completed_at', row.completed_at
      )) order by row.position::text, row.id) from public.milestones row
        where row.organization_id = p_organization_id and row.project_id = p_project_id
          and row.archived_at is null and row.visibility in ('client_visible', 'client_restricted')), '[]'::jsonb),
      'deliverables', coalesce((select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
        'id', deliverable.id, 'title', deliverable.title, 'deliverable_type', deliverable.deliverable_type,
        'status', deliverable.status, 'due_date', deliverable.due_date,
        'versions', versions.items
      )) order by deliverable.updated_at desc nulls last, deliverable.id)
        from public.deliverables deliverable
        cross join lateral (
          select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
            'id', version.id, 'version_number', version.version_number, 'title', version.title,
            'change_summary', version.change_summary, 'review_status', version.review_status,
            'released_at', portal.released_at
          )) order by version.version_number::text, version.id) items
          from public.deliverable_versions version
          join public.client_portal_items portal
            on portal.organization_id = version.organization_id
           and portal.project_id = version.project_id
           and portal.source_type = 'deliverable_version'
           and portal.source_id = version.id and portal.withdrawn_at is null
          where version.organization_id = p_organization_id and version.project_id = p_project_id
            and version.deliverable_id = deliverable.id
            and version.review_status in ('client_reviewing', 'revision_requested', 'client_approved', 'delivered_published')
        ) versions
        where deliverable.organization_id = p_organization_id and deliverable.project_id = p_project_id
          and deliverable.archived_at is null and versions.items is not null), '[]'::jsonb),
      'requests', coalesce((select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
        'id', row.id, 'request_type', row.request_type, 'title', row.title, 'status', row.status,
        'priority', row.priority, 'required_by', row.required_by, 'resolution_summary', row.resolution
      )) order by row.updated_at desc nulls last, row.id) from public.requests row
        where row.organization_id = p_organization_id and row.project_id = p_project_id
          and row.archived_at is null and row.visibility = 'client_visible'), '[]'::jsonb),
      'recent_activity', coalesce((select jsonb_agg(event.payload order by event.occurred_at desc, event.id desc)
        from (select row.id, row.occurred_at, jsonb_strip_nulls(jsonb_build_object(
          'action', row.action,
          'summary', initcap(replace(replace(row.action, '_', ' '), '.', ' ')), 'occurred_at', row.occurred_at
        )) payload from public.activity_events row
        where row.organization_id = p_organization_id and row.project_id = p_project_id
          and row.visibility = 'client_visible'
        order by row.occurred_at desc, row.id desc limit 25) event), '[]'::jsonb),
      'recent_activity_is_complete', false
    ) into v_projection;
  else
    raise exception 'Projection kind must be internal or client.' using errcode = '22023';
  end if;
  if p_projection_kind = 'internal' then
    v_projection := v_projection || jsonb_build_object(
      'schema_version', 2,
      'supplemental', jsonb_build_object(
        'coverage', 'Recorded project services, pipeline, decisions, confirmed sourced preferences and recurring plan versions. Audience is not a separate project field.',
        'services', coalesce((select jsonb_agg(jsonb_build_object(
          'id',s.id,'service_id',s.service_id,'status',s.status,'scope_statement',s.scope_statement,
          'exclusions',s.exclusions,'quantity',s.quantity,'owner_id',s.owner_id,
          'start_date',s.start_date,'target_date',s.target_date,'revision',s.revision,'source',s.source)
          order by s.id) from public.project_service_scopes s
          where s.organization_id=p_organization_id and s.project_id=p_project_id),'[]'::jsonb),
        'engagements', coalesce((select jsonb_agg(jsonb_build_object(
          'id',e.id,'objective',e.objective,'status',e.status,
          'active_configuration',(select jsonb_build_object('id',c.id,'revision',c.revision,
            'definition_publication_id',c.definition_publication_id,'selected_steps',c.selected_steps,
            'selected_steps_sha256',c.selected_steps_sha256,'activated_at',a.activated_at)
            from public.project_pipeline_activations a join public.project_pipeline_configurations c
              on c.id=a.configuration_id and c.organization_id=a.organization_id and c.engagement_id=a.engagement_id
            where a.organization_id=p_organization_id and a.engagement_id=e.id and c.project_id=p_project_id
            order by a.activation_number desc limit 1)) order by e.id)
          from public.engagements e where e.organization_id=p_organization_id and e.project_id=p_project_id),'[]'::jsonb),
        'task_decisions', coalesce((select jsonb_agg(jsonb_build_object(
          'id',p.id,'task_id',p.task_id,'before_status',p.before_status,'proposed_status',p.proposed_status,
          'status',p.status,'source_comment_id',p.source_comment_id,'decided_at',p.decided_at) order by p.id)
          from public.project_task_change_proposals p where p.organization_id=p_organization_id
            and p.project_id=p_project_id and p.status in ('applied','pending','approved_failed')),'[]'::jsonb),
        'confirmed_preferences', coalesce((select jsonb_agg(jsonb_build_object(
          'id',m.id,'statement',m.statement,'source_comment_id',m.source_comment_id,
          'source_sha256',m.source_sha256,'reviewed_at',m.reviewed_at) order by m.id)
          from (select m.id,m.statement,m.source_comment_id,m.source_sha256,m.reviewed_at
            from public.ai_project_memory m join public.comments c on c.id=m.source_comment_id
              and c.organization_id=m.organization_id and c.project_id=m.project_id
              and c.entity_type='project' and c.entity_id=m.project_id and c.visibility='internal_only'
            where m.organization_id=p_organization_id and m.project_id=p_project_id and m.status='confirmed'
              and encode(extensions.digest(convert_to(c.content,'UTF8'),'sha256'),'hex')=m.source_sha256
            order by m.reviewed_at desc,m.id desc limit 50) m),'[]'::jsonb),
        'recurring_plans', coalesce((select jsonb_agg(jsonb_build_object(
          'id',p.id,'status',p.status,'service_id',p.service_id,'approved_version_id',p.approved_version_id,
          'versions',coalesce((select jsonb_agg(jsonb_build_object(
            'id',v.id,'version_number',v.version_number,'title',v.title,'scope',v.scope,
            'frequency',v.frequency,'timezone',v.timezone,'effective_start',v.effective_start,'effective_end',v.effective_end,
            'approved',exists(select 1 from public.recurring_work_plan_version_approvals a
              where a.organization_id=p_organization_id and a.plan_id=p.id and a.plan_version_id=v.id),
            'items',coalesce((select jsonb_agg(jsonb_build_object('id',t.id,'template_key',t.template_key,
              'title',t.title,'department_id',t.department_id,'default_assignee_id',t.default_assignee_id,
              'start_offset_days',t.start_offset_days,'due_offset_days',t.due_offset_days)
              order by t.position,t.id) from public.recurring_work_plan_template_items t
              where t.organization_id=p_organization_id and t.plan_id=p.id and t.plan_version_id=v.id),'[]'::jsonb))
            order by v.version_number,v.id) from public.recurring_work_plan_versions v
            where v.organization_id=p_organization_id and v.plan_id=p.id),'[]'::jsonb)) order by p.id)
          from public.recurring_work_plans p where p.organization_id=p_organization_id and p.project_id=p_project_id),'[]'::jsonb)
      )
    );
  end if;
  return v_projection;
end;
$$;

create function private.invalidate_living_project_supplemental_source()
returns trigger language plpgsql security definer set search_path='' as $$
declare row_data jsonb; org uuid; project uuid; document_id uuid; documents uuid[]:='{}'; source_rows jsonb;
begin
  if TG_OP='UPDATE' and to_jsonb(NEW)=to_jsonb(OLD) then return NEW; end if;
  source_rows:=case TG_OP when 'INSERT' then jsonb_build_array(to_jsonb(NEW))
    when 'DELETE' then jsonb_build_array(to_jsonb(OLD))
    else jsonb_build_array(to_jsonb(OLD),to_jsonb(NEW)) end;
  for row_data in select value from jsonb_array_elements(source_rows) loop
    org:=(row_data->>'organization_id')::uuid;
    project:=(row_data->>'project_id')::uuid;
    if project is null and row_data->>'plan_id' is not null then
      select p.project_id into project from public.recurring_work_plans p
        where p.id=(row_data->>'plan_id')::uuid and p.organization_id=org;
    elsif project is null and row_data->>'engagement_id' is not null then
      select e.project_id into project from public.engagements e
        where e.id=(row_data->>'engagement_id')::uuid and e.organization_id=org;
    end if;
    if TG_TABLE_NAME='comments' and not exists(select 1 from public.ai_project_memory m
        where m.organization_id=org and m.project_id=project and m.source_comment_id=(row_data->>'id')::uuid) then
      continue;
    end if;
    documents:=documents||array(select d.id from public.living_project_documents d
      where d.organization_id=org and d.project_id=project);
  end loop;
  -- Existing writers take project/member locks before source writes. Resolve
  -- both prior/current scopes without additional parent locks, then order all
  -- document locks. No source/parent locks are acquired after these locks.
  for document_id in select distinct value from unnest(documents) as ids(value) order by value loop
    update public.living_project_documents d set source_version=d.source_version+1 where d.id=document_id;
  end loop;
  if TG_OP='DELETE' then return OLD; else return NEW; end if;
end;$$;
revoke all on function private.invalidate_living_project_supplemental_source()
  from public,anon,authenticated,service_role;

do $$
declare source_table text;
begin
  foreach source_table in array array['ai_project_memory','comments','engagements',
    'project_pipeline_activations','project_pipeline_configurations','project_service_scopes',
    'project_task_change_proposals','recurring_work_plan_template_items',
    'recurring_work_plan_version_approvals','recurring_work_plan_versions','recurring_work_plans'] loop
    execute format('create trigger living_document_supplemental_source after insert or update or delete on public.%I for each row execute function private.invalidate_living_project_supplemental_source()',source_table);
  end loop;
end;
$$;

-- A new source version avoids deduplication against an existing v1 checkpoint.
-- Stored snapshot JSON and request replay receipts are never rewritten.
with locked as materialized (select id from public.living_project_documents order by id for update)
update public.living_project_documents d set source_version=d.source_version+1
from locked where locked.id=d.id;
commit;