begin;

do $$
declare
  v_column record;
  v_index record;
begin
  select is_nullable, data_type into v_column
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'work_items'
    and column_name = 'linked_page_key';
  if not found or v_column.is_nullable <> 'YES' or v_column.data_type <> 'text' then
    raise exception 'linked_page_key column is missing or incompatible';
  end if;

  if not exists (
    select 1
    from pg_constraint constraint_record
    where constraint_record.conrelid = 'public.work_items'::regclass
      and constraint_record.conname = 'work_items_linked_page_key_check'
      and constraint_record.convalidated
  ) then
    raise exception 'linked_page_key constraint is missing or unvalidated';
  end if;

  select index_record.indisunique, index_record.indisvalid,
         pg_get_expr(index_record.indpred, index_record.indrelid, false) as predicate
    into v_index
  from pg_index index_record
  where index_record.indexrelid = 'public.work_items_content_page_key_unique'::regclass;
  if not found or not v_index.indisunique or not v_index.indisvalid
    or v_index.predicate <> '(linked_page_key IS NOT NULL)' then
    raise exception 'stable page-key uniqueness index is missing or invalid';
  end if;

  if to_regprocedure('private.normalize_content_page_path(text)') is null
    or to_regprocedure('private.guard_work_item_page_link()') is null then
    raise exception 'B03a page-link functions are missing';
  end if;
  if has_function_privilege('anon', 'private.normalize_content_page_path(text)', 'execute')
    or has_function_privilege('authenticated', 'private.normalize_content_page_path(text)', 'execute')
    or not has_function_privilege('service_role', 'private.normalize_content_page_path(text)', 'execute') then
    raise exception 'page path normalizer privileges are unsafe';
  end if;
  if private.normalize_content_page_path(' /Services//Web Design/ ') <> 'services/web-design' then
    raise exception 'page path normalization is not deterministic';
  end if;
end;
$$;

rollback;
