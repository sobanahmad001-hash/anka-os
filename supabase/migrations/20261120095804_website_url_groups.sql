-- Read-only URL folders, not a claim about approved business hierarchy.
create function public.website_url_groups(p_org uuid,p_project uuid,p_folder text default '/',p_offset integer default 0)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb; job private.gsc_imports;
begin
 perform private.website_read_authorized(p_org,p_project);
 if not coalesce(private.can_access_project(p_project),false) then raise insufficient_privilege;end if;
 if p_folder is null or p_folder!~'^/([^/]+/)*$' or length(p_folder)>1200 or p_offset is null or p_offset<0 then raise invalid_parameter_value;end if;
 job:=private.website_table_snapshot(p_org,p_project);
 with inventory as materialized (
 select x, '/'||ltrim(x->>'path','/') as path from private.website_inventory_rows(p_org,p_project)x
 ), scoped as (
 select *,substr(path,length(p_folder)+1) as remainder from inventory where left(path,length(p_folder))=p_folder
 ), grouped as (
 select split_part(remainder,'/',1) as name,count(*) as count from scoped
 where position('/' in trim(trailing '/' from remainder))>0 group by 1
 ), nodes as (
 select jsonb_build_object('kind','folder','id',p_folder||name||'/','title',name,'count',count) item,'0'||name as sort from grouped
 union all
 select jsonb_build_object('kind','page','id',x->>'id','title',x->>'title','url',x->>'url','path',path,
 'keywords',jsonb_array_length(private.website_table_targets(x)),'clicks',r.clicks,'impressions',r.impressions), '1'||lower(x->>'title')||(x->>'id')
 from scoped s left join private.gsc_import_rows r on r.run_id=job.id and r.query='' and r.page=s.x->>'url'
 where position('/' in trim(trailing '/' from remainder))=0
 ), bounded as (select * from nodes order by sort limit 25 offset p_offset)
 select jsonb_build_object('total',(select count(*) from nodes),'projectPages',(select count(*) from inventory),
 'items',coalesce((select jsonb_agg(item order by sort) from bounded),'[]')) into result;
 return result;
end;$$;
revoke all on function public.website_url_groups(uuid,uuid,text,integer) from public,anon;
grant execute on function public.website_url_groups(uuid,uuid,text,integer) to authenticated;
