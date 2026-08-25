-- ANKA SPHERE TABLES (as_ prefix)
CREATE TABLE public.as_clients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  company TEXT,
  portal_access BOOLEAN DEFAULT true,
  auth_user_id UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE TABLE public.as_projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID REFERENCES public.as_clients(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  current_phase TEXT CHECK (current_phase IN ('product_modeling','development','marketing','completed')) DEFAULT 'product_modeling',
  status TEXT CHECK (status IN ('active','pending_handoff','pending_client_approval','on_hold','completed','cancelled')) DEFAULT 'active',
  budget DECIMAL(10,2),
  deadline DATE,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE TABLE public.as_project_phases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID REFERENCES public.as_projects(id) ON DELETE CASCADE,
  phase TEXT CHECK (phase IN ('product_modeling','development','marketing')) NOT NULL,
  status TEXT CHECK (status IN ('not_started','in_progress','pending_approval','completed')) DEFAULT 'not_started',
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  approved_by UUID REFERENCES auth.users(id),
  approval_notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(project_id, phase)
);
CREATE TABLE public.as_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID REFERENCES public.as_projects(id) ON DELETE CASCADE,
  phase TEXT CHECK (phase IN ('product_modeling','development','marketing')) NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  assigned_to UUID REFERENCES auth.users(id),
  status TEXT CHECK (status IN ('todo','in_progress','done','blocked')) DEFAULT 'todo',
  progress_percentage INT DEFAULT 0 CHECK (progress_percentage >= 0 AND progress_percentage <= 100),
  is_prep_task BOOLEAN DEFAULT false,
  dependencies JSONB DEFAULT '[]',
  blocked_reason TEXT,
  due_date DATE,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE TABLE public.as_deliverables (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID REFERENCES public.as_projects(id) ON DELETE CASCADE,
  phase TEXT CHECK (phase IN ('product_modeling','development','marketing')) NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  file_url TEXT,
  deliverable_type TEXT,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE TABLE public.as_handoff_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID REFERENCES public.as_projects(id) ON DELETE CASCADE,
  from_phase TEXT CHECK (from_phase IN ('product_modeling','development')) NOT NULL,
  to_phase TEXT CHECK (to_phase IN ('development','marketing')) NOT NULL,
  status TEXT CHECK (status IN ('pending','approved','rejected')) DEFAULT 'pending',
  requested_by UUID REFERENCES auth.users(id),
  reviewed_by UUID REFERENCES auth.users(id),
  reviewed_at TIMESTAMPTZ,
  review_notes TEXT,
  handoff_brief JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE TABLE public.as_client_signoffs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID REFERENCES public.as_projects(id) ON DELETE CASCADE,
  phase TEXT CHECK (phase IN ('development','marketing')) NOT NULL,
  status TEXT CHECK (status IN ('pending','approved','changes_requested')) DEFAULT 'pending',
  feedback TEXT,
  deliverables_reviewed JSONB DEFAULT '[]',
  requested_at TIMESTAMPTZ DEFAULT NOW(),
  responded_at TIMESTAMPTZ
);
CREATE TABLE public.as_timeline_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID REFERENCES public.as_projects(id) ON DELETE CASCADE,
  event_type TEXT CHECK (event_type IN (
    'project_created','task_created','task_started','task_completed',
    'task_blocked','phase_started','phase_completed','handoff_requested',
    'handoff_approved','handoff_rejected','client_signoff_requested',
    'client_signoff_approved','client_signoff_changes_requested',
    'deliverable_uploaded','comment_added'
  )) NOT NULL,
  description TEXT NOT NULL,
  metadata JSONB DEFAULT '{}',
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE TABLE public.as_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  project_id UUID REFERENCES public.as_projects(id) ON DELETE SET NULL,
  notification_type TEXT CHECK (notification_type IN (
    'task_assigned','task_completed','phase_transition',
    'handoff_request','handoff_decision','client_signoff_request',
    'client_signoff_response','blocker_detected','deadline_approaching'
  )) NOT NULL,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  read BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE TABLE public.as_crm_signals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID REFERENCES public.as_clients(id),
  project_id UUID REFERENCES public.as_projects(id),
  signal_type TEXT CHECK (signal_type IN (
    'project_started','phase_transition','task_milestone',
    'client_engagement','approval_received','delay_detected','project_completed'
  )) NOT NULL,
  data JSONB NOT NULL DEFAULT '{}',
  sent_to_crm BOOLEAN DEFAULT false,
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
-- RLS
ALTER TABLE public.as_clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.as_projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.as_project_phases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.as_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.as_deliverables ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.as_handoff_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.as_client_signoffs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.as_timeline_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.as_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.as_crm_signals ENABLE ROW LEVEL SECURITY;
-- Team reads all projects
CREATE POLICY "team_read_as_projects" ON public.as_projects
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid())
  );
-- Admin full access
CREATE POLICY "admin_all_as_projects" ON public.as_projects
  FOR ALL USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
  );
-- Clients see only their projects
CREATE POLICY "client_own_as_projects" ON public.as_projects
  FOR SELECT USING (
    client_id IN (SELECT id FROM public.as_clients WHERE auth_user_id = auth.uid())
  );
-- Tasks: team reads all
CREATE POLICY "team_read_as_tasks" ON public.as_tasks
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid())
  );
CREATE POLICY "admin_all_as_tasks" ON public.as_tasks
  FOR ALL USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
  );
-- Clients read tasks on their projects
CREATE POLICY "client_read_as_tasks" ON public.as_tasks
  FOR SELECT USING (
    project_id IN (
      SELECT id FROM public.as_projects WHERE client_id IN (
        SELECT id FROM public.as_clients WHERE auth_user_id = auth.uid()
      )
    )
  );
-- Timeline: team reads all
CREATE POLICY "team_read_as_timeline" ON public.as_timeline_events
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid())
  );
CREATE POLICY "client_read_as_timeline" ON public.as_timeline_events
  FOR SELECT USING (
    project_id IN (
      SELECT id FROM public.as_projects WHERE client_id IN (
        SELECT id FROM public.as_clients WHERE auth_user_id = auth.uid()
      )
    )
  );
-- Notifications: own only
CREATE POLICY "own_as_notifications" ON public.as_notifications
  FOR ALL USING (recipient_id = auth.uid());
-- Handoff requests: team reads
CREATE POLICY "team_read_handoffs" ON public.as_handoff_requests
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid())
  );
CREATE POLICY "admin_all_handoffs" ON public.as_handoff_requests
  FOR ALL USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
  );
-- Sign offs: team reads, clients respond to their own
CREATE POLICY "team_read_signoffs" ON public.as_client_signoffs
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid())
  );
CREATE POLICY "client_respond_signoffs" ON public.as_client_signoffs
  FOR UPDATE USING (
    project_id IN (
      SELECT id FROM public.as_projects WHERE client_id IN (
        SELECT id FROM public.as_clients WHERE auth_user_id = auth.uid()
      )
    )
  );
-- Deliverables: team reads all, clients read own project
CREATE POLICY "team_read_deliverables" ON public.as_deliverables
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid())
  );
CREATE POLICY "client_read_deliverables" ON public.as_deliverables
  FOR SELECT USING (
    project_id IN (
      SELECT id FROM public.as_projects WHERE client_id IN (
        SELECT id FROM public.as_clients WHERE auth_user_id = auth.uid()
      )
    )
  );
-- Clients read
CREATE POLICY "team_read_as_clients" ON public.as_clients
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid())
  );
CREATE POLICY "admin_all_as_clients" ON public.as_clients
  FOR ALL USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
  );
-- Indexes
CREATE INDEX idx_as_projects_client ON public.as_projects(client_id);
CREATE INDEX idx_as_projects_phase ON public.as_projects(current_phase);
CREATE INDEX idx_as_tasks_project ON public.as_tasks(project_id);
CREATE INDEX idx_as_tasks_phase ON public.as_tasks(phase);
CREATE INDEX idx_as_tasks_assigned ON public.as_tasks(assigned_to);
CREATE INDEX idx_as_tasks_status ON public.as_tasks(status);
CREATE INDEX idx_as_timeline_project ON public.as_timeline_events(project_id);
CREATE INDEX idx_as_timeline_created ON public.as_timeline_events(created_at DESC);
CREATE INDEX idx_as_notifications_recipient ON public.as_notifications(recipient_id);
CREATE INDEX idx_as_notifications_read ON public.as_notifications(read);
