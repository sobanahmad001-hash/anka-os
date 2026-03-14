-- ============================================================================
-- Anka OS — Phase 5 Migration
-- Run AFTER phase4.sql has been executed.
-- Adds: campaigns, content_items, design_reviews, review_comments, api_docs
-- Department specialization — real apps replacing stubs.
-- ============================================================================


-- ─── Campaigns (Marketing) ───────────────────────────────────────────────────
-- Tracks marketing campaigns with status, budget, date ranges.

create table if not exists public.campaigns (
  id uuid default gen_random_uuid() primary key,
  created_by uuid references auth.users(id) on delete set null,
  name text not null,
  description text not null default '',
  status text not null default 'draft'
    check (status in ('draft', 'active', 'paused', 'completed', 'cancelled')),
  channel text not null default 'other'
    check (channel in ('email', 'social', 'paid_ads', 'content', 'event', 'other')),
  budget numeric(12,2) default 0,
  spent numeric(12,2) default 0,
  target_audience text default '',
  start_date date,
  end_date date,
  tags text[] default '{}',
  metadata jsonb default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.campaigns enable row level security;

create policy "Authenticated users can read campaigns"
  on public.campaigns for select
  using (auth.role() = 'authenticated');

create policy "Users can create campaigns"
  on public.campaigns for insert
  with check (auth.uid() = created_by);

create policy "Owner and admins can update campaigns"
  on public.campaigns for update
  using (
    created_by = auth.uid()
    or exists (
      select 1 from public.profiles
      where id = auth.uid() and role in ('admin', 'department_head')
    )
  );

create policy "Owner and admins can delete campaigns"
  on public.campaigns for delete
  using (
    created_by = auth.uid()
    or exists (
      select 1 from public.profiles
      where id = auth.uid() and role in ('admin', 'department_head')
    )
  );


-- ─── Content Items (Marketing) ───────────────────────────────────────────────
-- Individual content pieces: blog posts, social posts, emails, etc.

create table if not exists public.content_items (
  id uuid default gen_random_uuid() primary key,
  created_by uuid references auth.users(id) on delete set null,
  campaign_id uuid references public.campaigns(id) on delete set null,
  title text not null,
  body text not null default '',
  content_type text not null default 'blog'
    check (content_type in ('blog', 'social', 'email', 'video', 'infographic', 'other')),
  status text not null default 'idea'
    check (status in ('idea', 'drafting', 'review', 'approved', 'published', 'archived')),
  publish_date date,
  platform text default '',             -- e.g. 'twitter', 'linkedin', 'website'
  tags text[] default '{}',
  metadata jsonb default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.content_items enable row level security;

create policy "Authenticated users can read content"
  on public.content_items for select
  using (auth.role() = 'authenticated');

create policy "Users can create content"
  on public.content_items for insert
  with check (auth.uid() = created_by);

create policy "Owner and admins can update content"
  on public.content_items for update
  using (
    created_by = auth.uid()
    or exists (
      select 1 from public.profiles
      where id = auth.uid() and role in ('admin', 'department_head')
    )
  );

create policy "Owner and admins can delete content"
  on public.content_items for delete
  using (
    created_by = auth.uid()
    or exists (
      select 1 from public.profiles
      where id = auth.uid() and role in ('admin', 'department_head')
    )
  );


-- ─── Design Reviews (Design) ────────────────────────────────────────────────
-- Review items for design assets with feedback/approval workflow.

create table if not exists public.design_reviews (
  id uuid default gen_random_uuid() primary key,
  created_by uuid references auth.users(id) on delete set null,
  project_id uuid references public.projects(id) on delete set null,
  title text not null,
  description text not null default '',
  asset_url text default '',            -- link to the design file/image
  status text not null default 'pending'
    check (status in ('pending', 'in_review', 'changes_requested', 'approved', 'rejected')),
  reviewer_id uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  tags text[] default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.design_reviews enable row level security;

create policy "Authenticated users can read reviews"
  on public.design_reviews for select
  using (auth.role() = 'authenticated');

create policy "Users can create reviews"
  on public.design_reviews for insert
  with check (auth.uid() = created_by);

create policy "Creator and reviewers can update reviews"
  on public.design_reviews for update
  using (
    created_by = auth.uid()
    or reviewer_id = auth.uid()
    or exists (
      select 1 from public.profiles
      where id = auth.uid() and role in ('admin', 'department_head')
    )
  );

create policy "Owner and admins can delete reviews"
  on public.design_reviews for delete
  using (
    created_by = auth.uid()
    or exists (
      select 1 from public.profiles
      where id = auth.uid() and role in ('admin', 'department_head')
    )
  );


-- ─── Review Comments ─────────────────────────────────────────────────────────
-- Threaded feedback on design reviews.

create table if not exists public.review_comments (
  id uuid default gen_random_uuid() primary key,
  review_id uuid references public.design_reviews(id) on delete cascade not null,
  user_id uuid references auth.users(id) on delete set null,
  content text not null,
  created_at timestamptz not null default now()
);

alter table public.review_comments enable row level security;

create policy "Authenticated users can read comments"
  on public.review_comments for select
  using (auth.role() = 'authenticated');

create policy "Users can create comments"
  on public.review_comments for insert
  with check (auth.uid() = user_id);

create policy "Owner can delete own comments"
  on public.review_comments for delete
  using (auth.uid() = user_id);


-- ─── API Docs (Development) ─────────────────────────────────────────────────
-- Team-maintained API documentation pages.

create table if not exists public.api_docs (
  id uuid default gen_random_uuid() primary key,
  created_by uuid references auth.users(id) on delete set null,
  project_id uuid references public.projects(id) on delete set null,
  title text not null,
  content text not null default '',
  method text default 'GET'
    check (method in ('GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'WS')),
  endpoint text default '',
  category text not null default 'general',
  tags text[] default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.api_docs enable row level security;

create policy "Authenticated users can read docs"
  on public.api_docs for select
  using (auth.role() = 'authenticated');

create policy "Users can create docs"
  on public.api_docs for insert
  with check (auth.uid() = created_by);

create policy "Owner and admins can update docs"
  on public.api_docs for update
  using (
    created_by = auth.uid()
    or exists (
      select 1 from public.profiles
      where id = auth.uid() and role in ('admin', 'department_head')
    )
  );

create policy "Owner and admins can delete docs"
  on public.api_docs for delete
  using (
    created_by = auth.uid()
    or exists (
      select 1 from public.profiles
      where id = auth.uid() and role in ('admin', 'department_head')
    )
  );


-- ─── Moodboard Items (Design) ───────────────────────────────────────────────
-- Visual inspiration items: images, colors, notes pinned to a board.

create table if not exists public.moodboard_items (
  id uuid default gen_random_uuid() primary key,
  created_by uuid references auth.users(id) on delete cascade not null,
  project_id uuid references public.projects(id) on delete set null,
  item_type text not null default 'image'
    check (item_type in ('image', 'color', 'note', 'link')),
  title text default '',
  content text default '',              -- note text, hex color, or URL
  image_url text default '',            -- for image type
  position_x int default 0,
  position_y int default 0,
  width int default 200,
  height int default 200,
  tags text[] default '{}',
  created_at timestamptz not null default now()
);

alter table public.moodboard_items enable row level security;

create policy "Authenticated users can read moodboard"
  on public.moodboard_items for select
  using (auth.role() = 'authenticated');

create policy "Users can create moodboard items"
  on public.moodboard_items for insert
  with check (auth.uid() = created_by);

create policy "Owner can update own items"
  on public.moodboard_items for update
  using (auth.uid() = created_by);

create policy "Owner can delete own items"
  on public.moodboard_items for delete
  using (auth.uid() = created_by);
