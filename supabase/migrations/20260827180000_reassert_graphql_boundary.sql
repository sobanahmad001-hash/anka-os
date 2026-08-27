-- Reassert the Anka OS GraphQL execution boundary after all schema DDL.
do $$
begin
  if to_regprocedure('graphql.resolve(text,jsonb,text,jsonb)') is not null then
    execute 'revoke execute on function graphql.resolve(text,jsonb,text,jsonb) from public, anon, authenticated';
    execute 'grant execute on function graphql.resolve(text,jsonb,text,jsonb) to service_role';
  end if;
end
$$;
