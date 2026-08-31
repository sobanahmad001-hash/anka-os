-- MK1 rollback-safe runtime verification. Run after the MK1 migration is applied.

begin;

create temporary table mk1_runtime_checks (
  check_name text primary key,
  passed boolean not null
) on commit drop;

do $$
declare
  v_organization_id uuid;
  v_brand_id uuid;
  v_engagement_id uuid;
  v_actor_id uuid;
  v_other_organization_id uuid := gen_random_uuid();
  v_other_client_id uuid := gen_random_uuid();
  v_other_brand_id uuid := gen_random_uuid();
  v_other_actor_id uuid := gen_random_uuid();
  v_event_id uuid := gen_random_uuid();
  v_other_event_id uuid := gen_random_uuid();
  v_work_item_id uuid := gen_random_uuid();
  v_unlinked_id uuid;
  v_visible_events integer;
  v_hidden_events integer;
  v_visible_due integer;
  v_hidden_due integer;
begin
  select engagement.organization_id, engagement.brand_id, engagement.id, membership.user_id
  into v_organization_id, v_brand_id, v_engagement_id, v_actor_id
  from public.engagements engagement
  join public.organization_memberships membership
    on membership.organization_id = engagement.organization_id
   and membership.member_kind = 'team'
   and membership.status = 'active'
  limit 1;

  if not found then
    raise exception 'MK1 verification requires one engagement and active team member';
  end if;

  insert into auth.users (id) values (v_other_actor_id);
  insert into public.organizations (id, name, slug)
  values (v_other_organization_id, 'MK1 isolated organization', 'mk1-' || v_other_organization_id);
  insert into public.agency_clients (id, organization_id, name, created_by)
  values (v_other_client_id, v_other_organization_id, 'MK1 isolated client', v_other_actor_id);
  insert into public.brands (id, organization_id, client_id, name, created_by)
  values (v_other_brand_id, v_other_organization_id, v_other_client_id, 'MK1 isolated brand', v_other_actor_id);

  insert into public.external_events (
    id, organization_id, brand_id, event_name, event_category, start_date, created_by
  ) values
    (v_event_id, v_organization_id, v_brand_id, 'MK1 visible event', 'conference', current_date + 10, v_actor_id),
    (v_other_event_id, v_other_organization_id, v_other_brand_id, 'MK1 hidden event', 'festival', current_date + 10, v_other_actor_id);

  insert into public.work_items (
    id, organization_id, engagement_id, brand_id, title, created_by
  ) values (
    v_work_item_id, v_organization_id, v_engagement_id, v_brand_id,
    'MK1 unlink verification work item', v_actor_id
  );

  insert into public.content_event_links (
    organization_id, external_event_id, content_type, linked_work_item_id,
    lead_time_days, status, created_by
  ) values
    (v_organization_id, v_event_id, 'blog', v_work_item_id, 14, 'planned', v_actor_id),
    (v_organization_id, v_event_id, 'social', null, 14, 'in_progress', v_actor_id),
    (v_organization_id, v_event_id, 'email', null, 14, 'ready', v_actor_id),
    (v_organization_id, v_event_id, 'design_asset', null, 14, 'published', v_actor_id),
    (v_other_organization_id, v_other_event_id, 'blog', null, 14, 'planned', v_other_actor_id);

  select id into v_unlinked_id
  from public.content_event_links
  where external_event_id = v_event_id and content_type = 'social';

  insert into mk1_runtime_checks values
    ('all_four_content_types_together', (
      select count(distinct content_type) = 4
      from public.content_event_links where external_event_id = v_event_id
    )),
    ('link_without_work_item_created', (
      select linked_work_item_id is null
      from public.content_event_links where id = v_unlinked_id
    )),
    ('due_view_is_live', (
      select count(*) = 2 and bool_and(due_date = current_date - 4)
      from public.content_event_links_due where external_event_id = v_event_id
    ));

  delete from public.work_items where id = v_work_item_id;
  insert into mk1_runtime_checks values ('hard_deleted_work_item_unlinks_only_id', (
    select linked_work_item_id is null and organization_id = v_organization_id
    from public.content_event_links
    where external_event_id = v_event_id and content_type = 'blog'
  ));

  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_actor_id, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_visible_events from public.external_events where id = v_event_id;
  select count(*) into v_hidden_events from public.external_events where id = v_other_event_id;
  select count(*) into v_visible_due from public.content_event_links_due where external_event_id = v_event_id;
  select count(*) into v_hidden_due from public.content_event_links_due where external_event_id = v_other_event_id;
  reset role;

  insert into mk1_runtime_checks values ('cross_organization_rows_hidden',
    v_visible_events = 1 and v_hidden_events = 0 and v_visible_due = 2 and v_hidden_due = 0);
end;
$$;

select jsonb_build_object(
  'tables_and_rls_exist', (
    select count(*) = 2 and bool_and(relrowsecurity)
    from pg_class where oid in ('public.external_events'::regclass, 'public.content_event_links'::regclass)
  ),
  'browser_tables_are_read_only',
    has_table_privilege('authenticated', 'public.external_events', 'select')
    and has_table_privilege('authenticated', 'public.content_event_links', 'select')
    and not has_table_privilege('authenticated', 'public.external_events', 'insert, update, delete')
    and not has_table_privilege('authenticated', 'public.content_event_links', 'insert, update, delete'),
  'due_view_is_security_invoker', (
    select coalesce(c.reloptions @> array['security_invoker=true'], false)
    from pg_class c where c.oid = 'public.content_event_links_due'::regclass
  ),
  'work_item_fk_is_column_specific_set_null', (
    select pg_get_constraintdef(oid) like '%ON DELETE SET NULL (linked_work_item_id)%'
    from pg_constraint
    where conrelid = 'public.content_event_links'::regclass
      and confrelid = 'public.work_items'::regclass
  ),
  'no_stored_due_flag', not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'content_event_links'
      and column_name in ('due', 'is_due', 'due_date')
  )
) || (select jsonb_object_agg(check_name, passed) from mk1_runtime_checks);

rollback;
