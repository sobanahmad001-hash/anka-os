-- Add PDF/DOCX originals to the existing closed private importer only.
-- No new tables, grants, policies, bucket limits or canonical permissions.
begin;
set local lock_timeout='5s';
alter table public.department_chat_attachments drop constraint department_chat_attachments_claimed_mime_check;
alter table public.department_chat_attachments add constraint department_chat_attachments_claimed_mime_check check (
 claimed_mime in ('text/plain','text/markdown','application/vnd.openxmlformats-officedocument.wordprocessingml.document','image/png','image/jpeg','text/csv','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
 or (claimed_mime='application/pdf' and (department_id='design' or source_kind='project_spreadsheet')));
alter table public.department_chat_attachments drop constraint department_chat_attachments_extraction_type_check;
alter table public.department_chat_attachments add constraint department_chat_attachments_extraction_type_check check (
  extraction_kind is null
  or extraction_kind='pdf_text' and verified_mime='application/pdf' and source_kind='department_chat' and department_id='design'
  or extraction_kind = 'reference_only' and (
    verified_mime in ('image/png','image/jpeg') and source_kind = 'department_chat'
    or verified_mime in ('text/csv','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','application/pdf','application/vnd.openxmlformats-officedocument.wordprocessingml.document') and source_kind = 'project_spreadsheet')
  or extraction_kind = 'plain_text' and verified_mime in ('text/plain','text/markdown') and source_kind = 'department_chat'
  or extraction_kind = 'main_document_text' and verified_mime = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' and source_kind = 'department_chat'
);
alter table public.department_chat_attachments drop constraint department_chat_attachments_source_kind_check;
alter table public.department_chat_attachments add constraint department_chat_attachments_source_kind_check check (
    source_kind = 'department_chat' and engagement_id is not null and department_id is not null
      and import_inspection is null
      and (claimed_mime in ('text/plain','text/markdown','application/vnd.openxmlformats-officedocument.wordprocessingml.document','image/png','image/jpeg') or (claimed_mime='application/pdf' and department_id='design'))
    or source_kind = 'project_spreadsheet' and engagement_id is null and department_id is null
      and not ai_use_allowed and not share_with_recipients
      and claimed_mime in ('text/csv','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','application/pdf','application/vnd.openxmlformats-officedocument.wordprocessingml.document')
      and (byte_size is null or byte_size <= 2097152)
      and extracted_text is null
      and (extraction_kind is null or extraction_kind = 'reference_only')
  );
commit;
