-- Verification: Google OAuth foreign-key indexes

do $$
declare
  missing_count integer;
begin
  select count(*) into missing_count
  from pg_constraint con
  where con.contype = 'f'
    and con.conrelid in (
      'public.integration_oauth_sessions'::regclass,
      'public.integration_oauth_credentials'::regclass
    )
    and not exists (
      select 1
      from pg_index idx
      where idx.indrelid = con.conrelid
        and con.conkey <@ idx.indkey::smallint[]
    );

  if missing_count > 0 then
    raise exception '% OAuth foreign keys lack supporting indexes', missing_count;
  end if;
end
$$;
