-- D5 rollback-safe runtime verification. Run after the D5 migration is applied.

begin;

create temporary table d5_runtime_checks (
  check_name text primary key,
  passed boolean not null
) on commit drop;

do $$
declare
  v_organization_id uuid;
  v_engagement_id uuid;
  v_brand_id uuid;
  v_actor_id uuid := gen_random_uuid();
  v_content_artifact_id uuid := gen_random_uuid();
  v_campaign_artifact_id uuid := gen_random_uuid();
  v_content_version_id uuid := gen_random_uuid();
  v_content_version_2_id uuid := gen_random_uuid();
  v_campaign_version_id uuid := gen_random_uuid();
  v_number_def_id uuid;
  v_select_def_id uuid;
  v_rejected boolean;
begin
  select engagement.organization_id, engagement.id, engagement.brand_id
  into v_organization_id, v_engagement_id, v_brand_id
  from public.engagements engagement
  order by engagement.created_at
  limit 1;
  if v_engagement_id is null then
    raise exception 'D5 verification requires one engagement';
  end if;

  insert into auth.users (id) values (v_actor_id);
  insert into public.organization_memberships (
    organization_id, user_id, member_kind, role, department_id, status
  ) values (
    v_organization_id, v_actor_id, 'team', 'contributor', 'content', 'active'
  );

  insert into public.artifacts (
    id, organization_id, engagement_id, brand_id, artifact_type, title, created_by
  ) values
    (v_content_artifact_id, v_organization_id, v_engagement_id, v_brand_id,
      'content', 'D5 Content verification artifact', v_actor_id),
    (v_campaign_artifact_id, v_organization_id, v_engagement_id, v_brand_id,
      'campaign_brief', 'D5 cross-type verification artifact', v_actor_id);

  insert into public.artifact_versions (
    id, organization_id, artifact_id, version_number, content, content_checksum, created_by
  ) values
    (v_content_version_id, v_organization_id, v_content_artifact_id, 1,
      '{"kind":"content"}'::jsonb,
      encode(digest('d5-content-' || gen_random_uuid(), 'sha256'), 'hex'), v_actor_id),
    (v_campaign_version_id, v_organization_id, v_campaign_artifact_id, 1,
      '{"kind":"campaign"}'::jsonb,
      encode(digest('d5-campaign-' || gen_random_uuid(), 'sha256'), 'hex'), v_actor_id);

  v_number_def_id := (public.create_artifact_custom_field_definition(
    v_organization_id, 'content', 'd5_verification_number', 'number', null, v_actor_id
  )->>'id')::uuid;
  v_select_def_id := (public.create_artifact_custom_field_definition(
    v_organization_id, 'content', 'd5_verification_channel', 'single_select',
    '["blog", "email"]'::jsonb, v_actor_id
  )->>'id')::uuid;

  v_rejected := false;
  begin
    perform public.save_artifact_custom_field_value(
      v_content_version_id, v_number_def_id, '"not a number"'::jsonb, v_actor_id
    );
  exception when others then
    v_rejected := sqlerrm like '%must be numeric%';
  end;
  insert into d5_runtime_checks values ('number_field_rejects_text', v_rejected);

  v_rejected := false;
  begin
    perform public.save_artifact_custom_field_value(
      v_content_version_id, v_select_def_id, '"social"'::jsonb, v_actor_id
    );
  exception when others then
    v_rejected := sqlerrm like '%defined options%';
  end;
  insert into d5_runtime_checks values ('single_select_rejects_unknown_option', v_rejected);

  v_rejected := false;
  begin
    perform public.save_artifact_custom_field_value(
      v_campaign_version_id, v_number_def_id, '1250'::jsonb, v_actor_id
    );
  exception when others then
    v_rejected := sqlerrm like '%does not match the artifact type%';
  end;
  insert into d5_runtime_checks values ('content_field_rejects_campaign_brief_version', v_rejected);

  perform public.save_artifact_custom_field_value(
    v_content_version_id, v_number_def_id, '1250'::jsonb, v_actor_id
  );
  insert into d5_runtime_checks values ('valid_exact_version_value_saved', exists (
    select 1 from public.artifact_custom_field_values
    where artifact_version_id = v_content_version_id
      and field_def_id = v_number_def_id
      and value = '1250'::jsonb
  ));

  -- Create the next artifact version only after version 1 has a custom-field
  -- value. D5 must not copy that separate metadata row to the new version.
  insert into public.artifact_versions (
    id, organization_id, artifact_id, version_number, parent_version_id,
    content, content_checksum, created_by
  ) values (
    v_content_version_2_id, v_organization_id, v_content_artifact_id, 2,
    v_content_version_id, '{"kind":"content","revision":2}'::jsonb,
    encode(digest('d5-content-v2-' || gen_random_uuid(), 'sha256'), 'hex'), v_actor_id
  );
  insert into d5_runtime_checks values ('new_version_custom_fields_start_empty',
    exists (
      select 1 from public.artifact_custom_field_values
      where artifact_version_id = v_content_version_id
        and field_def_id = v_number_def_id
        and value = '1250'::jsonb
    )
    and not exists (
      select 1 from public.artifact_custom_field_values
      where artifact_version_id = v_content_version_2_id
    )
  );

  insert into d5_runtime_checks values ('custom_value_write_does_not_approve', not exists (
    select 1 from public.artifact_approvals
    where artifact_version_id in (
      v_content_version_id, v_content_version_2_id, v_campaign_version_id
    )
  ));

  insert into d5_runtime_checks values ('starter_content_fields_seeded', (
    select count(*) = 4 from public.artifact_custom_field_defs
    where organization_id = v_organization_id
      and artifact_type = 'content'
      and name in ('word_count', 'seo_score', 'target_keyword', 'channel')
  ));

  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', v_actor_id, 'role', 'authenticated'
  )::text, true);
  set local role authenticated;
  insert into d5_runtime_checks values ('organization_rls_allows_team_reads',
    (select count(*) > 0 from public.artifact_custom_field_defs where organization_id = v_organization_id)
    and (select count(*) = 1 from public.artifact_custom_field_values where artifact_version_id = v_content_version_id)
  );
  reset role;
end;
$$;

select jsonb_build_object(
  'exact_definition_columns', (
    select array_agg(column_name::text order by ordinal_position) = array[
      'id', 'organization_id', 'artifact_type', 'name', 'field_type',
      'options', 'created_by', 'created_at'
    ]::text[] from information_schema.columns
    where table_schema = 'public' and table_name = 'artifact_custom_field_defs'
  ),
  'exact_value_columns', (
    select array_agg(column_name::text order by ordinal_position) = array[
      'id', 'organization_id', 'artifact_version_id', 'field_def_id', 'value'
    ]::text[] from information_schema.columns
    where table_schema = 'public' and table_name = 'artifact_custom_field_values'
  ),
  'rls_enabled', (
    select bool_and(relrowsecurity) from pg_class
    where oid in (
      'public.artifact_custom_field_defs'::regclass,
      'public.artifact_custom_field_values'::regclass
    )
  ),
  'browser_is_read_only',
    has_table_privilege('authenticated', 'public.artifact_custom_field_defs', 'select')
    and has_table_privilege('authenticated', 'public.artifact_custom_field_values', 'select')
    and not has_table_privilege('authenticated', 'public.artifact_custom_field_defs', 'insert, update, delete')
    and not has_table_privilege('authenticated', 'public.artifact_custom_field_values', 'insert, update, delete')
    and not has_table_privilege('anon', 'public.artifact_custom_field_defs', 'select, insert, update, delete')
    and not has_table_privilege('anon', 'public.artifact_custom_field_values', 'select, insert, update, delete')
) || (select jsonb_object_agg(check_name, passed) from d5_runtime_checks);

rollback;
