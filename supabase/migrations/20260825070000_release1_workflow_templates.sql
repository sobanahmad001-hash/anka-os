-- Anka Sphere OS - Phase 2 / Migration 7
-- Seed versioned Release 1 workflow templates and human quality criteria.

begin;

-- Project scoping keeps dependency reads efficient and makes cross-project
-- dependency mistakes directly verifiable.
alter table public.task_dependencies
  add column if not exists project_id uuid references public.projects(id) on delete cascade;

update public.task_dependencies dependency
set project_id = task.project_id
from public.tasks task
where task.id = dependency.task_id
  and dependency.project_id is null;

alter table public.task_dependencies
  alter column project_id set not null;

create index if not exists idx_task_dependencies_project
  on public.task_dependencies(project_id, task_id);

create or replace function private.enforce_task_dependency_scope()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  task_project uuid;
  upstream_project uuid;
begin
  select project_id into task_project from public.tasks where id = new.task_id;
  select project_id into upstream_project from public.tasks where id = new.depends_on_task_id;
  if task_project is null or upstream_project is null
     or task_project <> upstream_project or new.project_id <> task_project then
    raise exception 'Task dependencies must remain inside one project.'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

revoke all on function private.enforce_task_dependency_scope()
  from public, anon, authenticated;
grant execute on function private.enforce_task_dependency_scope()
  to service_role;

drop trigger if exists trg_enforce_task_dependency_scope on public.task_dependencies;
create trigger trg_enforce_task_dependency_scope
before insert or update on public.task_dependencies
for each row execute function private.enforce_task_dependency_scope();

insert into public.workflow_templates (id, name, slug, description, template_kind, version, is_active)
values
  ('71000000-0000-4000-8000-000000000001', 'Custom engagement', 'custom', 'A flexible discovery, production, quality, and delivery workflow.', 'general', 1, true),
  ('71000000-0000-4000-8000-000000000002', 'Branding', 'branding', 'Research, strategy, verbal identity, visual identity, and brand system approval.', 'branding', 1, true),
  ('71000000-0000-4000-8000-000000000003', 'Website delivery', 'website-delivery', 'Research, content, UX/UI, development, QA, launch, and growth handoff.', 'website_delivery', 1, true),
  ('71000000-0000-4000-8000-000000000004', 'Marketing campaign', 'campaign', 'Campaign research, strategy, content, creative, launch, measurement, and learning.', 'marketing', 1, true)
on conflict (organization_id, slug, version) do update set
  name = excluded.name,
  description = excluded.description,
  template_kind = excluded.template_kind,
  is_active = excluded.is_active,
  archived_at = null;

insert into public.workflow_stages (
  id, workflow_template_id, department_id, name, stage_key, position,
  instructions, entry_criteria, exit_criteria, requires_internal_review
)
values
  ('72000000-0000-4000-8000-000000000001', '71000000-0000-4000-8000-000000000001', null, 'Discovery & brief', 'discovery', 0, 'Confirm the objective, audience, scope, owners, evidence, and definition of done.', '["Client or internal brief exists"]', '["Scope and acceptance criteria recorded", "Required workstreams activated"]', true),
  ('72000000-0000-4000-8000-000000000002', '71000000-0000-4000-8000-000000000001', null, 'Production', 'production', 1, 'Produce the agreed work using the activated workstreams.', '["Brief passed internal review"]', '["Completion evidence attached", "Dependencies resolved"]', false),
  ('72000000-0000-4000-8000-000000000003', '71000000-0000-4000-8000-000000000001', null, 'Quality & delivery', 'quality-delivery', 2, 'Run internal quality review and release only the approved exact version.', '["Production output versioned"]', '["Human quality decision recorded", "Released output matches reviewed version"]', true),

  ('72000000-0000-4000-8000-000000000011', '71000000-0000-4000-8000-000000000002', null, 'Research & discovery', 'research', 0, 'Capture audience, market, competitor, stakeholder, and brand evidence.', '["Discovery inputs available"]', '["Sources recorded", "Findings and recommendation reviewed"]', true),
  ('72000000-0000-4000-8000-000000000012', '71000000-0000-4000-8000-000000000002', 'content', 'Brand strategy & verbal identity', 'verbal-identity', 1, 'Define positioning, promise, messaging hierarchy, voice, and naming language.', '["Research approved"]', '["Positioning differentiated", "Messaging matches evidence", "Voice examples included"]', true),
  ('72000000-0000-4000-8000-000000000013', '71000000-0000-4000-8000-000000000002', 'design', 'Visual identity system', 'visual-identity', 2, 'Create the identity concept, core system, and representative applications.', '["Strategy and verbal direction approved internally"]', '["Identity is distinctive", "System works across required formats", "Accessibility checked"]', true),
  ('72000000-0000-4000-8000-000000000014', '71000000-0000-4000-8000-000000000002', null, 'Brand system delivery', 'brand-delivery', 3, 'Unify verbal and visual outputs into the final controlled brand system.', '["Verbal and visual versions passed internal review"]', '["Brand guide complete", "Source files organized", "Released version recorded"]', true),

  ('72000000-0000-4000-8000-000000000021', '71000000-0000-4000-8000-000000000003', null, 'Website discovery & architecture', 'website-discovery', 0, 'Confirm goals, users, sitemap, content requirements, integrations, and technical constraints.', '["Project scope recorded"]', '["Sitemap approved internally", "Page inventory and acceptance criteria complete"]', true),
  ('72000000-0000-4000-8000-000000000022', '71000000-0000-4000-8000-000000000003', 'content', 'Website content', 'website-content', 1, 'Produce page messaging, proof, CTAs, metadata, and structured content.', '["Page inventory exists"]', '["Every required page has reviewed content", "SEO intent and claims checked"]', true),
  ('72000000-0000-4000-8000-000000000023', '71000000-0000-4000-8000-000000000003', 'design', 'UX & visual design', 'website-design', 2, 'Design responsive page systems based on approved architecture and content.', '["Architecture available", "Priority content available"]', '["Responsive states covered", "Accessibility reviewed", "Components documented"]', true),
  ('72000000-0000-4000-8000-000000000024', '71000000-0000-4000-8000-000000000003', 'development', 'Build & integration', 'website-build', 3, 'Implement the approved design, content, integrations, analytics, and environments.', '["Design version approved internally"]', '["Acceptance criteria pass", "No exposed credentials", "Content matches approved source"]', true),
  ('72000000-0000-4000-8000-000000000025', '71000000-0000-4000-8000-000000000003', 'development', 'QA & launch', 'website-launch', 4, 'Complete functional, responsive, accessibility, performance, SEO, backup, and launch checks.', '["Build complete on staging"]', '["QA evidence recorded", "Rollback path confirmed", "Launch authorized by a human"]', true),
  ('72000000-0000-4000-8000-000000000026', '71000000-0000-4000-8000-000000000003', 'marketing', 'Launch distribution & learning', 'website-growth', 5, 'Distribute the launch and record baseline performance and follow-up actions.', '["Production launch confirmed"]', '["Tracking verified", "Distribution complete", "Initial learning recorded"]', false),

  ('72000000-0000-4000-8000-000000000031', '71000000-0000-4000-8000-000000000004', 'marketing', 'Campaign research & strategy', 'campaign-strategy', 0, 'Define audience, insight, objective, offer, channels, measurement, and constraints.', '["Business objective provided"]', '["Audience and channel rationale evidenced", "KPIs and guardrails recorded"]', true),
  ('72000000-0000-4000-8000-000000000032', '71000000-0000-4000-8000-000000000004', 'content', 'Campaign messaging & content', 'campaign-content', 1, 'Build the message system and channel-specific copy from the approved strategy.', '["Campaign strategy approved internally"]', '["Claims checked", "Voice consistent", "Required variants complete"]', true),
  ('72000000-0000-4000-8000-000000000033', '71000000-0000-4000-8000-000000000004', 'design', 'Campaign creative production', 'campaign-creative', 2, 'Produce the creative system and required channel variants.', '["Messaging direction available"]', '["All formats covered", "Brand and platform checks pass", "Files versioned"]', true),
  ('72000000-0000-4000-8000-000000000034', '71000000-0000-4000-8000-000000000004', 'marketing', 'Launch & optimization', 'campaign-launch', 3, 'Complete human launch authorization, monitor delivery, and propose optimizations.', '["Content and creative passed quality review"]', '["Launch evidence recorded", "Spend changes human-approved", "Issues triaged"]', true),
  ('72000000-0000-4000-8000-000000000035', '71000000-0000-4000-8000-000000000004', 'marketing', 'Reporting & learning', 'campaign-learning', 4, 'Report performance against objectives and preserve reusable learning.', '["Reporting period complete"]', '["Source metrics linked", "Insights separated from facts", "Next actions confirmed"]', true)
on conflict (workflow_template_id, stage_key) do update set
  department_id = excluded.department_id,
  name = excluded.name,
  position = excluded.position,
  instructions = excluded.instructions,
  entry_criteria = excluded.entry_criteria,
  exit_criteria = excluded.exit_criteria,
  requires_internal_review = excluded.requires_internal_review;

commit;
