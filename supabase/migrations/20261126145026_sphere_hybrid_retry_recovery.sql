-- Recovery is limited to a saved request authored by this signed-in caller and
-- still pinned to this exact writable card. The canonical adapter rechecks all
-- permissions and payload identity; missing requests can never create a version.
create function public.retry_work_content_save(p_org uuid,p_project uuid,p_card_kind text,p_card_id uuid,p_request uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare saved private.work_content_versions;
begin
 if auth.uid() is null then raise insufficient_privilege;end if;
 perform private.work_asset_card(p_org,p_project,p_card_kind,p_card_id,true);
 select * into saved from private.work_content_versions
 where id=p_request and project_id=p_project and author=auth.uid();
 if not found or not exists(select from private.work_asset_pins where project_id=p_project
   and card_kind=p_card_kind and card_id=p_card_id and asset_kind='content' and asset_id=p_request)
 then raise insufficient_privilege;end if;
 return public.save_hybrid_work_draft(p_org,p_project,p_card_kind,p_card_id,saved.id,saved.previous_id,saved.title,saved.body);
end;$$;
revoke all on function public.retry_work_content_save(uuid,uuid,text,uuid,uuid) from public,anon,service_role;
grant execute on function public.retry_work_content_save(uuid,uuid,text,uuid,uuid) to authenticated;
notify pgrst,'reload schema';
