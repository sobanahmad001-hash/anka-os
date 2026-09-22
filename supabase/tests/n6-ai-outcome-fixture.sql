\ir n6-ai-attempt-fixture.sql
create function private.is_active_pipeline_team_member(uuid)
returns boolean language sql as 'select true';
alter table public.ai_runs add column user_id uuid;
alter table public.ai_runs add column engagement_id uuid;
alter table public.ai_runs add column redacted_at timestamptz;
alter table public.ai_runs add column output_text text;
alter table public.ai_runs add column provider text;
alter table public.ai_runs add column model text;
alter table public.ai_runs add column context_manifest jsonb;