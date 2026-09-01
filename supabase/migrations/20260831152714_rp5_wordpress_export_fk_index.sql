-- RP5 follow-up: cover the composite website page design foreign key in its declared order.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';

create index idx_wordpress_export_jobs_design_organization
  on public.wordpress_export_jobs(website_page_design_id, organization_id);

commit;
