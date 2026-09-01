begin;

create temporary table cp4_checks (
  check_name text primary key,
  passed boolean not null
);
grant select, insert on cp4_checks to authenticated;

create temporary table cp4_fixture (
  organization_id uuid not null,
  actioned_entry_id uuid not null,
  skipped_entry_id uuid not null,
  failed_entry_id uuid not null,
  event_id uuid not null
);
grant select on cp4_fixture to authenticated;

insert into cp4_checks values
  ('content_queue_table_exists', to_regclass('public.content_queue_entries') is not null),
  ('content_queue_rls_enabled', (
    select relrowsecurity from pg_class where oid = 'public.content_queue_entries'::regclass
  )),
  ('content_queue_browser_is_read_only', (
    select has_table_privilege('authenticated', oid, 'select')
      and not has_table_privilege('authenticated', oid, 'insert, update, delete')
      and not has_table_privilege('anon', oid, 'select, insert, update, delete')
    from pg_class where oid = 'public.content_queue_entries'::regclass
  )),
  ('content_queue_uses_team_membership_policy', exists (
    select 1 from pg_policies where schemaname = 'public'
      and tablename = 'content_queue_entries' and cmd = 'SELECT'
      and qual like '%is_team_organization_member(organization_id)%'
  )),
  ('queue_format_matches_content_request_format', exists (
    select 1
    from pg_constraint queue_constraint
    join pg_constraint request_constraint
      on pg_get_constraintdef(queue_constraint.oid) = pg_get_constraintdef(request_constraint.oid)
    where queue_constraint.conrelid = 'public.content_queue_entries'::regclass
      and request_constraint.conrelid = 'public.content_requests'::regclass
      and queue_constraint.contype = 'c' and request_constraint.contype = 'c'
      and pg_get_constraintdef(queue_constraint.oid) like '%web_design_element%'
  )),
  ('queue_event_fk_sets_only_event_null', exists (
    select 1 from pg_constraint
    where conrelid = 'public.content_queue_entries'::regclass and contype = 'f'
      and pg_get_constraintdef(oid) like
        'FOREIGN KEY (linked_event_id, organization_id)%ON DELETE SET NULL (linked_event_id)'
  )),
  ('queue_actions_are_service_only',
    has_function_privilege('service_role', 'public.action_content_queue_entry(uuid,uuid,text,uuid)', 'execute')
    and has_function_privilege('service_role', 'public.skip_content_queue_entry(uuid,uuid)', 'execute')
    and not has_function_privilege('authenticated', 'public.action_content_queue_entry(uuid,uuid,text,uuid)', 'execute')
    and not has_function_privilege('authenticated', 'public.skip_content_queue_entry(uuid,uuid)', 'execute')
  ),
  ('action_reuses_exact_cp1_rpc', position(
    'public.create_content_request' in pg_get_functiondef(
      'public.action_content_queue_entry(uuid,uuid,text,uuid)'::regprocedure
    )
  ) > 0),
  ('no_recurrence_or_scheduler_added',
    position('recurrence' in lower(pg_get_functiondef(
      'public.action_content_queue_entry(uuid,uuid,text,uuid)'::regprocedure
    ))) = 0
    and position('cron' in lower(pg_get_functiondef(
      'public.action_content_queue_entry(uuid,uuid,text,uuid)'::regprocedure
    ))) = 0
  );

do $$
declare
  v_actor uuid;
  v_org uuid := gen_random_uuid();
  v_client uuid := gen_random_uuid();
  v_brand uuid := gen_random_uuid();
  v_event uuid := gen_random_uuid();
  v_actioned uuid := gen_random_uuid();
  v_skipped uuid := gen_random_uuid();
  v_failed uuid := gen_random_uuid();
  v_result jsonb;
  v_failed_as_expected boolean := false;
begin
  select id into v_actor from auth.users order by created_at limit 1;
  if v_actor is null then raise exception 'CP4 verifier needs one existing auth user'; end if;

  insert into public.organizations(id, name, slug)
  values (v_org, 'CP4 verifier org', 'cp4-verifier-' || substr(v_org::text, 1, 8));
  insert into public.agency_clients(id, organization_id, name, created_by)
  values (v_client, v_org, 'CP4 verifier client', v_actor);
  insert into public.brands(id, organization_id, client_id, name, created_by)
  values (v_brand, v_org, v_client, 'CP4 verifier brand', v_actor);
  insert into public.external_events(
    id, organization_id, brand_id, event_name, event_category, start_date, created_by
  ) values (
    v_event, v_org, v_brand, 'CP4 verifier event', 'conference', current_date + 10, v_actor
  );

  insert into public.content_queue_entries(
    id, organization_id, brand_id, planned_date, format, brief_template,
    linked_event_id, created_by
  ) values
    (v_actioned, v_org, v_brand, current_date + 4, 'carousel', 'Action this planned carousel.', v_event, v_actor),
    (v_skipped, v_org, v_brand, current_date + 5, 'stories', 'Skip this plan.', null, v_actor),
    (v_failed, v_org, v_brand, current_date + 6, 'reel', 'Force a rollback after request creation.', null, v_actor);

  insert into cp4_checks values
    ('planning_creates_no_request', not exists (
      select 1 from public.content_requests where queue_entry_id in (v_actioned, v_skipped, v_failed)
    )),
    ('planning_creates_no_event_link', not exists (
      select 1 from public.content_event_links where external_event_id = v_event
    ));

  select public.action_content_queue_entry(v_org, v_actioned, 'internal_engine', v_actor)
  into v_result;
  perform public.skip_content_queue_entry(v_org, v_skipped);

  create or replace function public.cp4_verifier_force_action_failure()
  returns trigger language plpgsql security invoker set search_path = '' as $trigger$
  begin
    if new.status = 'actioned' then raise exception 'CP4 forced verifier failure'; end if;
    return new;
  end;
  $trigger$;
  create trigger zz_cp4_verifier_force_action_failure
  after update on public.content_queue_entries
  for each row execute function public.cp4_verifier_force_action_failure();
  begin
    perform public.action_content_queue_entry(v_org, v_failed, 'internal_engine', v_actor);
  exception when others then
    v_failed_as_expected := true;
  end;
  drop trigger zz_cp4_verifier_force_action_failure on public.content_queue_entries;
  drop function public.cp4_verifier_force_action_failure();

  insert into cp4_fixture values (v_org, v_actioned, v_skipped, v_failed, v_event);
  insert into cp4_checks values
    ('action_creates_exactly_one_general_request', (
      select count(*) = 1 and bool_and(mode = 'general') and bool_and(brand_id = v_brand)
      from public.content_requests where queue_entry_id = v_actioned
    )),
    ('action_marks_entry_fulfilled', (
      select status = 'actioned'
        and fulfilled_by_request_id = (v_result #>> '{request,id}')::uuid
      from public.content_queue_entries where id = v_actioned
    )),
    ('action_creates_optional_event_link', (
      select count(*) = 1 and bool_and(content_type = 'social')
      from public.content_event_links where external_event_id = v_event
    )),
    ('skip_creates_no_request', (
      select status = 'skipped' and fulfilled_by_request_id is null
        and not exists (select 1 from public.content_requests where queue_entry_id = v_skipped)
      from public.content_queue_entries where id = v_skipped
    )),
    ('mid_transaction_failure_rolls_back_everything',
      v_failed_as_expected
      and exists (select 1 from public.content_queue_entries where id = v_failed and status = 'planned')
      and not exists (select 1 from public.content_requests where queue_entry_id = v_failed)
    );
end $$;

select set_config('request.jwt.claims', json_build_object(
  'sub', (select id from auth.users order by created_at limit 1), 'role', 'authenticated'
)::text, true);
set local role authenticated;
insert into cp4_checks values ('cross_organization_queue_is_hidden', not exists (
  select 1 from public.content_queue_entries
  where id = (select actioned_entry_id from cp4_fixture)
));
reset role;

select check_name, passed from cp4_checks order by check_name;

do $$
begin
  if exists (select 1 from cp4_checks where not passed) then
    raise exception 'One or more CP4 verification checks failed';
  end if;
end $$;

rollback;
