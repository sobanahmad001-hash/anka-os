-- ============================================================================
-- Anka OS — Supabase Storage Setup
-- Run this in your Supabase SQL Editor AFTER running schema.sql
-- ============================================================================

-- Create a "files" storage bucket for the File Manager app
insert into storage.buckets (id, name, public)
values ('files', 'files', false)
on conflict do nothing;

-- Allow authenticated users to upload to their own folder
create policy "Users can upload own files"
  on storage.objects for insert
  with check (
    bucket_id = 'files'
    and auth.role() = 'authenticated'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- Allow users to read their own files
create policy "Users can read own files"
  on storage.objects for select
  using (
    bucket_id = 'files'
    and auth.role() = 'authenticated'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- Allow users to delete their own files
create policy "Users can delete own files"
  on storage.objects for delete
  using (
    bucket_id = 'files'
    and auth.role() = 'authenticated'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
