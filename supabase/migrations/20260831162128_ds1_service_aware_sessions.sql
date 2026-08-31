-- Anka OS DS1 - link Design Workshop sessions to active engagement services.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

alter table public.design_workshop_sessions
  add column engagement_service_id uuid;

alter table public.design_workshop_sessions
  add constraint design_workshop_sessions_service_fk
  foreign key (engagement_service_id, organization_id)
  references public.engagement_services(id, organization_id) on delete restrict;

create index idx_design_workshop_sessions_engagement_service
  on public.design_workshop_sessions(engagement_service_id)
  where engagement_service_id is not null;

alter table public.design_directions
  drop constraint design_directions_direction_slot_check;

alter table public.design_directions
  add constraint design_directions_direction_slot_check
  check (direction_slot between 1 and 12);

comment on column public.design_workshop_sessions.engagement_service_id is
  'Authoritative active Design service selected for this session. Null only for historical sessions created before DS1.';

commit;
