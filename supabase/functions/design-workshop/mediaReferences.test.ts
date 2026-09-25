import { assertEquals, assertRejects, assertThrows } from 'jsr:@std/assert@1.0.14'
import { normalizeMediaReferences, validateMediaReferences } from './mediaReferences.ts'
import { freezeCreativeBrief, saveCreativeBrief } from './creativeBriefs.ts'
const id = '11111111-1111-4111-8111-111111111111'
const refs = [{ kind: 'design_asset_version' as const, id }]
function client(rows: unknown[]) {
  const query: any = { select: () => query, eq: () => query, in: () => Promise.resolve({ data: rows }) }
  return { from: () => query }
}
const row = { id, organization_id: 'org', asset_id: 'asset', mime_type: 'image/png',
  storage_bucket: 'design-generated-media', storage_path: 'org/assets/file.png',
  design_assets: { id: 'asset', organization_id: 'org', engagement_id: 'project', brand_id: 'brand', archived_at: null } }
Deno.test('media refs are typed canonical UUIDs, deduplicated without latest/version coercion', () => {
  assertEquals(normalizeMediaReferences([...refs,...refs]), refs)
  for (const value of [null, 'url', [{ kind:'artifact_version',id }], [{ kind:'video_job',id }],
    [{...refs[0],signed_url:'secret'}], [{kind:'design_asset_version',id:'fake'}]]) {
    assertThrows(() => normalizeMediaReferences(value))
  }
})
Deno.test('saved image and video refs preserve caller visibility and exact project/brand', async () => {
  await validateMediaReferences(client([row]),refs,'org','project','brand')
  await validateMediaReferences(client([{...row,mime_type:'video/mp4',storage_bucket:'design-generated-video'}]),refs,'org','project','brand')
  for (const rows of [[], [{...row,organization_id:'other'}], [{...row,storage_bucket:'public'}],
    [{...row,design_assets:{...row.design_assets,brand_id:'other'}}],
    [{...row,design_assets:{...row.design_assets,engagement_id:'other'}}],
    [{...row,design_assets:{...row.design_assets,archived_at:'now'}}]]) {
    await assertRejects(() => validateMediaReferences(client(rows),refs,'org','project','brand'))
  }
})
Deno.test('freezing rechecks media visibility and stops before mutation after source revocation', async () => {
  let calls=0
  const admin={organizationId:'org',rpc:async()=>{calls++;return {data:{}}}}
  const caller={from:(table:string)=>{
    const data=table==='design_creative_brief_versions'?{content:{media_references:refs}}:
      table==='design_creative_briefs'?{engagement_id:'project',brand_id:'brand'}:[]
    const q:any={select:()=>q,eq:()=>q,in:async()=>({data}),maybeSingle:async()=>({data})};return q
  }}
  await assertRejects(()=>freezeCreativeBrief(admin,{creative_brief_id:'brief',creative_brief_version_id:'version',expected_revision:1,operation_key:'key'},'actor',caller))
  assertEquals(calls,0)
})
Deno.test('brief replay rejects a reused operation key with changed exact media/content',async()=>{
  const admin={organizationId:'org',rpc:async()=>({data:{idempotent_replay:true,brief:{},version:{id:'prior',content_checksum:'0'.repeat(64)}}})}
  const caller={from:(table:string)=>{
    const data=table==='design_asset_versions'?[row]:[]
    const q:any={select:()=>q,eq:()=>q,in:()=>q,then:(resolve:any)=>resolve({data})};return q
  }}
  await assertRejects(()=>saveCreativeBrief(admin,caller,{visibility:'private',content:{title:'Changed',media_references:refs},expected_revision:0,operation_key:'same-key'},'actor'),Error,'different exact brief')
})
