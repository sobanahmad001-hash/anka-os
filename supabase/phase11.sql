-- ============================================================================
-- Anka OS — Phase 11 Migration
-- Run AFTER phase10.sql has been executed.
-- Adds: pomodoro_sessions, snippets, message_reactions, note_folders
-- Focus Timer, Snippets, Chat Reactions & Note Organization.
-- ============================================================================


-- ─── Pomodoro Sessions ───────────────────────────────────────────────────────
-- Focus / break session tracking for the Pomodoro timer.

create table if not exists public.pomodoro_sessions (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  type text not null default 'focus'
    check (type in ('focus', 'short_break', 'long_break')),
  duration_minutes int not null default 25,
  started_at timestamptz not null default now(),
  completed boolean not null default false,
  task_id uuid references public.tasks(id) on delete set null,
  notes text default '',
  created_at timestamptz not null default now()
);

create index if not exists idx_pomodoro_user on public.pomodoro_sessions (user_id);
create index if not exists idx_pomodoro_started on public.pomodoro_sessions (started_at);

alter table public.pomodoro_sessions enable row level security;

create policy "Users can read own sessions"
  on public.pomodoro_sessions for select
  using (auth.uid() = user_id);

create policy "Users can create own sessions"
  on public.pomodoro_sessions for insert
  with check (auth.uid() = user_id);

create policy "Users can update own sessions"
  on public.pomodoro_sessions for update
  using (user_id = auth.uid());

create policy "Users can delete own sessions"
  on public.pomodoro_sessions for delete
  using (user_id = auth.uid());


-- ─── Snippets ────────────────────────────────────────────────────────────────
-- Reusable code/text snippets with language categorization.

create table if not exists public.snippets (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  title text not null,
  description text default '',
  content text not null default '',
  language text not null default 'text',
  is_shared boolean not null default false,
  tags text[] default '{}',
  copy_count int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_snippets_user on public.snippets (user_id);
create index if not exists idx_snippets_language on public.snippets (language);

alter table public.snippets enable row level security;

create policy "Users can read own or shared snippets"
  on public.snippets for select
  using (
    auth.role() = 'authenticated'
    and (user_id = auth.uid() or is_shared = true)
  );

create policy "Users can create own snippets"
  on public.snippets for insert
  with check (auth.uid() = user_id);

create policy "Users can update own snippets"
  on public.snippets for update
  using (user_id = auth.uid());

create policy "Users can delete own snippets"
  on public.snippets for delete
  using (user_id = auth.uid());


-- ─── Message Reactions ───────────────────────────────────────────────────────
-- Emoji reactions on chat messages.

create table if not exists public.message_reactions (
  id uuid default gen_random_uuid() primary key,
  message_id uuid references public.messages(id) on delete cascade not null,
  user_id uuid references auth.users(id) on delete cascade not null,
  emoji text not null,
  created_at timestamptz not null default now(),
  unique (message_id, user_id, emoji)
);

create index if not exists idx_reactions_message on public.message_reactions (message_id);

alter table public.message_reactions enable row level security;

create policy "Authenticated users can read reactions"
  on public.message_reactions for select
  using (auth.role() = 'authenticated');

create policy "Users can add reactions"
  on public.message_reactions for insert
  with check (auth.uid() = user_id);

create policy "Users can remove own reactions"
  on public.message_reactions for delete
  using (user_id = auth.uid());


-- ─── Note Folders ────────────────────────────────────────────────────────────
-- Folder organization for notes.

create table if not exists public.note_folders (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  name text not null,
  color text not null default '#6c5ce7',
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

alter table public.note_folders enable row level security;

create policy "Users can read own folders"
  on public.note_folders for select
  using (auth.uid() = user_id);

create policy "Users can create own folders"
  on public.note_folders for insert
  with check (auth.uid() = user_id);

create policy "Users can update own folders"
  on public.note_folders for update
  using (user_id = auth.uid());

create policy "Users can delete own folders"
  on public.note_folders for delete
  using (user_id = auth.uid());

-- Add folder_id column to notes
alter table public.notes add column if not exists folder_id uuid references public.note_folders(id) on delete set null;


-- ─── Enable realtime ────────────────────────────────────────────────────────
alter publication supabase_realtime add table public.message_reactions;
