-- psql from repository root; ONLY a disposable synthetic copy on existing QA server.
\set ON_ERROR_STOP on
select set_config('importer.qa_expected_directory', :'qa_data_directory', false);
do $$begin
 if current_database() not like 'anka_importer_qa_%'
 or current_setting('server_version_num')::integer not between 170000 and 179999
 or inet_server_addr() is distinct from '127.0.0.1'::inet
 or current_setting('data_directory')<>current_setting('importer.qa_expected_directory') then
 raise exception 'Existing local PostgreSQL17 synthetic QA copy required';end if;
 if exists(select 1 from public.department_chat_conversations where id='8f000000-0000-4000-8000-000000000001') then
 raise exception 'Fixture already present; do not reinstall or overwrite';end if;
end;$$;
\ir ../migrations/20261006152330_project_chat_spreadsheet_private_sources.sql
\ir ../migrations/20261006154628_project_chat_spreadsheet_proposals.sql
\ir ../migrations/20261006202317_project_chat_import_calendar_create.sql
begin;
\ir project_chat_spreadsheet_import.behavior.sql
update public.projects set archived_at=null where id='99999999-9999-4999-8999-999999999974';
commit;
