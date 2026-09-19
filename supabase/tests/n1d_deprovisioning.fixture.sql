-- Additional synthetic invitation parent fields/default only, not production changes.
alter table auth.users add column email text;
update auth.users set email=id::text||'@example.invalid';
alter table public.organization_memberships alter column id set default gen_random_uuid();
