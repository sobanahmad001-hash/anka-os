begin;

create temporary table w7_fixture (
  actor_id uuid not null,
  organization_a_id uuid not null,
  organization_b_id uuid not null,
  engagement_a_id uuid not null,
  engagement_b_id uuid not null
) on commit drop;

grant select on w7_fixture to authenticated;

do $$
declare
  v_actor_id uuid;
  v_organization_a_id uuid;
  v_organization_b_id uuid := gen_random_uuid();
  v_client_a_id uuid := gen_random_uuid();
  v_client_b_id uuid := gen_random_uuid();
  v_brand_a_id uuid := gen_random_uuid();
  v_brand_b_id uuid := gen_random_uuid();
  v_engagement_a_id uuid := gen_random_uuid();
  v_engagement_b_id uuid := gen_random_uuid();
  v_catalog_a_id uuid := gen_random_uuid();
  v_catalog_b_id uuid := gen_random_uuid();
begin
  select membership.user_id, membership.organization_id
  into v_actor_id, v_organization_a_id
  from public.organization_memberships membership
  where membership.member_kind = 'team'
    and membership.status = 'active'
  order by membership.created_at
  limit 1;

  if v_actor_id is null then
    raise exception 'W7 verification requires one active team membership';
  end if;

  insert into public.organizations (id, name, slug)
  values (v_organization_b_id, 'W7 isolated organisation', 'w7-isolated-' || replace(v_organization_b_id::text, '-', ''));

  insert into public.agency_clients (id, organization_id, name, created_by)
  values
    (v_client_a_id, v_organization_a_id, 'W7 visible client', v_actor_id),
    (v_client_b_id, v_organization_b_id, 'W7 hidden client', v_actor_id);

  insert into public.brands (id, organization_id, client_id, name, created_by)
  values
    (v_brand_a_id, v_organization_a_id, v_client_a_id, 'W7 visible brand', v_actor_id),
    (v_brand_b_id, v_organization_b_id, v_client_b_id, 'W7 hidden brand', v_actor_id);

  insert into public.engagements (
    id, organization_id, client_id, brand_id, name, status, created_by
  ) values
    (v_engagement_a_id, v_organization_a_id, v_client_a_id, v_brand_a_id, 'W7 visible engagement', 'active', v_actor_id),
    (v_engagement_b_id, v_organization_b_id, v_client_b_id, v_brand_b_id, 'W7 hidden engagement', 'active', v_actor_id);

  insert into public.work_items (
    organization_id, engagement_id, brand_id, title, status, created_by
  ) values
    (v_organization_a_id, v_engagement_a_id, v_brand_a_id, 'W7 visible work', 'blocked', v_actor_id),
    (v_organization_b_id, v_engagement_b_id, v_brand_b_id, 'W7 hidden work', 'blocked', v_actor_id);

  insert into public.blueprint_stage_catalog (
    id, organization_id, slug, name, accountable_department_id, display_order, stage_kind
  ) values
    (v_catalog_a_id, v_organization_a_id, 'w7_visible_stage', 'W7 visible stage', 'content', 900001, 'delivery'),
    (v_catalog_b_id, v_organization_b_id, 'w7_hidden_stage', 'W7 hidden stage', 'content', 900002, 'delivery');

  insert into public.engagement_stage_instances (
    organization_id, engagement_id, stage_catalog_id, name,
    accountable_department_id, stage_kind, position, status
  ) values
    (v_organization_a_id, v_engagement_a_id, v_catalog_a_id, 'W7 visible stage', 'content', 'delivery', 0, 'blocked'),
    (v_organization_b_id, v_engagement_b_id, v_catalog_b_id, 'W7 hidden stage', 'content', 'delivery', 0, 'blocked');

  insert into w7_fixture values (
    v_actor_id, v_organization_a_id, v_organization_b_id,
    v_engagement_a_id, v_engagement_b_id
  );
end;
$$;

set local role authenticated;

select set_config(
  'request.jwt.claims',
  jsonb_build_object('sub', fixture.actor_id, 'role', 'authenticated')::text,
  true
)
from w7_fixture fixture;

select check_name, passed
from (
  select 'organization_a_engagement_visible'::text as check_name,
    exists (
      select 1 from public.engagements engagement, w7_fixture fixture
      where engagement.id = fixture.engagement_a_id
    ) as passed
  union all
  select 'organization_b_engagement_hidden',
    not exists (
      select 1 from public.engagements engagement, w7_fixture fixture
      where engagement.id = fixture.engagement_b_id
    )
  union all
  select 'organization_a_work_visible',
    exists (
      select 1 from public.work_items item, w7_fixture fixture
      where item.engagement_id = fixture.engagement_a_id
    )
  union all
  select 'organization_b_work_hidden',
    not exists (
      select 1 from public.work_items item, w7_fixture fixture
      where item.engagement_id = fixture.engagement_b_id
    )
  union all
  select 'organization_a_stage_visible',
    exists (
      select 1 from public.engagement_stage_instances stage, w7_fixture fixture
      where stage.engagement_id = fixture.engagement_a_id
    )
  union all
  select 'organization_b_stage_hidden',
    not exists (
      select 1 from public.engagement_stage_instances stage, w7_fixture fixture
      where stage.engagement_id = fixture.engagement_b_id
    )
) checks
order by check_name;

reset role;
rollback;
