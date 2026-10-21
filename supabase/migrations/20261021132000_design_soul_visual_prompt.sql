-- Clarify Soul Standard's visual instructions before checksum/quote creation.
-- No stored brief, historical job, transport option, permission or rate changes.
-- Existing request/claim checks reject pre-change quotes rather than reinterpreting them.
do $migration$
declare definition text; old_fragment text:=$old$prompt:=concat_ws(E'\n\n','Purpose: '||(v.content->>'purpose'),'Audience: '||(v.content->>'audience'),'Instructions: '||(v.content->>'instructions'),'Constraints: '||(v.content->>'exclusions_constraints'),'Required text: '||(v.content->>'required_text'));$old$;
 new_fragment text:=$new$if p_request->>'provider'='higgsfield' and p_request->>'model_id'='higgsfield-ai/soul/v2/standard' then
 prompt:=concat_ws(E'\n\n',
  'Create one still image from the visual instructions below. Render the scene itself, not a screenshot of this brief or a presentation of the request. Do not add a poster, interface, panels, captions, labels, logos or typography unless explicitly requested as visible content. Follow the exclusions. Motion instructions describe scene context only; do not turn them into storyboards or multiple frames.',
  'Visual instructions: '||(v.content->>'instructions'),
  'Exclusions and constraints: '||(v.content->>'exclusions_constraints'),
  case when nullif(btrim(v.content->>'required_text'),'') is not null then 'Required visible text (subject to the exclusions): '||(v.content->>'required_text') end,
  'Context only, not visible text: '||jsonb_strip_nulls(jsonb_build_object('purpose',v.content->>'purpose','audience',v.content->>'audience'))::text);
else
 prompt:=concat_ws(E'\n\n','Purpose: '||(v.content->>'purpose'),'Audience: '||(v.content->>'audience'),'Instructions: '||(v.content->>'instructions'),'Constraints: '||(v.content->>'exclusions_constraints'),'Required text: '||(v.content->>'required_text'));
end if;$new$;
begin
 definition:=pg_get_functiondef('public.prepare_design_media_request(uuid,uuid,jsonb)'::regprocedure);
 if (length(definition)-length(replace(definition,old_fragment,'')))/length(old_fragment)<>1 then
  raise exception 'Unexpected media prompt definition; review before applying';
 end if;
 execute replace(definition,old_fragment,new_fragment);
end;
$migration$;
