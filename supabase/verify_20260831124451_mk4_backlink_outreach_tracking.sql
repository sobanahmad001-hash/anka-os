-- Rollback-safe MK4 verification. Run only after the migration is applied.

begin;

create temporary table mk4_runtime_checks (
  check_name text primary key,
  passed boolean not null
) on commit drop;

do $$
declare
  v_organization_id uuid;
  v_brand_id uuid;
  v_actor_id uuid;
  v_target_id uuid := gen_random_uuid();
  v_secured_id uuid := gen_random_uuid();
  v_declined_id uuid := gen_random_uuid();
  v_unrelated_organization_id uuid := gen_random_uuid();
  v_unrelated_user_id uuid := gen_random_uuid();
  v_count integer;
  v_passed boolean;
begin
  select brand.organization_id, brand.id, membership.user_id
  into v_organization_id, v_brand_id, v_actor_id
  from public.brands brand
  join public.organization_memberships membership
    on membership.organization_id = brand.organization_id
   and membership.member_kind = 'team'
   and membership.status = 'active'
  limit 1;

  if v_actor_id is null then
    insert into mk4_runtime_checks values
      ('unknown_metrics_remain_null', false),
      ('all_statuses_and_history_remain_queryable', false),
      ('malformed_url_rejected', false),
      ('negative_traffic_rejected', false),
      ('out_of_range_score_rejected', false),
      ('unsupported_enum_rejected', false),
      ('duplicate_normalized_url_rejected', false),
      ('cross_organization_rows_hidden', false);
    return;
  end if;

  insert into public.backlink_targets (
    id, organization_id, brand_id, site_name, site_url,
    outreach_status, created_by
  ) values (
    v_target_id, v_organization_id, v_brand_id, 'MK4 unknown-metric target',
    'https://example.com/directory/', 'not_started', v_actor_id
  );

  update public.backlink_targets set outreach_status = 'contacted' where id = v_target_id;
  update public.backlink_targets set outreach_status = 'in_discussion' where id = v_target_id;
  update public.backlink_targets set outreach_status = 'secured' where id = v_target_id;
  update public.backlink_targets set outreach_status = 'declined' where id = v_target_id;

  insert into public.backlink_targets (
    id, organization_id, brand_id, site_name, outreach_status, created_by
  ) values
    (v_secured_id, v_organization_id, v_brand_id, 'MK4 secured history', 'secured', v_actor_id),
    (v_declined_id, v_organization_id, v_brand_id, 'MK4 declined history', 'declined', v_actor_id);

  insert into mk4_runtime_checks values (
    'unknown_metrics_remain_null',
    exists (
      select 1 from public.backlink_targets
      where id = v_target_id and domain_authority is null
        and estimated_traffic is null and relevance_score is null
    )
  );

  insert into mk4_runtime_checks values (
    'all_statuses_and_history_remain_queryable',
    (select count(*) = 2 from public.backlink_targets
      where id in (v_secured_id, v_declined_id)
        and outreach_status in ('secured', 'declined'))
  );

  v_passed := false;
  begin
    insert into public.backlink_targets (
      organization_id, brand_id, site_name, site_url, created_by
    ) values (v_organization_id, v_brand_id, 'Bad URL', 'example.com', v_actor_id);
  exception when check_violation then
    v_passed := true;
  end;
  insert into mk4_runtime_checks values ('malformed_url_rejected', v_passed);

  v_passed := false;
  begin
    insert into public.backlink_targets (
      organization_id, brand_id, site_name, estimated_traffic, created_by
    ) values (v_organization_id, v_brand_id, 'Negative traffic', -1, v_actor_id);
  exception when check_violation then
    v_passed := true;
  end;
  insert into mk4_runtime_checks values ('negative_traffic_rejected', v_passed);

  v_passed := false;
  begin
    insert into public.backlink_targets (
      organization_id, brand_id, site_name, domain_authority, created_by
    ) values (v_organization_id, v_brand_id, 'Bad authority', 101, v_actor_id);
  exception when check_violation then
    v_passed := true;
  end;
  insert into mk4_runtime_checks values ('out_of_range_score_rejected', v_passed);

  v_passed := false;
  begin
    insert into public.backlink_targets (
      organization_id, brand_id, site_name, link_type, created_by
    ) values (v_organization_id, v_brand_id, 'Bad enum', 'directory', v_actor_id);
  exception when check_violation then
    v_passed := true;
  end;
  insert into mk4_runtime_checks values ('unsupported_enum_rejected', v_passed);

  v_passed := false;
  begin
    insert into public.backlink_targets (
      organization_id, brand_id, site_name, site_url, created_by
    ) values (
      v_organization_id, v_brand_id, 'Duplicate URL',
      'HTTPS://EXAMPLE.COM/directory', v_actor_id
    );
  exception when unique_violation then
    v_passed := true;
  end;
  insert into mk4_runtime_checks values ('duplicate_normalized_url_rejected', v_passed);

  insert into auth.users (id) values (v_unrelated_user_id);
  insert into public.organizations (id, name, slug)
  values (
    v_unrelated_organization_id,
    'MK4 unrelated organization',
    'mk4-unrelated-' || replace(v_unrelated_organization_id::text, '-', '')
  );
  insert into public.organization_memberships (
    organization_id, user_id, member_kind, role, status
  ) values (
    v_unrelated_organization_id, v_unrelated_user_id,
    'team', 'contributor', 'active'
  );

  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', v_unrelated_user_id, 'role', 'authenticated'
  )::text, true);
  set local role authenticated;
  select count(*) into v_count
  from public.backlink_targets where id = v_target_id;
  reset role;

  insert into mk4_runtime_checks values ('cross_organization_rows_hidden', v_count = 0);
end;
$$;

select jsonb_build_object(
  'one_canonical_table',
    to_regclass('public.backlink_targets') is not null
    and to_regclass('public.backlink_outreach_events') is null,
  'rls_enabled', (
    select relrowsecurity from pg_class
    where oid = 'public.backlink_targets'::regclass
  ),
  'browser_is_read_only',
    has_table_privilege('authenticated', 'public.backlink_targets', 'select')
    and not has_table_privilege('authenticated', 'public.backlink_targets', 'insert, update, delete')
    and not has_table_privilege('anon', 'public.backlink_targets', 'select, insert, update, delete'),
  'required_indexes_exist',
    to_regclass('public.idx_backlink_targets_brand_status') is not null
    and to_regclass('public.idx_backlink_targets_brand_normalized_url') is not null
    and to_regclass('public.idx_backlink_targets_created_by') is not null
) || (select jsonb_object_agg(check_name, passed) from mk4_runtime_checks);

rollback;
