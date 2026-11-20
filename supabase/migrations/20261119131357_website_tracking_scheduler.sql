create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;
create table private.website_tracking_scheduler(singleton boolean primary key default true check(singleton),endpoint text not null,key_hash text not null,secret_id uuid not null,enabled boolean not null default false);
alter table private.website_tracking_scheduler enable row level security;
revoke all on private.website_tracking_scheduler from public,anon,authenticated,service_role;
create function public.website_tracking_machine_key(p_key text) returns boolean language sql security definer set search_path='' as $$
 select auth.role()='service_role' and length(p_key) between 32 and 128 and exists(select from private.website_tracking_scheduler where enabled and key_hash=encode(sha256(convert_to(p_key,'UTF8')),'hex'))
$$;
revoke all on function public.website_tracking_machine_key(text) from public,anon,authenticated;
grant execute on function public.website_tracking_machine_key(text) to service_role;
create function private.wake_website_tracking() returns bigint language plpgsql security definer set search_path='' as $$
declare config private.website_tracking_scheduler;secret text;
begin
 select * into config from private.website_tracking_scheduler where enabled;
 if not found then return null;end if;
 select decrypted_secret into strict secret from vault.decrypted_secrets where id=config.secret_id;
 return net.http_post(url:=config.endpoint,headers:=jsonb_build_object('Content-Type','application/json','x-anka-website-worker',secret),body:='{"action":"tick"}'::jsonb,timeout_milliseconds:=120000);
end;$$;
revoke all on function private.wake_website_tracking() from public,anon,authenticated,service_role;
create function private.install_website_tracking_scheduler(p_endpoint text) returns void language plpgsql security definer set search_path='' as $$
declare secret text;secret_id uuid;
begin
 if p_endpoint!~'^https://[a-z0-9]+\.supabase\.co/functions/v1/website-tracking$' then raise invalid_parameter_value;end if;
 if exists(select from private.website_tracking_scheduler) then
  if not exists(select from private.website_tracking_scheduler where endpoint=p_endpoint) then raise exception 'Existing scheduler endpoint differs';end if;
  update private.website_tracking_scheduler set enabled=true;
 else
  secret:=encode(extensions.gen_random_bytes(32),'hex');
  select vault.create_secret(secret,'anka_website_tracking_worker','Native website scheduler credential') into secret_id;
  insert into private.website_tracking_scheduler values(true,p_endpoint,encode(sha256(convert_to(secret,'UTF8')),'hex'),secret_id,true);
 end if;
 perform cron.schedule('anka-website-tracking','*/5 * * * *','select private.wake_website_tracking()');
end;$$;
revoke all on function private.install_website_tracking_scheduler(text) from public,anon,authenticated,service_role;
