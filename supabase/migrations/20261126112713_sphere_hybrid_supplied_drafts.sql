-- Thin transactional adapter over canonical Work content; no provider execution.
create function public.save_hybrid_work_draft(p_org uuid,p_project uuid,p_card_kind text,p_card_id uuid,p_request uuid,p_previous uuid,p_title text,p_body text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare saved private.work_content_versions; base private.work_content_versions; latest uuid;
begin
 if auth.uid() is null or auth.role() is distinct from 'authenticated' then raise insufficient_privilege;end if;
 if p_request is null or p_card_kind not in ('project_task','engagement_work_item') then raise invalid_parameter_value;end if;
 perform private.work_asset_card(p_org,p_project,p_card_kind,p_card_id,true);
 perform 1 from public.projects where id=p_project and organization_id=p_org and archived_at is null for share;
 if not found then raise insufficient_privilege;end if;
 -- Serialize a document across cards, as one document can be reused on several cards.
 if p_previous is not null then
  select * into strict base from private.work_content_versions where id=p_previous and project_id=p_project;
 end if;
 perform pg_advisory_xact_lock(hashtextextended(coalesce(base.document_id,p_request)::text,113));
 perform pg_advisory_xact_lock(hashtextextended(p_card_id::text,112));
 if not exists(select from private.work_content_versions where id=p_request) and p_previous is not null then
  select id into latest from private.work_content_versions where project_id=p_project and document_id=base.document_id order by version desc limit 1;
  if latest is distinct from p_previous then raise exception 'Reopen the latest draft before saving' using errcode='40001';end if;
 end if;
 perform public.save_work_content(p_org,p_project,p_card_kind,p_card_id,p_request,p_previous,p_title,p_body);
 select * into strict saved from private.work_content_versions where id=p_request and project_id=p_project;
 return jsonb_build_object('schema_version',1,'organization_id',p_org,'project_id',p_project,'card_kind',p_card_kind,'card_id',p_card_id,'request_id',p_request,'asset_kind','content','document_id',saved.document_id,'version_id',saved.id,'version_number',saved.version,'state','draft');
end;$$;
revoke all on function public.save_hybrid_work_draft(uuid,uuid,text,uuid,uuid,uuid,text,text) from public,anon,service_role;
grant execute on function public.save_hybrid_work_draft(uuid,uuid,text,uuid,uuid,uuid,text,text) to authenticated;
notify pgrst,'reload schema';
