-- Retire the legacy API docs policy that trusted editable auth user metadata.
-- Existing profile-backed owner/admin policies continue to govern writes.

drop policy if exists "Admins can manage API docs" on public.api_docs;
