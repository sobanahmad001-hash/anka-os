begin;
do $guard$
declare
  source text := pg_get_functiondef('private.website_native_source(uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid)'::regprocedure);
  old_test text := $old$encode(sha256(convert_to(cv.content::text,'UTF8')),'hex') is distinct from cv.content_checksum$old$;
  new_test text := $new$(cv.content_checksum is null or (encode(sha256(convert_to(cv.content::text,'UTF8')),'hex') is distinct from cv.content_checksum and encode(sha256(convert_to(private.website_legacy_json(cv.content,0),'UTF8')),'hex') is distinct from cv.content_checksum))$new$;
begin
  if md5(replace(source,chr(13),'')) <> '2425b2196d5fcae56453d0df335887da' or array_length(string_to_array(source,old_test),1) <> 2 then
    raise exception 'Unexpected native source reader';
  end if;
  execute replace(source,old_test,new_test);
end
$guard$;
commit;
