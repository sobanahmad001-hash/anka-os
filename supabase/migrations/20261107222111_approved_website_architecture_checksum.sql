-- PostgreSQL JSONB text is the representation pinned by Website page registration.
begin;

do $check$
begin
  if md5(replace(pg_get_functiondef('private.website_approved_source(uuid,uuid,uuid)'::regprocedure), chr(13), ''))
       is distinct from '8fbd479e8c1a8ab7b665196d1d1987a4' then
    raise exception 'Website architecture reader prerequisite differs';
  end if;
end
$check$;

-- Historical Content Studio architecture keys are lowercase ASCII words with
-- underscores. Their numeric fields are safe integers. Reject other shapes
-- instead of guessing how another JavaScript value would have been serialized.
create function private.website_legacy_json(p_value jsonb, p_depth integer)
returns text language plpgsql immutable strict security invoker set search_path = '' as $$
declare
  serialized text;
begin
  if p_depth > 8 then return null; end if;
  case jsonb_typeof(p_value)
    when 'object' then
      with parts as materialized (
        select key as k, private.website_legacy_json(value, p_depth + 1) as v from jsonb_each(p_value)
      )
      select case when count(*) = count(v) and coalesce(bool_and(k collate "C" ~ '^[a-z_]+$'), true)
        then '{' || coalesce(string_agg(to_jsonb(k)::text || ':' || v, ',' order by k collate "C"), '') || '}' end
      into serialized from parts;
    when 'array' then
      with parts as materialized (
        select ordinal, private.website_legacy_json(value, p_depth + 1) as v
        from jsonb_array_elements(p_value) with ordinality a(value, ordinal)
      )
      select case when count(*) = count(v)
        then '[' || coalesce(string_agg(v, ',' order by ordinal), '') || ']' end
      into serialized from parts;
    when 'number' then
      if (p_value::text)::numeric <> trunc((p_value::text)::numeric)
        or abs((p_value::text)::numeric) > 9007199254740991 then return null; end if;
      serialized := ((p_value::text)::numeric)::bigint::text;
    else serialized := p_value::text;
  end case;
  return serialized;
end;
$$;
revoke all on function private.website_legacy_json(jsonb,integer) from public,anon,authenticated,service_role;

-- Convert a verified historical writer digest only on insertion. Other types
-- and already canonical inserts retain the caller's original representation.
create function private.canonicalize_new_website_architecture()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  canonical text;
begin
  if exists (select 1 from public.artifacts a where a.id = new.artifact_id
      and a.organization_id = new.organization_id and a.artifact_type = 'website_architecture') then
    canonical := encode(sha256(convert_to(new.content::text,'UTF8')),'hex');
    if new.content_checksum <> canonical and new.content_checksum =
        encode(sha256(convert_to(private.website_legacy_json(new.content,0),'UTF8')),'hex') then
      new.content_checksum := canonical;
    end if;
  end if;
  return new;
end;
$$;
revoke all on function private.canonicalize_new_website_architecture() from public,anon,authenticated,service_role;
create trigger canonicalize_new_website_architecture before insert on public.artifact_versions
  for each row when (new.content ? 'pages') execute function private.canonicalize_new_website_architecture();

create or replace function private.website_approved_source(p_org uuid,p_project uuid,p_version uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare ref jsonb;artifact public.artifacts;engagement public.engagements;version public.artifact_versions;begin
 ref:=private.require_pipeline_approved_artifact(p_org,p_project,p_version,'website_architecture',null);
 select * into artifact from public.artifacts where id=(ref->>'artifact_id')::uuid and organization_id=p_org;
 select * into engagement from public.engagements where id=artifact.engagement_id and organization_id=p_org for share;
 select * into version from public.artifact_versions where id=p_version and organization_id=p_org;
 if engagement.id is null or engagement.project_id is distinct from p_project or artifact.brand_id is distinct from engagement.brand_id or engagement.status not in ('planning','active')
  or version.content_checksum is null
  or (encode(sha256(convert_to(version.content::text,'UTF8')),'hex') is distinct from version.content_checksum
      and encode(sha256(convert_to(private.website_legacy_json(version.content,0),'UTF8')),'hex') is distinct from version.content_checksum)
 then raise exception 'Exact same-project/engagement/brand approved architecture required' using errcode='42501';end if;
 return jsonb_build_object('reference',ref,'engagement_id',engagement.id,'brand_id',engagement.brand_id,'pages',private.website_architecture_pages(version.content));
end;$$;

commit;
