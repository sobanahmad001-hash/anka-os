-- Anka Sphere OS - Release 1 / Migration 11
-- Version-specific client and internal review anchors.

begin;

alter table public.comments
  add column if not exists anchor jsonb not null default '{}'::jsonb;

alter table public.comments
  drop constraint if exists comments_anchor_shape_check;

alter table public.comments
  add constraint comments_anchor_shape_check check (
    anchor = '{}'::jsonb
    or (
      anchor->>'kind' in ('section', 'page', 'frame', 'timecode', 'coordinate')
      and length(coalesce(anchor->>'label', '')) between 1 and 200
      and not (anchor ?| array[
        'token', 'api_key', 'secret', 'password', 'authorization',
        'provider_prompt', 'internal_notes', 'cost'
      ])
      and (
        anchor->>'kind' <> 'coordinate'
        or (
          anchor ? 'x'
          and anchor ? 'y'
          and (anchor->>'x')::numeric between 0 and 1
          and (anchor->>'y')::numeric between 0 and 1
        )
      )
      and (
        anchor->>'kind' <> 'timecode'
        or (anchor ? 'seconds' and (anchor->>'seconds')::numeric >= 0)
      )
    )
  );

create index if not exists idx_comments_version_anchor
  on public.comments(entity_id, created_at)
  where entity_type = 'deliverable_version' and anchor <> '{}'::jsonb;

commit;
