-- C03: give standalone article requests an explicit format without media or Figma output.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

alter table public.content_requests drop constraint content_requests_format_check;
alter table public.content_requests add constraint content_requests_format_check
  check (format in ('reel', 'carousel', 'single_image', 'stories',
    'carousel_stories', 'reel_carousel', 'web_design_element', 'article'));
alter table public.content_requests add constraint content_requests_article_output_check
  check (format <> 'article' or output_path = 'internal_engine');

alter table public.content_queue_entries drop constraint content_queue_entries_format_check;
alter table public.content_queue_entries add constraint content_queue_entries_format_check
  check (format in ('reel', 'carousel', 'single_image', 'stories',
    'carousel_stories', 'reel_carousel', 'web_design_element', 'article'));

-- A writing request cannot acquire an image/video asset through the media table.
create or replace function public.reject_article_request_media()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.content_request_id is not null and exists (
    select 1 from public.content_requests request
    where request.id = new.content_request_id
      and request.organization_id = new.organization_id
      and request.format = 'article'
  ) then
    raise exception 'Article requests cannot have design media assets.';
  end if;
  return new;
end;
$$;
revoke execute on function public.reject_article_request_media() from public, anon, authenticated;
grant execute on function public.reject_article_request_media() to service_role;
create trigger design_media_assets_reject_article_request
before insert or update of content_request_id, organization_id on public.design_media_assets
for each row execute function public.reject_article_request_media();

commit;
