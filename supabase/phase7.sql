-- ============================================================================
-- Anka OS — Phase 7 Migration
-- Run AFTER phase6.sql has been executed.
-- Adds: wiki_pages, invoices, invoice_items, comments, user_status
-- Team Collaboration & Knowledge layer.
-- ============================================================================


-- ─── Wiki Pages (Knowledge Base) ─────────────────────────────────────────────
-- Team-maintained wiki for internal documentation.

create table if not exists public.wiki_pages (
  id uuid default gen_random_uuid() primary key,
  created_by uuid references auth.users(id) on delete set null,
  parent_id uuid references public.wiki_pages(id) on delete set null,
  title text not null,
  content text not null default '',
  slug text not null default '',
  icon text default '📄',
  is_published boolean not null default true,
  tags text[] default '{}',
  department text default null
    check (department is null or department in ('design', 'development', 'marketing')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.wiki_pages enable row level security;

create policy "Authenticated users can read published wiki"
  on public.wiki_pages for select
  using (
    auth.role() = 'authenticated'
    and (is_published = true or created_by = auth.uid())
  );

create policy "Users can create wiki pages"
  on public.wiki_pages for insert
  with check (auth.uid() = created_by);

create policy "Owner and admins can update wiki"
  on public.wiki_pages for update
  using (
    created_by = auth.uid()
    or exists (
      select 1 from public.profiles
      where id = auth.uid() and role in ('admin', 'department_head')
    )
  );

create policy "Owner and admins can delete wiki"
  on public.wiki_pages for delete
  using (
    created_by = auth.uid()
    or exists (
      select 1 from public.profiles
      where id = auth.uid() and role in ('admin', 'department_head')
    )
  );


-- ─── Invoices (Billing) ─────────────────────────────────────────────────────
-- Client invoices with line items.

create table if not exists public.invoices (
  id uuid default gen_random_uuid() primary key,
  created_by uuid references auth.users(id) on delete set null,
  client_id uuid references public.clients(id) on delete set null,
  project_id uuid references public.projects(id) on delete set null,
  invoice_number text not null,
  status text not null default 'draft'
    check (status in ('draft', 'sent', 'paid', 'overdue', 'cancelled')),
  issue_date date not null default current_date,
  due_date date,
  subtotal numeric(12,2) not null default 0,
  tax_rate numeric(5,2) not null default 0,
  tax_amount numeric(12,2) not null default 0,
  total numeric(12,2) not null default 0,
  notes text default '',
  currency text not null default 'USD',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.invoices enable row level security;

create policy "Users can read invoices"
  on public.invoices for select
  using (
    created_by = auth.uid()
    or exists (
      select 1 from public.profiles
      where id = auth.uid() and role in ('admin', 'department_head')
    )
  );

create policy "Users can create invoices"
  on public.invoices for insert
  with check (auth.uid() = created_by);

create policy "Owner and admins can update invoices"
  on public.invoices for update
  using (
    created_by = auth.uid()
    or exists (
      select 1 from public.profiles
      where id = auth.uid() and role in ('admin', 'department_head')
    )
  );

create policy "Owner and admins can delete invoices"
  on public.invoices for delete
  using (
    created_by = auth.uid()
    or exists (
      select 1 from public.profiles
      where id = auth.uid() and role in ('admin', 'department_head')
    )
  );


-- ─── Invoice Items ───────────────────────────────────────────────────────────

create table if not exists public.invoice_items (
  id uuid default gen_random_uuid() primary key,
  invoice_id uuid references public.invoices(id) on delete cascade not null,
  description text not null,
  quantity numeric(10,2) not null default 1,
  unit_price numeric(12,2) not null default 0,
  amount numeric(12,2) not null default 0,
  sort_order int default 0
);

alter table public.invoice_items enable row level security;

create policy "Invoice item access follows invoice"
  on public.invoice_items for all
  using (
    exists (
      select 1 from public.invoices
      where id = invoice_id and (
        created_by = auth.uid()
        or exists (
          select 1 from public.profiles
          where id = auth.uid() and role in ('admin', 'department_head')
        )
      )
    )
  );


-- ─── Comments (Generic — Tasks, Projects) ────────────────────────────────────
-- Threaded comments attachable to any entity.

create table if not exists public.comments (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  entity_type text not null
    check (entity_type in ('task', 'project', 'campaign', 'content_item', 'invoice')),
  entity_id uuid not null,
  content text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_comments_entity
  on public.comments (entity_type, entity_id);

alter table public.comments enable row level security;

create policy "Authenticated users can read comments"
  on public.comments for select
  using (auth.role() = 'authenticated');

create policy "Users can create comments"
  on public.comments for insert
  with check (auth.uid() = user_id);

create policy "Owner can update own comments"
  on public.comments for update
  using (auth.uid() = user_id);

create policy "Owner can delete own comments"
  on public.comments for delete
  using (auth.uid() = user_id);


-- ─── User Status (Presence) ─────────────────────────────────────────────────
-- Online/away/busy status per user.

create table if not exists public.user_status (
  user_id uuid references auth.users(id) on delete cascade primary key,
  status text not null default 'online'
    check (status in ('online', 'away', 'busy', 'offline')),
  status_text text default '',
  last_seen_at timestamptz not null default now()
);

alter table public.user_status enable row level security;

create policy "Anyone can read status"
  on public.user_status for select
  using (auth.role() = 'authenticated');

create policy "Users can upsert own status"
  on public.user_status for insert
  with check (auth.uid() = user_id);

create policy "Users can update own status"
  on public.user_status for update
  using (auth.uid() = user_id);


-- ─── Enable realtime ────────────────────────────────────────────────────────
alter publication supabase_realtime add table public.comments;
alter publication supabase_realtime add table public.user_status;
