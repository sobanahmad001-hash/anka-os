-- ============================================================================
-- Anka OS — Phase 4 Migration
-- Run AFTER phase3.sql has been executed.
-- Adds: ai_conversations, ai_messages, decisions, behavior_logs tables
-- The AI assistant backbone for context-aware workspace intelligence.
-- ============================================================================


-- ─── AI Conversations ────────────────────────────────────────────────────────
-- Persistent conversation threads per user.

create table if not exists public.ai_conversations (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  title text not null default 'New Conversation',
  context_snapshot jsonb default '{}'::jsonb,   -- snapshot of context at conversation start
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.ai_conversations enable row level security;

create policy "Users can manage own conversations"
  on public.ai_conversations for all
  using (auth.uid() = user_id);


-- ─── AI Messages ─────────────────────────────────────────────────────────────
-- Individual messages within a conversation (user + assistant).

create table if not exists public.ai_messages (
  id uuid default gen_random_uuid() primary key,
  conversation_id uuid references public.ai_conversations(id) on delete cascade not null,
  role text not null check (role in ('user', 'assistant', 'system')),
  content text not null,
  actions jsonb default '[]'::jsonb,    -- parsed [ANKA_ACTION] blocks from assistant messages
  token_count int default 0,
  provider text,                         -- 'claude' | 'openai' | null
  model text,                            -- e.g. 'claude-sonnet-4-20250514', 'gpt-4o'
  created_at timestamptz not null default now()
);

alter table public.ai_messages enable row level security;

create policy "Users can manage own messages"
  on public.ai_messages for all
  using (
    exists (
      select 1 from public.ai_conversations
      where id = ai_messages.conversation_id and user_id = auth.uid()
    )
  );


-- ─── Decisions ───────────────────────────────────────────────────────────────
-- Tracks team decisions with outcomes for the learning loop.
-- AI pulls closed decisions to learn from what worked.

create table if not exists public.decisions (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users(id) on delete set null,
  project_id uuid references public.projects(id) on delete set null,
  title text not null,
  description text not null default '',
  status text not null default 'open'
    check (status in ('open', 'approved', 'rejected', 'implemented', 'revisited')),
  outcome text default '',              -- what actually happened after the decision
  outcome_rating int default null       -- 1-5 self-rating of the outcome
    check (outcome_rating is null or (outcome_rating >= 1 and outcome_rating <= 5)),
  context jsonb default '{}'::jsonb,    -- snapshot of context when decision was made
  tags text[] default '{}',
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.decisions enable row level security;

-- All authenticated users can read decisions (for transparency)
create policy "Authenticated users can read decisions"
  on public.decisions for select
  using (auth.role() = 'authenticated');

-- Users can create decisions
create policy "Users can create decisions"
  on public.decisions for insert
  with check (auth.uid() = user_id);

-- Owner + admins can update decisions
create policy "Owner and admins can update decisions"
  on public.decisions for update
  using (
    user_id = auth.uid()
    or exists (
      select 1 from public.profiles
      where id = auth.uid() and role in ('admin', 'department_head')
    )
  );


-- ─── Behavior Logs ───────────────────────────────────────────────────────────
-- Tracks user behavior patterns for cognitive awareness.
-- The AI uses this to adjust response depth and proactivity.

create table if not exists public.behavior_logs (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  event_type text not null,             -- 'app_open', 'task_complete', 'message_sent', 'idle', 'focus_session', etc.
  app_id text,                          -- which app was active
  metadata jsonb default '{}'::jsonb,   -- extra context (duration, clicks, etc.)
  session_id text,                      -- groups events into work sessions
  created_at timestamptz not null default now()
);

alter table public.behavior_logs enable row level security;

-- Users can see own behavior
create policy "Users can read own behavior"
  on public.behavior_logs for select
  using (auth.uid() = user_id);

-- Users can log own behavior
create policy "Users can log own behavior"
  on public.behavior_logs for insert
  with check (auth.uid() = user_id);

-- Admins can read all behavior (for analytics)
create policy "Admins can read all behavior"
  on public.behavior_logs for select
  using (
    exists (
      select 1 from public.profiles
      where id = auth.uid() and role = 'admin'
    )
  );


-- ─── Action Audit Log ───────────────────────────────────────────────────────
-- Tracks AI-proposed actions and whether they were approved/rejected.

create table if not exists public.action_audit (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  conversation_id uuid references public.ai_conversations(id) on delete set null,
  action_type text not null,            -- 'create_task', 'update_project', 'send_message', etc.
  action_payload jsonb not null,        -- the full action JSON
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected', 'executed', 'failed')),
  result jsonb default null,            -- result after execution
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

alter table public.action_audit enable row level security;

create policy "Users can manage own actions"
  on public.action_audit for all
  using (auth.uid() = user_id);


-- ─── Enable Realtime ─────────────────────────────────────────────────────────

alter publication supabase_realtime add table public.ai_messages;
