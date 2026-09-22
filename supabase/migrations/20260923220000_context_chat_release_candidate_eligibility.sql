-- Only unresolved claims without a recorded AI run are eligible for independent no-charge release.
-- Reviewer-only metadata for held private conversation provider claims.
-- Never returns conversation text, prompt, output, or connector credentials.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

create or replace function public.list_context_chat_release_candidates(
  p_organization_id uuid, p_offset integer default 0
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  reviewer uuid := (select auth.uid());
  items jsonb;
  has_more boolean;
begin
  if reviewer is null or p_organization_id is null or p_offset is null
    or p_offset < 0 or p_offset > 10000 then
    raise exception 'Exact organization and bounded page are required.' using errcode = '22023';
  end if;
  perform 1 from public.organizations organization
    join public.organization_memberships membership
      on membership.organization_id = organization.id
    where organization.id = p_organization_id and organization.status = 'active'
      and membership.user_id = reviewer and membership.member_kind = 'team'
      and membership.status = 'active'
      and membership.role in ('system_owner', 'operations_admin');
  if not found then
    raise exception 'Current owner or operations review authority is required.' using errcode = '42501';
  end if;
  select coalesce(jsonb_agg(to_jsonb(item) order by item.claimed_at desc, item.claim_id desc), '[]'::jsonb)
    into items
    from (
      select claim.id as claim_id, claim.message_id, claim.actor_id,
        claim.claimed_at, reservation.status as reservation_status,
        reservation.max_cost_microusd, reservation.outcome_evidence,
        connection.provider, model.model_id
      from private.context_chat_dispatch_claims claim
      join private.ai_execution_step_budget_reservations reservation
        on reservation.id = claim.reservation_id
       and reservation.organization_id = claim.organization_id
       and reservation.context_chat_message_id = claim.message_id
      join public.context_chat_organization_models model
        on model.id = claim.model_configuration_id
       and model.organization_id = claim.organization_id
      join public.integration_connections connection
        on connection.id = model.connector_connection_id
       and connection.organization_id = model.organization_id
      where claim.organization_id = p_organization_id
        and reservation.status in ('reserved', 'uncertain')
        and reservation.ai_run_id is null
        and not exists (select 1 from private.context_chat_confirmed_release_reviews review
          where review.claim_id = claim.id)
      order by claim.claimed_at desc, claim.id desc
      limit 51 offset p_offset
    ) item;
  has_more := jsonb_array_length(items) > 50;
  if has_more then items := items - 50; end if;
  return jsonb_build_object('items', items, 'has_more', has_more);
end;
$$;
revoke all on function public.list_context_chat_release_candidates(uuid,integer)
  from public, anon, authenticated, service_role;
grant execute on function public.list_context_chat_release_candidates(uuid,integer)
  to authenticated;
comment on function public.list_context_chat_release_candidates(uuid,integer) is
  'Reviewer-only held-claim metadata with no owner-private conversation content.';
commit;
