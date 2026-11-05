-- Read-only project-scoped allowance readiness before a conversation exists.
begin;
do $guard$ begin
 if md5(pg_get_functiondef('private.project_chat_allowance_context(uuid,uuid,uuid,uuid,bigint)'::regprocedure)) is distinct from '7e06cd7057a3b0702b77099052e505c8' then raise exception 'Project allowance predicate changed';end if;
 if md5(pg_get_functiondef('public.assert_context_chat_organization_model(uuid,uuid,uuid)'::regprocedure)) is distinct from '627e5abcd9dea62d4bb250a1d98c3ec9' then raise exception 'Model authority changed';end if;
end;$guard$;
create function public.read_new_project_chat_allowance(p_org uuid,p_actor uuid,p_project uuid,p_model uuid,p_cost bigint) returns jsonb
language plpgsql security definer set search_path='' as $function$
begin
 perform 1 from private.ai_execution_budget_limits where organization_id=p_org for update;
 if not found then return jsonb_build_object('status','unavailable');end if;
 perform public.assert_context_chat_organization_model(p_model,p_org,p_actor);
 perform 1 from public.organization_memberships where organization_id=p_org and user_id=p_actor
  and status='active' and member_kind='team' and role='system_owner' for share;
 if not found then raise exception 'Current organization owner required' using errcode='42501';end if;
 perform 1 from public.projects where id=p_project and organization_id=p_org and archived_at is null for share;
 if not found then raise exception 'Current project required' using errcode='42501';end if;
 if not exists(select 1 from private.ai_execution_budget_reservations where organization_id=p_org
  and cycle_month<>date_trunc('month',timezone('UTC',clock_timestamp()))::date and status in ('reserved','uncertain'))
 and not exists(select 1 from private.ai_execution_step_budget_reservations where organization_id=p_org
  and cycle_month<>date_trunc('month',timezone('UTC',clock_timestamp()))::date and status in ('reserved','uncertain')) then
  return jsonb_build_object('status','not_required');
 end if;
 return private.project_chat_allowance_context(p_org,p_actor,p_project,p_model,p_cost);
end;
$function$;
revoke all on function public.read_new_project_chat_allowance(uuid,uuid,uuid,uuid,bigint) from public,anon,authenticated,service_role;
grant execute on function public.read_new_project_chat_allowance(uuid,uuid,uuid,uuid,bigint) to service_role;
commit;
