-- PROJECT PAGES & KEYWORD TRACKER
CREATE TABLE public.as_project_pages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID REFERENCES public.as_projects(id) ON DELETE CASCADE,
  page_name TEXT NOT NULL,
  url_slug TEXT,
  full_url TEXT,
  page_type TEXT CHECK (page_type IN ('homepage','service_page','solutions_page','location_page','event_page','blog','about','contact','other')) DEFAULT 'service_page',
  parent_page TEXT,
  primary_keyword TEXT,
  primary_kw_volume TEXT,
  primary_kw_difficulty TEXT,
  primary_kw_position TEXT,
  secondary_keywords JSONB DEFAULT '[]',
  content_status TEXT CHECK (content_status IN ('not_started','drafting','review','approved','published')) DEFAULT 'not_started',
  seo_score DECIMAL(5,2),
  assigned_writer TEXT,
  assigned_developer TEXT,
  assigned_designer TEXT,
  meta_title TEXT,
  meta_description TEXT,
  h1_optimized BOOLEAN DEFAULT false,
  schema_added BOOLEAN DEFAULT false,
  mobile_friendly BOOLEAN DEFAULT false,
  index_status TEXT DEFAULT 'not_submitted',
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
-- LIVING PROJECT DOCUMENT
CREATE TABLE public.as_project_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID REFERENCES public.as_projects(id) ON DELETE CASCADE,
  doc_type TEXT CHECK (doc_type IN ('brand_identity','product_structure','keyword_research','content_brief','seo_strategy','handoff_notes','general')) DEFAULT 'general',
  title TEXT NOT NULL,
  content TEXT DEFAULT '',
  version INT DEFAULT 1,
  updated_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
-- PROJECT GANTT / TIMELINE MILESTONES
CREATE TABLE public.as_project_milestones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID REFERENCES public.as_projects(id) ON DELETE CASCADE,
  phase TEXT CHECK (phase IN ('product_modeling','development','marketing')) NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  assigned_to UUID REFERENCES auth.users(id),
  start_date DATE,
  end_date DATE,
  status TEXT CHECK (status IN ('not_started','in_progress','completed','blocked')) DEFAULT 'not_started',
  milestone_order INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
-- RLS
ALTER TABLE public.as_project_pages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.as_project_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.as_project_milestones ENABLE ROW LEVEL SECURITY;
CREATE POLICY "team_all_as_pages" ON public.as_project_pages
  FOR ALL USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid()));
CREATE POLICY "client_read_as_pages" ON public.as_project_pages
  FOR SELECT USING (
    project_id IN (SELECT id FROM public.as_projects WHERE client_id IN (
      SELECT id FROM public.as_clients WHERE auth_user_id = auth.uid()
    ))
  );
CREATE POLICY "team_all_as_docs" ON public.as_project_documents
  FOR ALL USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid()));
CREATE POLICY "client_read_as_docs" ON public.as_project_documents
  FOR SELECT USING (
    project_id IN (SELECT id FROM public.as_projects WHERE client_id IN (
      SELECT id FROM public.as_clients WHERE auth_user_id = auth.uid()
    ))
  );
CREATE POLICY "team_all_as_milestones" ON public.as_project_milestones
  FOR ALL USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid()));
CREATE INDEX idx_as_pages_project ON public.as_project_pages(project_id);
CREATE INDEX idx_as_docs_project ON public.as_project_documents(project_id);
CREATE INDEX idx_as_milestones_project ON public.as_project_milestones(project_id);
