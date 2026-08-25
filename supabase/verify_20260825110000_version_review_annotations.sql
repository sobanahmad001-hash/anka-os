select jsonb_build_object(
  'migration', '20260825110000_version_review_annotations',
  'anchor_column_exists', exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'comments' and column_name = 'anchor'
  ),
  'anchor_constraint_exists', exists (
    select 1 from pg_constraint
    where conrelid = 'public.comments'::regclass
      and conname = 'comments_anchor_shape_check'
  ),
  'anchored_comment_count', (
    select count(*) from public.comments where anchor <> '{}'::jsonb
  )
);
