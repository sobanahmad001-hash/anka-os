-- ============================================================================
-- Anka OS — Phase 12 Migration: Permissions & Control
-- Run AFTER all previous phases have been executed.
-- Adds: department to tasks, assigned_by to tasks, progress to projects,
--        hierarchy-based RLS policies, project progress triggers.
-- ============================================================================


-- ─── 1. Schema Changes ──────────────────────────────────────────────────────

-- Add department column to tasks so tasks can be department-scoped
alter table public.tasks
  add column if not exists department text
    check (department in ('design', 'development', 'marketing'));

-- Add assigned_by to track who assigned the task
alter table public.tasks
  add column if not exists assigned_by uuid references auth.users(id) on delete set null;

-- Add progress column to projects (0-100 percentage)
alter table public.projects
  add column if not exists progress int not null default 0
    check (progress >= 0 and progress <= 100);


-- ─── 2. Backfill tasks.department from the task creator's profile ────────────

update public.tasks t
set department = (select p.department from public.profiles p where p.id = t.user_id)
where t.department is null;


-- ─── 3. Project Progress Function ───────────────────────────────────────────
-- Calculates progress as percentage of 'done' tasks linked to a project.

create or replace function public.update_project_progress()
returns trigger as $$
declare
  proj_id uuid;
  total_count int;
  done_count int;
  new_progress int;
begin
  -- Determine which project_id to recalculate
  if TG_OP = 'DELETE' then
    proj_id := OLD.project_id;
  else
    proj_id := NEW.project_id;
    -- If project changed, also recalculate old project
    if TG_OP = 'UPDATE' and OLD.project_id is distinct from NEW.project_id and OLD.project_id is not null then
      select count(*), count(*) filter (where status = 'done')
        into total_count, done_count
        from public.tasks
        where project_id = OLD.project_id;
      if total_count > 0 then
        new_progress := round((done_count::numeric / total_count) * 100);
      else
        new_progress := 0;
      end if;
      update public.projects set progress = new_progress, updated_at = now() where id = OLD.project_id;
    end if;
  end if;

  -- Recalculate current project
  if proj_id is not null then
    select count(*), count(*) filter (where status = 'done')
      into total_count, done_count
      from public.tasks
      where project_id = proj_id;
    if total_count > 0 then
      new_progress := round((done_count::numeric / total_count) * 100);
    else
      new_progress := 0;
    end if;
    update public.projects set progress = new_progress, updated_at = now() where id = proj_id;
  end if;

  if TG_OP = 'DELETE' then
    return OLD;
  end if;
  return NEW;
end;
$$ language plpgsql security definer;

-- Trigger on task insert/update/delete to recalculate project progress
drop trigger if exists trg_update_project_progress on public.tasks;
create trigger trg_update_project_progress
  after insert or update of status, project_id or delete
  on public.tasks
  for each row
  execute function public.update_project_progress();


-- ─── 4. Replace Tasks RLS Policies ──────────────────────────────────────────
-- Drop old owner-only policy
drop policy if exists "Users can manage own tasks" on public.tasks;

-- Admin: full access to all tasks
create policy "Admin full access to tasks"
  on public.tasks for all
  using (
    exists (
      select 1 from public.profiles
      where id = auth.uid() and role = 'admin'
    )
  );

-- Department Head: full access to all tasks in their department
create policy "Head manages department tasks"
  on public.tasks for all
  using (
    exists (
      select 1 from public.profiles
      where id = auth.uid()
        and role = 'department_head'
        and department = tasks.department
    )
  );

-- Executive/Intern: can read tasks assigned to them or created by them
create policy "Users can read own and assigned tasks"
  on public.tasks for select
  using (
    auth.uid() = user_id
    or auth.uid() = assigned_to
  );

-- Executive/Intern: can insert tasks (own tasks)
create policy "Users can create own tasks"
  on public.tasks for insert
  with check (
    auth.uid() = user_id
  );

-- Executive/Intern: can update tasks assigned to them or owned by them
create policy "Users can update own and assigned tasks"
  on public.tasks for update
  using (
    auth.uid() = user_id
    or auth.uid() = assigned_to
  );

-- Executive/Intern: can delete only their own tasks
create policy "Users can delete own tasks"
  on public.tasks for delete
  using (
    auth.uid() = user_id
  );


-- ─── 5. Update Subtasks RLS to follow new task visibility ───────────────────
-- Drop old subtask policies
drop policy if exists "Subtask access follows task owner" on public.subtasks;
drop policy if exists "Task owner can insert subtasks" on public.subtasks;
drop policy if exists "Task owner can update subtasks" on public.subtasks;
drop policy if exists "Task owner can delete subtasks" on public.subtasks;

-- Helper: can user see this task?
create or replace function public.can_access_task(p_task_id uuid)
returns boolean as $$
begin
  return exists (
    select 1 from public.tasks t
    where t.id = p_task_id
    and (
      -- Admin
      exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
      -- Department head in same department
      or exists (select 1 from public.profiles where id = auth.uid() and role = 'department_head' and department = t.department)
      -- Task owner or assignee
      or t.user_id = auth.uid()
      or t.assigned_to = auth.uid()
    )
  );
end;
$$ language plpgsql security definer stable;

create policy "Subtask access follows task visibility"
  on public.subtasks for select
  using (public.can_access_task(task_id));

create policy "Users can insert subtasks on accessible tasks"
  on public.subtasks for insert
  with check (public.can_access_task(task_id));

create policy "Users can update subtasks on accessible tasks"
  on public.subtasks for update
  using (public.can_access_task(task_id));

create policy "Users can delete subtasks on accessible tasks"
  on public.subtasks for delete
  using (public.can_access_task(task_id));


-- ─── 6. Backfill project progress for existing projects ─────────────────────

update public.projects p
set progress = coalesce((
  select round((count(*) filter (where t.status = 'done')::numeric / nullif(count(*), 0)) * 100)
  from public.tasks t
  where t.project_id = p.id
), 0);
