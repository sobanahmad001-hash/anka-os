begin;
set local lock_timeout='5s';
set local statement_timeout='120s';
alter table public.department_chat_attachments drop constraint department_chat_attachments_claimed_mime_check;
alter table public.department_chat_attachments add constraint department_chat_attachments_claimed_mime_check check (
 claimed_mime in ('text/plain','text/markdown','application/vnd.openxmlformats-officedocument.wordprocessingml.document','image/png','image/jpeg','text/csv','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
 or (claimed_mime='application/pdf' and department_id='design'));
alter table public.department_chat_attachments drop constraint department_chat_attachments_extraction_kind_check;
alter table public.department_chat_attachments add constraint department_chat_attachments_extraction_kind_check check (extraction_kind in ('plain_text','main_document_text','reference_only','pdf_text'));
alter table public.department_chat_message_attachments drop constraint department_chat_message_attachments_extraction_kind_check;
alter table public.department_chat_message_attachments add constraint department_chat_message_attachments_extraction_kind_check check (extraction_kind in ('plain_text','main_document_text','reference_only','pdf_text'));
alter table public.department_chat_attachments drop constraint department_chat_attachments_final_state_check;
alter table public.department_chat_attachments add constraint department_chat_attachments_final_state_check check (
    (status = 'awaiting_upload' and final_path is null and verified_mime is null and byte_size is null
      and sha256_hex is null and extraction_kind is null and extracted_text is null and finalized_at is null and orphan_final_path is null)
    or (status = 'processing' and final_path is null and finalized_at is null and orphan_final_path is null)
    or (status in ('extracted', 'reference_only') and final_path is not null and verified_mime is not null
      and byte_size between 1 and 5242880 and sha256_hex ~ '^[0-9a-f]{64}$'
      and extraction_kind is not null and finalized_at is not null and failure_code = '' and orphan_final_path is null
      and ((status = 'extracted' and extraction_kind in ('plain_text', 'main_document_text', 'pdf_text')
        and extracted_text is not null and char_length(extracted_text) between 1 and 16000)
       or (status = 'reference_only' and extraction_kind = 'reference_only' and extracted_text is null)))
    or (status in ('denied', 'failed', 'discarded') and final_path is null and finalized_at is null
      and extracted_text is null and discarded_at is not null and failure_code <> ''
      and (status = 'failed' or orphan_final_path is null))
  );
alter table public.department_chat_attachments drop constraint department_chat_attachments_extraction_type_check;
alter table public.department_chat_attachments add constraint department_chat_attachments_extraction_type_check check (
  extraction_kind is null
  or extraction_kind='pdf_text' and verified_mime='application/pdf' and source_kind='department_chat' and department_id='design'
  or extraction_kind = 'reference_only' and (
    verified_mime in ('image/png','image/jpeg') and source_kind = 'department_chat'
    or verified_mime in ('text/csv','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') and source_kind = 'project_spreadsheet')
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
      and claimed_mime in ('text/csv','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      and (byte_size is null or byte_size <= 2097152)
      and extracted_text is null
      and (extraction_kind is null or extraction_kind = 'reference_only')
  );
do $$begin
 if not exists(select 1 from storage.buckets where id='department-chat-attachments' and not public and file_size_limit=5242880 and allowed_mime_types is not null) then
  raise exception 'Expected closed project attachment bucket missing or changed';
 end if;
 update storage.buckets set allowed_mime_types=array_append(allowed_mime_types,'application/pdf') where id='department-chat-attachments' and not ('application/pdf'=any(allowed_mime_types));
end;$$;
commit;
