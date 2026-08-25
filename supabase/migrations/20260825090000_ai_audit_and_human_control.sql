-- Anka Sphere OS - Phase 5 / Migration 9
-- Permission-scoped AI run audit, budget metadata, and human decisions.

begin;

create table if not exists public.ai_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null
    default '8a6d2c5e-2c99-4ec7-a92f-6d1bd877eb25'::uuid
    references public.organizations(id) on delete restrict,
  project_id uuid references public.projects(id) on delete set null,
  user_id uuid not null references auth.users(id) on delete restrict,
  capability text not null check (capability in (
    'project_pulse', 'daily_brief', 'research_support',
    'writing_support', 'quality_review', 'action_proposal'
  )),
  status text not null check (status in ('completed', 'failed', 'blocked')),
  provider text,
  model text,
  input_text text not null default '',
  output_text text not null default '',
  context_manifest jsonb not null default '{}'::jsonb,
  proposed_action jsonb,
  latency_ms integer check (latency_ms is null or latency_ms >= 0),
  input_tokens integer check (input_tokens is null or input_tokens >= 0),
  output_tokens integer check (output_tokens is null or output_tokens >= 0),
  estimated_cost_microusd bigint check (
    estimated_cost_microusd is null or estimated_cost_microusd >= 0
  ),
  human_decision text not null default 'not_applicable' check (human_decision in (
    'not_applicable', 'pending', 'accepted', 'rejected'
  )),
  decision_outcome text not null default '',
  decided_by uuid references auth.users(id) on delete restrict,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  redacted_at timestamptz,
  check (
    (human_decision in ('not_applicable', 'pending') and decided_by is null and decided_at is null)
    or (human_decision in ('accepted', 'rejected') and decided_by is not null and decided_at is not null)
  ),
  check (
    (capability = 'action_proposal' and proposed_action is not null)
    or (capability <> 'action_proposal' and proposed_action is null)
    or status <> 'completed'
  )
);

create index if not exists idx_ai_runs_user_created
  on public.ai_runs(user_id, created_at desc)
  where redacted_at is null;
create index if not exists idx_ai_runs_project_created
  on public.ai_runs(project_id, created_at desc)
  where project_id is not null and redacted_at is null;
create index if not exists idx_ai_runs_cost_window
  on public.ai_runs(organization_id, created_at, estimated_cost_microusd)
  where status = 'completed';
create index if not exists idx_ai_runs_pending_decisions
  on public.ai_runs(user_id, created_at desc)
  where human_decision = 'pending' and redacted_at is null;

alter table public.ai_runs enable row level security;

create policy "Users can read own AI runs"
  on public.ai_runs for select to authenticated
  using (
    redacted_at is null
    and user_id = (select auth.uid())
    and public.is_team_organization_member(organization_id)
  );

create policy "Leaders can audit organization AI runs"
  on public.ai_runs for select to authenticated
  using (
    redacted_at is null
    and public.has_organization_role(
      organization_id,
      array['system_owner', 'operations_admin', 'executive']
    )
  );

revoke all on public.ai_runs from anon, authenticated;
grant select on public.ai_runs to authenticated;
grant all on public.ai_runs to service_role;

commit;
