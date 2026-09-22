-- Read-only N6 execution visibility for current owner/operations staff.
-- Private attempt and budget tables retain no direct authenticated grants.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';

create function public.get_pipeline_ai_job_status(
  p_organization_id uuid, p_job_id uuid
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := (select auth.uid());
  job public.ai_execution_jobs;
  steps jsonb;
begin
  if actor is null or p_organization_id is null or p_job_id is null then
    raise exception 'Authenticated scoped job is required.' using errcode = '42501';
  end if;
  perform 1 from public.organizations organization
    join public.organization_memberships membership
      on membership.organization_id = organization.id
    where organization.id = p_organization_id and organization.status = 'active'
      and membership.user_id = actor and membership.member_kind = 'team'
      and membership.status = 'active'
      and membership.role in ('system_owner','operations_admin');
  if not found then
    raise exception 'Current owner or operations authority is required.' using errcode = '42501';
  end if;
  select * into job from public.ai_execution_jobs
    where id = p_job_id and organization_id = p_organization_id;
  if not found then raise exception 'Execution job is unavailable.' using errcode = 'P0002'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'step_id', step.id, 'step_key', step.step_key,
    'progress_status', progress.status,
    'attempt_id', attempt.id,
    'reservation_status', reservation.status,
    'reserved_max_microusd', reservation.max_cost_microusd,
    'accounted_cost_microusd', reservation.actual_cost_microusd,
    'initial_claimed_at', claim.claimed_at,
    'claimed_routes', case when claim.id is null then 0
      else 1 + coalesce(fallbacks.route_count,0) end,
    'confirmed_rejections', coalesce(rejections.rejection_count,0),
    'output_id', output.id,
    'review_decision', review.decision
  ) order by step.ordinal), '[]'::jsonb) into steps
  from public.ai_execution_configured_steps step
  join public.ai_execution_step_progress progress
    on progress.configured_step_id = step.id
    and progress.organization_id = step.organization_id
  left join private.ai_execution_step_attempts attempt
    on attempt.configured_step_id = step.id
    and attempt.organization_id = step.organization_id
  left join private.ai_execution_step_budget_reservations reservation
    on reservation.id = attempt.reservation_id
    and reservation.organization_id = step.organization_id
  left join private.ai_execution_dispatch_claims claim
    on claim.attempt_id = attempt.id
    and claim.organization_id = step.organization_id
  left join lateral (
    select count(*)::integer as route_count
      from private.ai_execution_fallback_claims fallback
      where fallback.claim_id = claim.id
  ) fallbacks on true
  left join lateral (
    select count(*)::integer as rejection_count
      from private.ai_execution_route_rejections rejection
      where rejection.claim_id = claim.id
  ) rejections on true
  left join public.ai_execution_step_outputs output
    on output.attempt_id = attempt.id
    and output.organization_id = step.organization_id
  left join public.ai_execution_step_output_reviews review
    on review.output_id = output.id
    and review.organization_id = step.organization_id
  where step.job_id = job.id and step.organization_id = p_organization_id;
  return jsonb_build_object('job_id', job.id, 'steps', steps);
end;
$$;
revoke all on function public.get_pipeline_ai_job_status(uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.get_pipeline_ai_job_status(uuid, uuid)
  to authenticated;
commit;
