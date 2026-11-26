-- Disposable database only. Caller supplies org, project, card, actor UUIDs for a
-- writable engagement_work_item and other_project for an inaccessible project.
-- Run after migrations with psql -v ON_ERROR_STOP=1 and these -v arguments.
begin;
select set_config('request.jwt.claim.sub', :'actor', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('fixture.org', :'org', true),set_config('fixture.project', :'project', true),
 set_config('fixture.card', :'card', true),set_config('fixture.other_project', :'other_project', true);
do $$
declare org uuid:=current_setting('fixture.org')::uuid; project uuid:=current_setting('fixture.project')::uuid;
 card uuid:=current_setting('fixture.card')::uuid; first_id uuid:=gen_random_uuid(); second_id uuid:=gen_random_uuid();
 first_result jsonb; replay jsonb; count_before bigint;
begin
 select count(*) into count_before from private.work_content_versions where project_id=project;
 first_result:=public.save_hybrid_work_draft(org,project,'engagement_work_item',card,first_id,null,'Fixture brief','Supplied text');
 -- Simulates successful commit with lost response by repeating original identity.
 replay:=public.save_hybrid_work_draft(org,project,'engagement_work_item',card,first_id,null,'Fixture brief','Supplied text');
 if replay is distinct from first_result then raise exception 'Retry changed exact receipt';end if;
 if (select count(*) from private.work_content_versions where project_id=project)<>count_before+1 then raise exception 'Duplicate created another version';end if;
 perform public.save_hybrid_work_draft(org,project,'engagement_work_item',card,second_id,first_id,'Fixture brief','Revision two');
 replay:=public.save_hybrid_work_draft(org,project,'engagement_work_item',card,first_id,null,'Fixture brief','Supplied text');
 if replay is distinct from first_result then raise exception 'Newer version invalidated original recovery';end if;
 begin
  perform public.save_hybrid_work_draft(org,project,'engagement_work_item',card,gen_random_uuid(),first_id,'Fixture brief','Stale overwrite');
  raise exception 'Stale overwrite accepted';
 exception when serialization_failure then null;end;
 begin
  perform public.save_hybrid_work_draft(org,current_setting('fixture.other_project')::uuid,'engagement_work_item',card,gen_random_uuid(),null,'Fixture brief','Cross-project');
  raise exception 'Foreign card accepted';
 exception when insufficient_privilege then null;end;
 if (select count(*) from private.work_content_versions where project_id=project)<>count_before+2 then raise exception 'Rejected request persisted';end if;
end;$$;
rollback;
