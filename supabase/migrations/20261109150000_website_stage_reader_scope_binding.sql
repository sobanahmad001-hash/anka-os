-- Read stage progress against the same reviewed service commitment as Work creation.
-- Keep the published leaf identity in the stage fingerprint and returned step.
do $patch$
declare
  target regprocedure;
  expected_hash text;
  ddl text;
  leaf_test constant text := $old$(s->>'service_id')::uuid$old$;
  resolved constant text := $new$private.website_step_scope_service(p_org,p_engagement,c.pipeline_group_id,c.definition_publication_id,(s->>'service_id')::uuid,(decision->>'quantity')::integer)$new$;
  predicate text;
begin
  for target, expected_hash in
    select * from (values
      ('private.project_stage_partition_context(uuid,uuid,uuid,uuid,jsonb,uuid[])'::regprocedure, '257aa56df75375ca1ef7b09ad2e9ae76'),
      ('private.project_chat_design_partition_context_actor(uuid,uuid,uuid,uuid,uuid,jsonb,uuid[])'::regprocedure, 'c29301b9b81914c08f3cee414f4f769f')
    ) as readers(routine, body_hash)
  loop
    if (select md5(replace(prosrc,chr(13),'')) from pg_proc where oid=target) is distinct from expected_hash then
      raise exception 'Unreviewed Website stage reader: %', target;
    end if;
    ddl := replace(pg_get_functiondef(target),chr(13),'');
    foreach predicate in array array['where cat.id=', 'and service_id=', 'and sc.service_id='] loop
      if cardinality(string_to_array(ddl,predicate || leaf_test)) <> 2 then
        raise exception 'Expected one service predicate in %: %', target, predicate;
      end if;
      ddl := replace(ddl, predicate || leaf_test, predicate || resolved);
    end loop;
    execute ddl;
  end loop;
end;
$patch$;
