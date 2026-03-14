-- ============================================================================
-- Anka OS — Phase 8 Migration
-- Run AFTER phase7.sql has been executed.
-- Adds: user_preferences, audit_logs, templates
-- Settings, Theme, Presence, Audit & Templates layer.
-- ============================================================================


-- ─── User Preferences ────────────────────────────────────────────────────────
-- Stores per-user settings (theme, notification prefs, custom shortcuts, etc.)

create table if not exists public.user_preferences (
  user_id uuid references auth.users(id) on delete cascade primary key,
  theme text not null default 'dark'
    check (theme in ('dark', 'light')),
  notification_sounds boolean not null default true,
  notification_desktop boolean not null default false,
  notification_email boolean not null default false,
  compact_mode boolean not null default false,
  sidebar_collapsed boolean not null default false,
  locale text not null default 'en',
  timezone text not null default 'UTC',
  custom_data jsonb default '{}',
  updated_at timestamptz not null default now()
);

alter table public.user_preferences enable row level security;

create policy "Users can read own preferences"
  on public.user_preferences for select
  using (auth.uid() = user_id);

create policy "Users can insert own preferences"
  on public.user_preferences for insert
  with check (auth.uid() = user_id);

create policy "Users can update own preferences"
  on public.user_preferences for update
  using (auth.uid() = user_id);


-- ─── Audit Logs (Admin) ─────────────────────────────────────────────────────
-- Tracks admin/system-level actions for accountability.

create table if not exists public.audit_logs (
  id uuid default gen_random_uuid() primary key,
  actor_id uuid references auth.users(id) on delete set null,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  old_values jsonb default null,
  new_values jsonb default null,
  ip_address text default null,
  created_at timestamptz not null default now()
);

create index if not exists idx_audit_logs_actor on public.audit_logs (actor_id);
create index if not exists idx_audit_logs_entity on public.audit_logs (entity_type, entity_id);
create index if not exists idx_audit_logs_created on public.audit_logs (created_at desc);

alter table public.audit_logs enable row level security;

create policy "Admins can read audit logs"
  on public.audit_logs for select
  using (
    exists (
      select 1 from public.profiles
      where id = auth.uid() and role = 'admin'
    )
  );

create policy "Authenticated users can insert audit logs"
  on public.audit_logs for insert
  with check (auth.uid() = actor_id);


-- ─── Templates ───────────────────────────────────────────────────────────────
-- Reusable templates for tasks, projects, campaigns, etc.

create table if not exists public.templates (
  id uuid default gen_random_uuid() primary key,
  created_by uuid references auth.users(id) on delete set null,
  name text not null,
  description text default '',
  template_type text not null
    check (template_type in ('task', 'project', 'campaign', 'invoice')),
  template_data jsonb not null default '{}',
  is_shared boolean not null default false,
  department text default null
    check (department is null or department in ('design', 'development', 'marketing')),
  icon text default '📋',
  usage_count int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_templates_type on public.templates (template_type);

alter table public.templates enable row level security;

create policy "Users can read shared or own templates"
  on public.templates for select
  using (
    auth.role() = 'authenticated'
    and (is_shared = true or created_by = auth.uid())
  );

create policy "Users can create templates"
  on public.templates for insert
  with check (auth.uid() = created_by);

create policy "Owner can update templates"
  on public.templates for update
  using (created_by = auth.uid());

create policy "Owner and admins can delete templates"
  on public.templates for delete
  using (
    created_by = auth.uid()
    or exists (
      select 1 from public.profiles
      where id = auth.uid() and role = 'admin'
    )
  );


-- ─── Enable realtime ────────────────────────────────────────────────────────
alter publication supabase_realtime add table public.user_preferences;
