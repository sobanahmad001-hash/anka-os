-- Rollback-safe DS1 verification. Run only after the migration is applied.

begin;

create temporary table ds1_runtime_checks (
  check_name text primary key,
  passed boolean not null
) on commit drop;

do $$
declare
  v_organization_id uuid;
  v_engagement_id uuid;
  v_brand_id uuid;
  v_actor_id uuid;
  v_service_id uuid;
  v_engagement_service_id uuid;
  v_session_id uuid := gen_random_uuid();
  v_slot_13_rejected boolean := false;
begin
  select engagement.organization_id, engagement.id, engagement.brand_id, membership.user_id
  into v_organization_id, v_engagement_id, v_brand_id, v_actor_id
  from public.engagements engagement
  join public.organization_memberships membership
    on membership.organization_id = engagement.organization_id
   and membership.member_kind = 'team'
   and membership.status = 'active'
  limit 1;

  select service.id
  into v_service_id
  from public.service_catalog service
  where service.organization_id = v_organization_id
    and service.department_id = 'design'
    and service.slug = 'brand_visual_identity'
    and service.is_active = true;

  if v_actor_id is null or v_service_id is null then
    insert into ds1_runtime_checks values
      ('active_service_session_persists_link', false),
      ('direction_slots_1_through_12_allowed', false),
      ('direction_slot_13_rejected', false);
    return;
  end if;

  select engagement_service.id
  into v_engagement_service_id
  from public.engagement_services engagement_service
  where engagement_service.organization_id = v_organization_id
    and engagement_service.engagement_id = v_engagement_id
    and engagement_service.service_id = v_service_id;

  if v_engagement_service_id is null then
    insert into public.engagement_services (
      organization_id, engagement_id, service_id, status, activated_by
    ) values (
      v_organization_id, v_engagement_id, v_service_id, 'active', v_actor_id
    ) returning id into v_engagement_service_id;
  else
    update public.engagement_services
    set status = 'active'
    where id = v_engagement_service_id;
  end if;

  insert into public.design_workshop_sessions (
    id, organization_id, engagement_id, brand_id, engagement_service_id,
    output_family, output_brief, designer_instructions, context_manifest,
    context_checksum, created_by
  ) values (
    v_session_id, v_organization_id, v_engagement_id, v_brand_id, v_engagement_service_id,
    'brand_identity', '{}'::jsonb, 'DS1 verifier', '{}'::jsonb,
    repeat('a', 64), v_actor_id
  );

  insert into public.design_directions (
    organization_id, session_id, direction_slot
  ) values
    (v_organization_id, v_session_id, 1),
    (v_organization_id, v_session_id, 3),
    (v_organization_id, v_session_id, 12);

  begin
    insert into public.design_directions (
      organization_id, session_id, direction_slot
    ) values (v_organization_id, v_session_id, 13);
  exception when check_violation then
    v_slot_13_rejected := true;
  end;

  insert into ds1_runtime_checks values
    ('active_service_session_persists_link', exists (
      select 1 from public.design_workshop_sessions
      where id = v_session_id and engagement_service_id = v_engagement_service_id
    )),
    ('direction_slots_1_through_12_allowed', (
      select count(*) = 3 from public.design_directions
      where session_id = v_session_id and direction_slot in (1, 3, 12)
    )),
    ('direction_slot_13_rejected', v_slot_13_rejected);
end;
$$;

select jsonb_build_object(
  'engagement_service_id_nullable', exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'design_workshop_sessions'
      and column_name = 'engagement_service_id'
      and is_nullable = 'YES'
  ),
  'service_fk_is_organization_safe', exists (
    select 1
    from pg_constraint
    where conrelid = 'public.design_workshop_sessions'::regclass
      and conname = 'design_workshop_sessions_service_fk'
      and confrelid = 'public.engagement_services'::regclass
      and pg_get_constraintdef(oid) like
        'FOREIGN KEY (engagement_service_id, organization_id) REFERENCES %engagement_services(id, organization_id) ON DELETE RESTRICT'
  ),
  'service_fk_index_exists',
    to_regclass('public.idx_design_workshop_sessions_engagement_service') is not null,
  'direction_slot_remains_bounded_to_12', exists (
    select 1
    from pg_constraint
    where conrelid = 'public.design_directions'::regclass
      and conname = 'design_directions_direction_slot_check'
      and pg_get_constraintdef(oid) like '%direction_slot >= 1%'
      and pg_get_constraintdef(oid) like '%direction_slot <= 12%'
  ),
  'output_family_remains_present', exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'design_workshop_sessions'
      and column_name = 'output_family'
  ),
  'existing_rls_policies_remain',
    (select relrowsecurity from pg_class where oid = 'public.design_workshop_sessions'::regclass)
    and (select relrowsecurity from pg_class where oid = 'public.design_directions'::regclass)
    and exists (
      select 1 from pg_policies
      where schemaname = 'public' and tablename = 'design_workshop_sessions'
        and policyname = 'Team can read workshop sessions'
    )
    and exists (
      select 1 from pg_policies
      where schemaname = 'public' and tablename = 'design_directions'
        and policyname = 'Team can read design directions'
    )
) || (select jsonb_object_agg(check_name, passed) from ds1_runtime_checks);

rollback;
