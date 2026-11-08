begin;

create table private.website_page_marketing_publications (
  version_id uuid primary key references public.pipeline_template_versions(id),
  organization_id uuid not null references public.organizations(id),
  published_by uuid not null references auth.users(id),
  preset_publication_id uuid not null unique references public.pipeline_template_publications(id),
  execution_publication_id uuid not null unique references public.pipeline_execution_publications(id),
  published_at timestamptz not null default now()
);
alter table private.website_page_marketing_publications enable row level security;
revoke all on private.website_page_marketing_publications from public, anon, authenticated, service_role;
create trigger protect_website_page_marketing_publication before update or delete
  on private.website_page_marketing_publications for each row execute function private.reject_pipeline_template_mutation();

create function public.publish_website_page_marketing_plan(p_organization_id uuid,p_version_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  actor uuid := auth.uid();
  version public.pipeline_template_versions;
  recorded private.website_page_marketing_publications;
  build_service uuid;
  seo_service uuid;
  selected uuid[];
  manifest jsonb;
  preset uuid;
  definition uuid;
  publication uuid;
  steps jsonb;
begin
  perform 1 from public.organizations o join public.organization_memberships m on m.organization_id=o.id
    where o.id=p_organization_id and o.status='active' and m.user_id=actor
      and m.member_kind='team' and m.status='active' and m.role in ('system_owner','operations_admin')
    for share of o,m;
  if not found then raise exception 'Current organization admin required' using errcode='42501'; end if;
  select * into version from public.pipeline_template_versions where id=p_version_id and organization_id=p_organization_id;
  if not found then raise exception 'Exact organization preset version required' using errcode='42501'; end if;
  perform 1 from public.pipeline_templates where id=version.pipeline_template_id and organization_id=p_organization_id for update;
  select * into recorded from private.website_page_marketing_publications where version_id=version.id and organization_id=p_organization_id;
  if not found then
    if exists(select 1 from public.pipeline_template_versions v where v.pipeline_template_id=version.pipeline_template_id and v.version_number>version.version_number)
      or exists(select 1 from public.pipeline_template_publications where pipeline_template_version_id=version.id) then
      raise exception 'Review the current unpublished preset version' using errcode='40001';
    end if;
    select c.id into build_service from public.service_catalog c
      where c.organization_id=p_organization_id and c.department_id='development'
        and c.slug='setup_development_website_page_build' and c.is_active for share;
    select c.id into seo_service from public.service_catalog c
      where c.organization_id=p_organization_id and c.department_id='marketing'
        and c.slug='setup_marketing_page_seo_optimization' and c.is_active for share;
    select array_agg(s.service_id order by s.position) into selected from public.pipeline_template_version_services s
      where s.organization_id=p_organization_id and s.pipeline_template_version_id=version.id;
    if build_service is null or seo_service is null or selected is distinct from array[build_service,seo_service] then
      raise exception 'Exact Website page build and Marketing page SEO services required in order' using errcode='22023';
    end if;
    manifest := private.pipeline_rule_manifest(p_organization_id,selected);
    insert into public.pipeline_template_publications(organization_id,pipeline_template_id,pipeline_template_version_id,publication_number,published_rule_manifest,published_rule_sha256,published_by)
      select p_organization_id,version.pipeline_template_id,version.id,coalesce(max(publication_number),0)+1,manifest,
        encode(extensions.digest(convert_to(manifest::text,'UTF8'),'sha256'),'hex'),actor
      from public.pipeline_template_publications where pipeline_template_id=version.pipeline_template_id returning id into preset;
    steps := jsonb_build_array(
      jsonb_build_object('key','website_page_build','label','Build the selected Website page','kind','human','department_id','development','service_id',build_service,'depends_on','[]'::jsonb),
      jsonb_build_object('key','website_page_review','label','Review the page and approved version for Marketing','kind','approval_gate','department_id','development','service_id',build_service,'depends_on',jsonb_build_array('website_page_build')),
      jsonb_build_object('key','marketing_page_seo','label','Optimize the reviewed page for search','kind','human','department_id','marketing','service_id',seo_service,'depends_on',jsonb_build_array('website_page_review')));
    definition := (public.create_pipeline_execution_definition(p_organization_id,preset,gen_random_uuid(),'Website page build to Marketing page SEO',steps)->>'definition_id')::uuid;
    insert into public.pipeline_execution_publications(organization_id,definition_id,published_by)
      values(p_organization_id,definition,actor) returning id into publication;
    insert into private.website_page_marketing_publications(version_id,organization_id,published_by,preset_publication_id,execution_publication_id)
      values(version.id,p_organization_id,actor,preset,publication) returning * into recorded;
  end if;
  return to_jsonb(recorded)||jsonb_build_object('plan_kind','website');
end;
$$;
revoke all on function public.publish_website_page_marketing_plan(uuid,uuid) from public, anon, authenticated, service_role;
grant execute on function public.publish_website_page_marketing_plan(uuid,uuid) to authenticated;
commit;
