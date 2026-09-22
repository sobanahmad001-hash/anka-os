create table public.ai_execution_step_outputs(attempt_id uuid);
create or replace function public.get_pipeline_ai_text_routes(uuid,uuid,text,uuid)
returns jsonb language sql as $$
 select '[
  {"priority":1,"provider":"openai","connection_id":"44444444-4444-4444-8444-444444444444","model_id":"verified-local-test"},
  {"priority":2,"provider":"openai","connection_id":"55555555-5555-4555-8555-555555555555","model_id":"backup-local-test"},
  {"priority":3,"provider":"openai","connection_id":"66666666-6666-4666-8666-666666666666","model_id":"third-local-test"}
 ]'::jsonb;
$$;
