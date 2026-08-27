select jsonb_build_object(
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
  'graphql_available_to_service_role', coalesce(
    has_function_privilege(
      'service_role',
      to_regprocedure('graphql.resolve(text,jsonb,text,jsonb)'),
      'execute'
    ),
    true
  )
);
