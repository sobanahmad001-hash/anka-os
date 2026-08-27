select jsonb_build_object(
  'graphql_extension_absent', not exists (
    select 1 from pg_extension where extname = 'pg_graphql'
  ),
  'graphql_resolver_absent',
    to_regprocedure('graphql.resolve(text,jsonb,text,jsonb)') is null,
  'graphql_disabled_for_authenticated', not coalesce(
    has_function_privilege(
      'authenticated',
      to_regprocedure('graphql.resolve(text,jsonb,text,jsonb)'),
      'execute'
    ),
    false
  ),
  'graphql_disabled_for_anon', not coalesce(
    has_function_privilege(
      'anon',
      to_regprocedure('graphql.resolve(text,jsonb,text,jsonb)'),
      'execute'
    ),
    false
  ),
  'service_role_boundary_safe',
    to_regprocedure('graphql.resolve(text,jsonb,text,jsonb)') is null
    or has_function_privilege(
      'service_role',
      to_regprocedure('graphql.resolve(text,jsonb,text,jsonb)'),
      'execute'
    )
);
