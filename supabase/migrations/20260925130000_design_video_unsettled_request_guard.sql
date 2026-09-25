-- A new quote or operation key must not bypass an unsettled paid dispatch.
-- The existing operation-key unique constraint still handles exact replays.
create function private.guard_design_video_unsettled_request()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    new.organization_id::text || ':' || new.requested_by::text || ':' ||
      new.direction_version_id::text, 0));

  if exists (
    select 1 from private.design_video_generation_jobs prior
      where prior.organization_id = new.organization_id
        and prior.requested_by = new.requested_by
        and prior.direction_version_id = new.direction_version_id
        and prior.operation_key <> new.operation_key
        and prior.status in ('queued', 'claimed', 'provider_pending',
          'provider_completed', 'outcome_unknown')
  ) then
    raise exception 'An earlier video request for this direction must be resolved before another is submitted'
      using errcode='23514';
  end if;
  return new;
end;
$$;

revoke all on function private.guard_design_video_unsettled_request()
  from public, anon, authenticated, service_role;

create trigger guard_design_video_unsettled_request
  before insert on private.design_video_generation_jobs
  for each row execute function private.guard_design_video_unsettled_request();
