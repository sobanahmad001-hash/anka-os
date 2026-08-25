-- Anka Sphere OS - Phase 1 / Migration 5 (20260825050000)
-- Close Data API access to the retired design review subsystem.
--
-- Canonical replacement:
--   design_reviews  -> deliverables + deliverable_versions + approvals
--   review_comments -> comments linked to an exact deliverable/version
--
-- Both legacy tables are empty after the verified Migration 3 reset and no
-- active React module references either table. The tables remain in place for
-- later schema cleanup, but browser roles receive no access.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';

drop policy if exists "Authenticated users can read reviews"
  on public.design_reviews;
drop policy if exists "Users can create reviews"
  on public.design_reviews;
drop policy if exists "Creator and reviewers can update reviews"
  on public.design_reviews;
drop policy if exists "Owner and admins can delete reviews"
  on public.design_reviews;

drop policy if exists "Authenticated users can read comments"
  on public.review_comments;
drop policy if exists "Users can create comments"
  on public.review_comments;
drop policy if exists "Owner can delete own comments"
  on public.review_comments;

revoke all privileges on public.design_reviews from anon, authenticated;
revoke all privileges on public.review_comments from anon, authenticated;

commit;
