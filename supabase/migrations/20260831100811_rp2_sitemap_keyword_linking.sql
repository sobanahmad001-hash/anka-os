-- Anka OS - RP2 sitemap content shape and keyword-to-page relation vocabulary.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

alter table public.artifact_relations
  drop constraint artifact_relations_relation_type_check;

alter table public.artifact_relations
  add constraint artifact_relations_relation_type_check
  check (relation_type in ('feeds_into', 'derived_from', 'referenced_by', 'targets_page'));

comment on constraint artifact_relations_relation_type_check on public.artifact_relations is
  'D3 generic artifact links plus RP2 keyword-strategy targeting of website-architecture pages.';

commit;
