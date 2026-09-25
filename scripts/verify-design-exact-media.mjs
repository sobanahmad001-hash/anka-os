// Offline PostgreSQL contract fixture; no project credentials or provider calls.
// ANKA_PGLITE_ROOT points to an already installed @electric-sql/pglite package.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { randomUUID } from 'node:crypto'
const root = process.env.ANKA_PGLITE_ROOT
if (!root) throw new Error('Set ANKA_PGLITE_ROOT to installed PGlite 0.5.8')
const { PGlite } = await import(pathToFileURL(resolve(root,'dist/index.js')))
const { pgcrypto } = await import(pathToFileURL(resolve(root,'dist/contrib/pgcrypto.js')))
const db = new PGlite({ extensions: { pgcrypto } })
const sql = (query,values=[]) => db.query(query,values)
const read = name => readFileSync(resolve('supabase/migrations',name),'utf8')
const section = (source,start,end) => {const a=source.indexOf(start),b=source.indexOf(end,a);assert.ok(a>=0&&b>a);return source.slice(a,b)}
try {
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create schema private; create schema extensions; create schema storage;
    create extension pgcrypto with schema extensions;
    create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    create table auth.users(id uuid primary key);
    create table public.organizations(id uuid primary key,status text);
    create table public.organization_memberships(organization_id uuid,user_id uuid,member_kind text,status text,role text,department_id text);
    create function public.is_team_organization_member(org uuid) returns boolean language sql stable as $$
      select exists(select 1 from public.organization_memberships where organization_id=org and user_id=auth.uid() and status='active' and member_kind='team') $$;
    create function private.reject_immutable_artifact_history_change() returns trigger language plpgsql as $$ begin raise exception 'Immutable'; end $$;
    create table public.brands(id uuid primary key,organization_id uuid,unique(id,organization_id));
    create table public.engagements(id uuid primary key,organization_id uuid,brand_id uuid,unique(id,organization_id));
    create table public.service_catalog(id uuid primary key,department_id text,is_active boolean);
    create table public.engagement_services(id uuid primary key,organization_id uuid,engagement_id uuid,service_id uuid,status text,unique(id,organization_id));
    create table public.design_creative_briefs(id uuid primary key,organization_id uuid,visibility text,engagement_id uuid,brand_id uuid,created_by uuid,
      revision integer default 0,frozen_version_id uuid,last_freeze_operation_key uuid,updated_by uuid,updated_at timestamptz);
    create table public.design_creative_brief_versions(id uuid primary key,organization_id uuid,creative_brief_id uuid,content jsonb,
      validation_snapshot jsonb default '{"valid":true}',unique(id,organization_id));
    create table public.design_direction_versions(id uuid primary key,organization_id uuid,creative_brief_version_id uuid,unique(id,organization_id));
    create table public.design_media_assets(id uuid primary key,organization_id uuid,unique(id,organization_id));
    create table public.integration_connections(id uuid primary key,organization_id uuid,unique(id,organization_id));
    create table private.design_video_price_quotes(id uuid primary key,organization_id uuid,unique(id,organization_id));
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(bucket_id text,name text,primary key(bucket_id,name));
    grant usage on schema public,auth to authenticated;
    grant select on public.organization_memberships,public.engagements,public.design_creative_brief_versions to authenticated;
  `)
  const video=read('20260924100000_design_video_budget_foundation.sql')
  await db.exec(section(video,'create table private.design_video_generation_jobs','-- The legacy reservation table'))
  await db.exec(read('20260924101000_design_video_private_storage.sql'))
  await db.exec(section(video,'create function public.get_design_video_job(', 'create function public.list_design_video_jobs('))
  const assets=read('20260912071458_design_b04c_asset_upload_versions.sql')
  await db.exec(section(assets,'create table public.design_assets','create or replace function public.register_design_asset_upload'))
  await db.exec('alter table public.design_assets add column archived_at timestamptz')
  await db.exec(read('20260925140000_design_exact_media_references_promotion.sql'))
  console.log('Migration parsed/applied against actual canonical asset and video table definitions')
  const ids=Object.fromEntries(['org','actor','other','brand','engagement','service','catalog','brief','briefVersion','direction','connector','quote','job','operation'].map(key=>[key,randomUUID()]))
  await sql('insert into auth.users values($1),($2)',[ids.actor,ids.other])
  await sql("insert into public.organizations values($1,'active')",[ids.org])
  await sql("insert into public.organization_memberships values($1,$2,'team','active','contributor','design')",[ids.org,ids.actor])
  await sql('insert into public.brands values($1,$2)',[ids.brand,ids.org])
  await sql('insert into public.engagements values($1,$2,$3)',[ids.engagement,ids.org,ids.brand])
  await sql("insert into public.service_catalog values($1,'design',true)",[ids.catalog])
  await sql("insert into public.engagement_services values($1,$2,$3,$4,'active')",[ids.service,ids.org,ids.engagement,ids.catalog])
  await sql("insert into public.design_creative_briefs(id,organization_id,visibility,engagement_id,brand_id,created_by) values($1,$2,'official',$3,$4,$5)",[ids.brief,ids.org,ids.engagement,ids.brand,ids.actor])
  await sql('insert into public.design_creative_brief_versions(id,organization_id,creative_brief_id,content) values($1,$2,$3,$4)',[ids.briefVersion,ids.org,ids.brief,{title:'Exact saved video',rights_notes:'Original rights notes; not a license'}])
  await sql('insert into public.design_direction_versions values($1,$2,$3)',[ids.direction,ids.org,ids.briefVersion])
  await sql('insert into public.integration_connections values($1,$2)',[ids.connector,ids.org])
  await sql('insert into private.design_video_price_quotes values($1,$2)',[ids.quote,ids.org])
  await sql(`insert into private.design_video_generation_jobs(id,organization_id,direction_version_id,requested_by,
    connector_connection_id,operation_key,request_checksum,prompt,mode,duration_seconds,resolution,aspect_ratio,
    output_format,generate_audio,quote_id,status,dispatch_claim_id,dispatch_request_id,provider_request_id,
    provider_output_url,output_storage_path,claimed_at,completed_at,output_sha256,output_byte_length,output_mime_type)
    values($1,$2,$3,$4,$5,$6,$7,'Offline fixture','explore',5,'720p','16:9','mp4',false,$8,'ready',
      gen_random_uuid(),gen_random_uuid(),'offline-receipt','https://offline.invalid/video',
      ($2::uuid)::text||'/'||($3::uuid)::text||'/'||($1::uuid)::text||'/output.mp4',now(),now(),$7,12,'video/mp4')`,
    [ids.job,ids.org,ids.direction,ids.actor,ids.connector,randomUUID(),'a'.repeat(64),ids.quote])
  const args=[ids.org,ids.actor,ids.job,ids.engagement,ids.service,null,null]
  const invoke=async(name,values=args)=>(await sql(`select public.${name}($1,$2,$3,$4,$5,$6,$7) result`,values)).rows[0].result
  const preview=await invoke('prepare_design_video_promotion')
  assert.equal(preview.asset_id,null);assert.equal(preview.rights_notes,'Original rights notes; not a license')
  assert.equal((await sql('select count(*)::int n from private.design_video_promotions')).rows[0].n,0)
  args[5]=ids.operation;args[6]=preview.checksum
  const first=await invoke('prepare_design_video_promotion')
  assert.deepEqual(await invoke('prepare_design_video_promotion'),first)
  await assert.rejects(()=>invoke('prepare_design_video_promotion',[...args.slice(0,6),'b'.repeat(64)]))
  const otherService=randomUUID()
  await sql("insert into public.engagement_services values($1,$2,$3,$4,'active')",[otherService,ids.org,ids.engagement,ids.catalog])
  const otherArgs=[...args];otherArgs[4]=otherService;otherArgs[5]=null;otherArgs[6]=null
  const otherPreview=await invoke('prepare_design_video_promotion',otherArgs)
  otherArgs[5]=ids.operation;otherArgs[6]=otherPreview.checksum
  await assert.rejects(()=>invoke('prepare_design_video_promotion',otherArgs),error=>error.code==='23505')
  await assert.rejects(()=>invoke('prepare_design_video_promotion',[ids.org,ids.other,...args.slice(2)]))
  await assert.rejects(()=>invoke('complete_design_video_promotion'))
  const path=`${ids.org}/assets/${first.asset_id}/${first.version_id}/file.mp4`
  await sql("insert into storage.objects values('design-generated-video',$1)",[path])
  await sql("update public.engagement_services set status='inactive' where id=$1",[ids.service])
  await assert.rejects(()=>invoke('complete_design_video_promotion'),error=>error.code==='42501')
  assert.equal((await sql('select count(*)::int n from public.design_asset_versions')).rows[0].n,0)
  assert.equal((await sql('select count(*)::int n from private.design_video_promotions')).rows[0].n,1)
  assert.equal((await sql('select count(*)::int n from storage.objects')).rows[0].n,1)
  await sql("update public.engagement_services set status='active' where id=$1",[ids.service])
  const completed=await invoke('complete_design_video_promotion')
  assert.equal(completed.status,'draft');assert.equal(completed.version_id,first.version_id)
  assert.equal((await invoke('complete_design_video_promotion')).idempotent_replay,true)
  assert.equal((await sql('select count(*)::int n from public.design_asset_versions')).rows[0].n,1)
  await sql("update public.organization_memberships set status='inactive'")
  await assert.rejects(()=>invoke('complete_design_video_promotion'))
  await sql("update public.organization_memberships set status='active'")
  await sql("update public.engagement_services set status='inactive'")
  await assert.rejects(()=>invoke('complete_design_video_promotion'))
  await sql("update public.engagement_services set status='active'")
  assert.equal((await invoke('complete_design_video_promotion')).version_id,first.version_id)
  assert.equal((await sql('select count(*)::int n from public.design_asset_versions')).rows[0].n,1)
  await assert.rejects(()=>sql("update private.design_video_promotions set name='Changed'"))
  await assert.rejects(()=>sql("update public.design_asset_versions set lifecycle_status='approved'"))
  const pin=async(ref,brief=ids.brief)=>sql('insert into public.design_creative_brief_versions(id,organization_id,creative_brief_id,content) values($1,$2,$3,$4)',
    [randomUUID(),ids.org,brief,{title:'Pinned',media_references:[ref]}])
  const ref={kind:'design_asset_version',id:first.version_id}
  await pin(ref)
  const imageAsset=randomUUID(),imageVersion=randomUUID()
  await sql("insert into public.design_assets(id,organization_id,engagement_id,brand_id,name,created_by) values($1,$2,$3,$4,'Saved image',$5)",
    [imageAsset,ids.org,ids.engagement,ids.brand,ids.actor])
  await sql(`insert into public.design_asset_versions(id,organization_id,asset_id,version_number,source_kind,
    storage_path,mime_type,byte_size,width,height,original_filename,content_checksum,operation_key,request_checksum,created_by)
    values($1,$2,$3,1,'upload',($2::uuid)::text||'/assets/'||($3::uuid)::text||'/'||($1::uuid)::text||'/file.png',
      'image/png',12,1,1,'file.png',$4,$5,$4,$6)`,[imageVersion,ids.org,imageAsset,'c'.repeat(64),randomUUID(),ids.actor])
  await pin({kind:'design_asset_version',id:imageVersion})
  assert.equal((await sql('select count(*)::int n from public.design_creative_brief_media_sources')).rows[0].n,2)
  await assert.rejects(()=>pin({...ref,kind:'artifact_version'}))
  await assert.rejects(()=>pin({...ref,id:ids.job}))
  await assert.rejects(()=>pin({...ref,signed_url:'https://private.invalid'}))
  await sql('update public.design_creative_briefs set brand_id=$1 where id=$2',[randomUUID(),ids.brief])
  await assert.rejects(()=>pin(ref))
  await sql('update public.design_creative_briefs set brand_id=$1 where id=$2',[ids.brand,ids.brief])
  await assert.rejects(()=>sql('delete from public.design_creative_brief_media_sources'))
  const pinnedVersion=(await sql('select creative_brief_version_id from public.design_creative_brief_media_sources where asset_version_id=$1',[imageVersion])).rows[0].creative_brief_version_id
  const freezeKey=randomUUID()
  const freeze=async(version=pinnedVersion)=>(await sql('select public.freeze_design_creative_brief_version($1,$2,$3,$4,0,$5) result',
    [ids.org,ids.actor,ids.brief,version,freezeKey])).rows[0].result
  const correctedFreeze=(await sql("select pg_get_functiondef('public.freeze_design_creative_brief_version(uuid,uuid,uuid,uuid,integer,uuid)'::regprocedure) definition")).rows[0].definition
  const legacyBrief=read('20260904002000_design_b02_creative_briefs.sql')
  await db.exec(section(legacyBrief,'create or replace function public.freeze_design_creative_brief_version(', 'create or replace function public.set_design_working_direction_preference('))
  // Reproduce the Edge-read -> archive -> RPC gap with the actual legacy RPC.
  assert.equal((await sql('select archived_at from public.design_assets where id=$1',[imageAsset])).rows[0].archived_at,null)
  await sql('update public.design_assets set archived_at=now() where id=$1',[imageAsset])
  assert.equal((await freeze()).brief.frozen_version_id,pinnedVersion)
  console.log('REPRODUCED: legacy freeze commits an asset archived after the eligibility read')
  await db.exec(correctedFreeze)
  await sql('update public.design_creative_briefs set revision=0,frozen_version_id=null,last_freeze_operation_key=null where id=$1',[ids.brief])
  await assert.rejects(()=>freeze(),error=>error.code==='42501')
  assert.equal((await sql('select revision from public.design_creative_briefs where id=$1',[ids.brief])).rows[0].revision,0)
  await sql('update public.design_assets set archived_at=null where id=$1',[imageAsset])
  await sql("update public.organization_memberships set status='inactive'")
  await assert.rejects(()=>freeze(),error=>error.code==='42501')
  await sql("update public.organization_memberships set status='active'")
  await sql('update public.engagements set brand_id=$1 where id=$2',[randomUUID(),ids.engagement])
  await assert.rejects(()=>freeze(),error=>error.code==='42501')
  await sql('update public.engagements set brand_id=$1 where id=$2',[ids.brand,ids.engagement])
  assert.equal((await freeze()).brief.frozen_version_id,pinnedVersion)
  await assert.rejects(()=>freeze(ids.briefVersion),error=>error.code==='23505')
  await sql('update public.design_assets set archived_at=now() where id=$1',[imageAsset])
  await assert.rejects(()=>freeze(),error=>error.code==='42501')
  await sql('update public.design_assets set archived_at=null where id=$1',[imageAsset])
  assert.equal((await freeze()).idempotent_replay,true)
  assert.equal((await sql('select revision from public.design_creative_briefs where id=$1',[ids.brief])).rows[0].revision,1)
  console.log('PASS: SQL freeze rejects changed source/archive/membership before commit and replay; exact-version retry preserved')
  for(const role of ['anon','authenticated']) {
    assert.equal((await sql(`select has_function_privilege('${role}','public.prepare_design_video_promotion(uuid,uuid,uuid,uuid,uuid,uuid,text)','execute') allowed`)).rows[0].allowed,false)
    assert.equal((await sql(`select has_function_privilege('${role}','public.complete_design_video_promotion(uuid,uuid,uuid,uuid,uuid,uuid,text)','execute') allowed`)).rows[0].allowed,false)
    assert.equal((await sql(`select has_table_privilege('${role}','private.design_video_promotions','select') allowed`)).rows[0].allowed,false)
  }
  await sql("select set_config('request.jwt.claim.sub',$1,false)",[ids.actor])
  await db.exec('set role authenticated')
  assert.equal((await sql('select count(*)::int n from public.design_creative_brief_media_sources')).rows[0].n,2)
  await db.exec('reset role')
  await sql("select set_config('request.jwt.claim.sub',$1,false)",[ids.other])
  await db.exec('set role authenticated')
  assert.equal((await sql('select count(*)::int n from public.design_creative_brief_media_sources')).rows[0].n,0)
  await db.exec('reset role')
  console.log('PASS: migration, exact reference kind/ID/scope, immutable links/receipt/version, owner and service revocation on replay, no duplicate draft, object prerequisite, rights preservation, ACL and source RLS')
} finally { await db.close() }
