-- Read-only verification for Migration 7.

select jsonb_pretty(jsonb_build_object(
  'migration', '20260825070000_release1_workflow_templates',
  'active_template_count', (
    select count(*) from public.workflow_templates
    where slug in ('custom', 'branding', 'website-delivery', 'campaign')
      and version = 1 and is_active = true
  ),
  'stage_count', (
    select count(*) from public.workflow_stages stage
    join public.workflow_templates template on template.id = stage.workflow_template_id
    where template.slug in ('custom', 'branding', 'website-delivery', 'campaign')
      and template.version = 1
  ),
  'review_stage_count', (
    select count(*) from public.workflow_stages stage
    join public.workflow_templates template on template.id = stage.workflow_template_id
    where template.slug in ('custom', 'branding', 'website-delivery', 'campaign')
      and template.version = 1
      and stage.requires_internal_review = true
  ),
  'stages_missing_exit_criteria', (
    select count(*) from public.workflow_stages stage
    join public.workflow_templates template on template.id = stage.workflow_template_id
    where template.slug in ('custom', 'branding', 'website-delivery', 'campaign')
      and template.version = 1
      and jsonb_array_length(stage.exit_criteria) = 0
  ),
  'dependency_project_column_not_null', (
    select attnotnull from pg_attribute
    where attrelid = 'public.task_dependencies'::regclass
      and attname = 'project_id'
  ),
  'dependency_scope_trigger', exists (
    select 1 from pg_trigger
    where tgrelid = 'public.task_dependencies'::regclass
      and tgname = 'trg_enforce_task_dependency_scope'
      and not tgisinternal
  )
)) as verification_result;
