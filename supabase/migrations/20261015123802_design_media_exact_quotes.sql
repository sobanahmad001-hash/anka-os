begin;
set local lock_timeout='5s';
-- Reviewed immutable rate configurations, never browser prices or secret values.
create table private.design_media_rates(
 id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id),
 provider text not null check(provider in ('openai','higgsfield')),model_id text not null,
 settings jsonb not null check(jsonb_typeof(settings)='object'),unit_max_charge_microusd bigint not null check(unit_max_charge_microusd between 1 and 90071992547409),
 source_url text not null check(source_url like 'https://open.higgsfield.ai/%' or source_url like 'https://developers.openai.com/%' or source_url like 'https://openai.com/%'),
 verified_at timestamptz not null,valid_until timestamptz not null,created_by uuid not null references auth.users(id),created_at timestamptz not null default clock_timestamp(),
 check(valid_until>verified_at and valid_until<=verified_at+interval '24 hours'),unique(id,organization_id)
);
create table private.design_media_quotes(
 id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id),actor_id uuid not null references auth.users(id),
 rate_id uuid not null,request jsonb not null check(jsonb_typeof(request)='object'),request_checksum text not null check(request_checksum~'^[a-f0-9]{64}$'),
 currency text not null default 'USD' check(currency='USD'),unit_max_charge_microusd bigint not null,total_max_charge_microusd bigint not null check(total_max_charge_microusd between 1 and 9007199254740991),
 verified_at timestamptz not null,valid_until timestamptz not null,created_at timestamptz not null default clock_timestamp(),
 foreign key(rate_id,organization_id) references private.design_media_rates(id,organization_id),unique(id,organization_id)
);
alter table private.design_media_rates enable row level security;
alter table private.design_media_quotes enable row level security;
revoke all on private.design_media_rates,private.design_media_quotes from public,anon,authenticated,service_role;
grant select,insert on private.design_media_rates,private.design_media_quotes to service_role;

create function public.configure_design_media_rate(p_org uuid,p_actor uuid,p_provider text,p_model text,p_settings jsonb,p_unit_max bigint,p_source text,p_verified_at timestamptz,p_valid_until timestamptz)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare r private.design_media_rates;
begin
 perform 1 from public.organization_memberships m join public.organizations o on o.id=m.organization_id
 where m.organization_id=p_org and m.user_id=p_actor and m.status='active' and o.status='active'
 and m.member_kind='team' and m.role in ('system_owner','operations_admin') for share of m,o;
 if not found then raise exception 'Administrator pricing authority required.' using errcode='42501';end if;
 if p_verified_at>clock_timestamp() or p_valid_until<=clock_timestamp() or jsonb_typeof(p_settings)<>'object'
 or p_provider not in ('openai','higgsfield') or nullif(btrim(p_model),'') is null then raise exception 'Current reviewed exact rate required.' using errcode='22023';end if;
 -- Serialize exact rate publication with quote and acceptance snapshots.
 perform pg_advisory_xact_lock(hashtextextended(jsonb_build_array('design_media_rate',p_org,p_provider,p_model,p_settings)::text,0));
 if p_verified_at>clock_timestamp() or p_valid_until<=clock_timestamp() then raise exception 'Reviewed rate expired while waiting.' using errcode='40001';end if;
 if (p_provider='higgsfield' and p_source not like 'https://open.higgsfield.ai/%') or (p_provider='openai' and p_source not like 'https://developers.openai.com/%' and p_source not like 'https://openai.com/%') then raise exception 'Official source for selected provider required.' using errcode='22023';end if;
 insert into private.design_media_rates(organization_id,provider,model_id,settings,unit_max_charge_microusd,source_url,verified_at,valid_until,created_by)
 values(p_org,p_provider,p_model,p_settings,p_unit_max,p_source,p_verified_at,p_valid_until,p_actor) returning * into r;
 return to_jsonb(r);
end;$$;
revoke all on function public.configure_design_media_rate(uuid,uuid,text,text,jsonb,bigint,text,timestamptz,timestamptz) from public,anon,authenticated,service_role;
grant execute on function public.configure_design_media_rate(uuid,uuid,text,text,jsonb,bigint,text,timestamptz,timestamptz) to service_role;

create function public.list_design_media_rates(p_org uuid,p_actor uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
begin
 perform 1 from public.organization_memberships m join public.organizations o on o.id=m.organization_id
 where m.organization_id=p_org and m.user_id=p_actor and m.status='active' and o.status='active'
 and m.member_kind='team' and m.role in ('system_owner','operations_admin') for share of m,o;
 if not found then raise exception 'Administrator pricing authority required.' using errcode='42501';end if;
 return coalesce((select jsonb_agg(to_jsonb(r) order by r.created_at desc,r.id desc) from
 (select distinct on (provider,model_id,settings) * from private.design_media_rates
 where organization_id=p_org order by provider,model_id,settings,created_at desc,id desc) r),'[]'::jsonb);
end;$$;
revoke all on function public.list_design_media_rates(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.list_design_media_rates(uuid,uuid) to service_role;

-- Called only after provider capability and canonical request resolution in the endpoint.
-- Rechecks the canonical brief and current actor before issuing an exact total quote.
create function private.require_design_media_request_context(p_org uuid,p_actor uuid,p_request jsonb) returns void language plpgsql security invoker set search_path='' as $$
declare b public.design_creative_briefs;v public.design_creative_brief_versions;n integer;kind text;
begin
 perform 1 from public.organization_memberships m join public.organizations o on o.id=m.organization_id
 where m.organization_id=p_org and m.user_id=p_actor and m.status='active' and o.status='active' and m.member_kind='team'
 and (m.role in ('system_owner','operations_admin','executive') or m.department_id='design') for share of m,o;
 if not found then raise exception 'Current Design authority required.' using errcode='42501';end if;
 if p_request->>'organization_id' is distinct from p_org::text or jsonb_typeof(p_request->'settings') is distinct from 'object'
 or jsonb_typeof(p_request->'input_versions') is distinct from 'array'
 or coalesce(p_request->>'prompt_checksum','') !~ '^[a-f0-9]{64}$' then raise exception 'Exact media request required.' using errcode='22023';end if;
 n:=(p_request->>'output_count')::integer;
 if n is null or n not between 1 and 100 then raise exception 'Bounded output count required.' using errcode='22023';end if;
 select * into v from public.design_creative_brief_versions where id=(p_request->>'creative_brief_version_id')::uuid and organization_id=p_org;
 if not found then raise exception 'Canonical brief version unavailable.' using errcode='42501';end if;
 select * into b from public.design_creative_briefs where id=v.creative_brief_id and organization_id=p_org for share;
 if b.frozen_version_id is distinct from v.id or v.validation_snapshot->>'valid' is distinct from 'true' then raise exception 'Exact confirmed brief required.' using errcode='40001';end if;
 kind:=p_request#>>'{context,kind}';
 if b.visibility='private' then
  if b.created_by<>p_actor or kind is distinct from 'private' then raise exception 'Private brief is owner-only.' using errcode='42501';end if;
  perform 1 from public.department_chat_conversations c where c.id=(p_request#>>'{context,id}')::uuid and c.organization_id=p_org and c.owner_id=p_actor and c.state='active' and c.department_id='design' and c.context_kind='department_private' for share;
 else
  if kind is distinct from 'engagement' or p_request#>>'{context,id}' is distinct from b.engagement_id::text or p_request#>>'{context,service_id}' is distinct from b.engagement_service_id::text then raise exception 'Exact service context required.' using errcode='42501';end if;
  perform 1 from public.engagement_services es join public.service_catalog sc on sc.id=es.service_id join public.engagements e on e.id=es.engagement_id and e.organization_id=es.organization_id join public.projects p on p.id=e.project_id and p.organization_id=e.organization_id
  where es.id=b.engagement_service_id and es.organization_id=p_org and es.engagement_id=b.engagement_id and es.status='active' and sc.department_id='design' and sc.is_active and e.status in ('planning','active') and p.archived_at is null for share of es,sc,e,p;
 end if;
 if not found then raise exception 'Current media context unavailable.' using errcode='42501';end if;
end;$$;
revoke all on function private.require_design_media_request_context(uuid,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function private.require_design_media_request_context(uuid,uuid,jsonb) to service_role;

create function public.quote_design_media_request(p_org uuid,p_actor uuid,p_request jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare r private.design_media_rates;q private.design_media_quotes;b public.design_creative_briefs;v public.design_creative_brief_versions;n integer;kind text;
begin
 perform private.require_design_media_request_context(p_org,p_actor,p_request);
 n:=(p_request->>'output_count')::integer;
 perform pg_advisory_xact_lock(hashtextextended(jsonb_build_array('design_media_rate',p_org,p_request->>'provider',p_request->>'model_id',p_request->'settings')::text,0));
 select * into r from private.design_media_rates where organization_id=p_org and provider=p_request->>'provider' and model_id=p_request->>'model_id' and settings=p_request->'settings' order by created_at desc,id desc limit 1;
 if not found or r.verified_at>clock_timestamp() or r.valid_until<=clock_timestamp() then raise exception 'Fresh reviewed exact price unavailable.' using errcode='55000';end if;
 insert into private.design_media_quotes(organization_id,actor_id,rate_id,request,request_checksum,unit_max_charge_microusd,total_max_charge_microusd,verified_at,valid_until)
 values(p_org,p_actor,r.id,p_request,encode(sha256(convert_to(p_request::text,'UTF8')),'hex'),r.unit_max_charge_microusd,r.unit_max_charge_microusd*n,r.verified_at,r.valid_until) returning * into q;
 return to_jsonb(q);
end;$$;
revoke all on function public.quote_design_media_request(uuid,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.quote_design_media_request(uuid,uuid,jsonb) to service_role;

create table private.design_media_acceptances(
 organization_id uuid not null references public.organizations(id),actor_id uuid not null references auth.users(id),operation_key uuid not null,
 quote_id uuid not null,request_checksum text not null,total_max_charge_microusd bigint not null,
 confirmed_above_threshold boolean not null,created_at timestamptz not null default clock_timestamp(),
 primary key(organization_id,actor_id,operation_key),foreign key(quote_id,organization_id) references private.design_media_quotes(id,organization_id)
);
alter table private.design_media_acceptances enable row level security;
revoke all on private.design_media_acceptances from public,anon,authenticated,service_role;
grant select,insert on private.design_media_acceptances to service_role;
create function public.accept_design_media_quote(p_org uuid,p_actor uuid,p_quote uuid,p_operation uuid,p_request jsonb,p_acceptance jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare q private.design_media_quotes;r private.design_media_rates;a private.design_media_acceptances;
begin
 if p_operation is null then raise exception 'Stable operation identity required.' using errcode='22023';end if;
 perform private.require_design_media_request_context(p_org,p_actor,p_request);
 perform pg_advisory_xact_lock(hashtextextended(p_org::text||':'||p_actor::text||':'||p_operation::text,0));
 select * into q from private.design_media_quotes where id=p_quote and organization_id=p_org and actor_id=p_actor for share;
 if not found or q.request is distinct from p_request or q.valid_until<=clock_timestamp() or q.verified_at>clock_timestamp() then raise exception 'Fresh exact actor-owned quote required.' using errcode='40001';end if;
 perform pg_advisory_xact_lock(hashtextextended(jsonb_build_array('design_media_rate',p_org,p_request->>'provider',p_request->>'model_id',p_request->'settings')::text,0));
 select * into r from private.design_media_rates where organization_id=p_org and provider=p_request->>'provider' and model_id=p_request->>'model_id' and settings=p_request->'settings' order by created_at desc,id desc limit 1;
 if r.id is distinct from q.rate_id or r.valid_until<=clock_timestamp() or q.total_max_charge_microusd<>r.unit_max_charge_microusd*(p_request->>'output_count')::integer then raise exception 'Price changed; review a fresh quote.' using errcode='40001';end if;
 if p_acceptance->>'generate' is distinct from 'true' or p_acceptance->>'quote_id' is distinct from q.id::text
 or p_acceptance->>'request_checksum' is distinct from q.request_checksum
 or p_acceptance->>'total_max_charge_microusd' is distinct from q.total_max_charge_microusd::text
 or (q.total_max_charge_microusd>2000000 and p_acceptance->>'confirm_above_threshold' is distinct from 'true') then
 raise exception 'Explicit pre-charge acceptance of the exact total required.' using errcode='42501';end if;
 select * into a from private.design_media_acceptances where organization_id=p_org and actor_id=p_actor and operation_key=p_operation;
 if found then
  if a.quote_id<>q.id or a.request_checksum<>q.request_checksum or a.total_max_charge_microusd<>q.total_max_charge_microusd then raise exception 'Operation already belongs to another media request.' using errcode='23505';end if;
  return to_jsonb(a)||jsonb_build_object('idempotent_replay',true);
 end if;
 insert into private.design_media_acceptances(organization_id,actor_id,operation_key,quote_id,request_checksum,total_max_charge_microusd,confirmed_above_threshold)
 values(p_org,p_actor,p_operation,q.id,q.request_checksum,q.total_max_charge_microusd,q.total_max_charge_microusd>2000000) returning * into a;
 return to_jsonb(a)||jsonb_build_object('idempotent_replay',false);
end;$$;
revoke all on function public.accept_design_media_quote(uuid,uuid,uuid,uuid,jsonb,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.accept_design_media_quote(uuid,uuid,uuid,uuid,jsonb,jsonb) to service_role;

commit;
