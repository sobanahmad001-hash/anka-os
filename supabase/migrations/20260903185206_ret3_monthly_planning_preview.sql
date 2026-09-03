-- RET3: read-only plan-local month enumeration for manual retainer planning.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

create or replace function public.preview_recurring_work_month(
  p_plan_id uuid,
  p_month_start date,
  p_past_period_reason text,
  p_actor_id uuid
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_plan public.recurring_work_plans;
  v_month_end date;
  v_periods jsonb := '[]'::jsonb;
  v_has_approved_overlap boolean := false;
  v_reasons jsonb := '[]'::jsonb;
begin
  if p_month_start is null or p_month_start <> date_trunc('month', p_month_start)::date then
    raise exception 'Month start must be the first day of a calendar month.' using errcode = '22023';
  end if;
  select * into v_plan from public.recurring_work_plans where id = p_plan_id;
  if not found then raise exception 'Recurring plan not found.' using errcode = 'P0002'; end if;
  perform private.assert_recurring_generation_actor(v_plan, p_actor_id);
  v_month_end := (p_month_start + interval '1 month')::date;

  select exists (
    select 1 from public.recurring_work_plan_versions version
    join public.recurring_work_plan_version_approvals approval
      on approval.plan_version_id = version.id and approval.plan_id = version.plan_id
      and approval.organization_id = version.organization_id
    where version.plan_id = v_plan.id and version.organization_id = v_plan.organization_id
      and version.effective_start < v_month_end
      and (version.effective_end is null or version.effective_end >= p_month_start)
  ) into v_has_approved_overlap;

  with candidate_dates as (
    select day_value::date as period_start
    from generate_series(p_month_start::timestamp, (v_month_end - 1)::timestamp, interval '1 day') day_value
  ),
  applicable_versions as (
    select candidate.period_start, version.frequency, version.effective_start
    from candidate_dates candidate
    cross join lateral (
      select candidate_version.*
      from public.recurring_work_plan_versions candidate_version
      join public.recurring_work_plan_version_approvals approval
        on approval.plan_version_id = candidate_version.id and approval.plan_id = candidate_version.plan_id
        and approval.organization_id = candidate_version.organization_id
      where candidate_version.plan_id = v_plan.id
        and candidate_version.organization_id = v_plan.organization_id
        and candidate_version.effective_start <= candidate.period_start
        and (candidate_version.effective_end is null or candidate_version.effective_end >= candidate.period_start)
      order by candidate_version.effective_start desc, candidate_version.version_number desc limit 1
    ) version
  ),
  canonical_periods as (
    select applicable.period_start from applicable_versions applicable
    where (
      applicable.frequency = 'weekly'
      and mod(applicable.period_start - applicable.effective_start, 7) = 0
    ) or (
      applicable.frequency = 'monthly'
      and private.recurring_month_anchor(
        applicable.effective_start,
        (extract(year from applicable.period_start)::integer - extract(year from applicable.effective_start)::integer) * 12
        + extract(month from applicable.period_start)::integer
        - extract(month from applicable.effective_start)::integer
      ) = applicable.period_start
    )
  ),
  previews as (
    select canonical.period_start,
      private.build_recurring_period_preview(v_plan.id, canonical.period_start, p_past_period_reason, p_actor_id) as preview
    from canonical_periods canonical
  )
  select coalesce(jsonb_agg(preview order by period_start), '[]'::jsonb) into v_periods from previews;

  if jsonb_array_length(v_periods) = 0 then
    v_reasons := jsonb_build_array(
      case when v_has_approved_overlap then 'no_period_start_in_month' else 'no_approved_effective_version' end
    );
  end if;

  return jsonb_build_object(
    'plan_id', v_plan.id, 'month_start', p_month_start, 'month_end', v_month_end,
    'membership_rule', 'period_start_in_month', 'reasons', v_reasons, 'periods', v_periods
  );
end;
$$;

revoke all on function public.preview_recurring_work_month(uuid, date, text, uuid)
  from public, anon, authenticated;
grant execute on function public.preview_recurring_work_month(uuid, date, text, uuid) to service_role;

comment on function public.preview_recurring_work_month(uuid, date, text, uuid) is
  'RET3 service-owner-only read-only enumeration of canonical period starts within one plan-local calendar month.';

commit;
