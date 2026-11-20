-- Stable authorization revision; ordinary access-token renewal is not a new grant.
-- No scheduler or resource is enabled by this migration.
alter table public.integration_oauth_credentials add column grant_updated_at timestamptz not null default clock_timestamp();
create function private.track_oauth_grant_revision() returns trigger language plpgsql set search_path='' as $$
begin
 if tg_op='INSERT' then new.grant_updated_at:=clock_timestamp();
 elsif (new.connection_id,new.organization_id,new.provider,new.provider_subject_hash,new.granted_scopes,new.refresh_token_ciphertext,new.refresh_token_iv)
  is distinct from (old.connection_id,old.organization_id,old.provider,old.provider_subject_hash,old.granted_scopes,old.refresh_token_ciphertext,old.refresh_token_iv)
 then new.grant_updated_at:=clock_timestamp();
 else new.grant_updated_at:=old.grant_updated_at;
 end if;
 return new;
end;$$;
revoke all on function private.track_oauth_grant_revision() from public,anon,authenticated,service_role;
create trigger oauth_grant_revision before insert or update on public.integration_oauth_credentials
for each row execute function private.track_oauth_grant_revision();
