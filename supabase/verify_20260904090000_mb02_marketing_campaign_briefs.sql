begin;

select 1 / (case when to_regclass('public.marketing_brief_save_requests') is not null then 1 else 0 end);

do $$
begin
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'save_marketing_campaign_brief'
  ) then raise exception 'save_marketing_campaign_brief RPC is missing'; end if;
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'create_marketing_campaign_brief_approval_request'
  ) then raise exception 'campaign brief approval RPC is missing'; end if;
  if has_function_privilege('authenticated',
    'public.create_marketing_campaign_brief_approval_request(uuid,text,uuid[],uuid)', 'execute') then
    raise exception 'Authenticated users must not invoke the campaign brief approval RPC directly';
  end if;
  if has_table_privilege('authenticated', 'public.marketing_brief_save_requests', 'select') then
    raise exception 'Authenticated users must not read the idempotency ledger';
  end if;
end;
$$;

rollback;
