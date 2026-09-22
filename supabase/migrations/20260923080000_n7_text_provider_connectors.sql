begin;

alter table public.integration_connections
  drop constraint if exists integration_connections_provider_check;
alter table public.integration_connections
  add constraint integration_connections_provider_check
  check (provider in (
    'github', 'figma', 'wordpress', 'openai',
    'google_analytics', 'google_search_console', 'google_ads', 'meta',
    'anthropic', 'google_gemini'
  ));

alter table public.integration_events
  drop constraint if exists integration_events_provider_check;
alter table public.integration_events
  add constraint integration_events_provider_check
  check (provider in (
    'github', 'figma', 'wordpress', 'openai',
    'google_analytics', 'google_search_console', 'google_ads', 'meta',
    'anthropic', 'google_gemini'
  ));

alter table public.integration_connections
  drop constraint if exists integration_connections_secret_name_check;
alter table public.integration_connections
  add constraint integration_connections_secret_name_check
  check (
    secret_name is null or (
      secret_name ~ '^ANKA_[A-Z0-9_]+$'
      and (
        (provider = 'github' and starts_with(secret_name, 'ANKA_GITHUB_'))
        or (provider = 'figma' and starts_with(secret_name, 'ANKA_FIGMA_'))
        or (provider = 'wordpress' and starts_with(secret_name, 'ANKA_WORDPRESS_'))
        or (provider = 'openai' and starts_with(secret_name, 'ANKA_OPENAI_'))
        or (provider = 'anthropic' and starts_with(secret_name, 'ANKA_ANTHROPIC_'))
        or (provider = 'google_gemini' and starts_with(secret_name, 'ANKA_GEMINI_'))
      )
    )
  );

commit;
