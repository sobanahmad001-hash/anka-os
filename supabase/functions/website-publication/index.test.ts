import {assertEquals} from 'jsr:@std/assert@1.0.14'
import {handler} from './index.ts'
import {websiteNativeFixture} from '../../../tools/website-native-fixture.js'
import {buildWebsiteBlockSource} from '../_shared/websiteBlockBuild.js'
import {createStoredZip} from '../wordpress-export/theme.ts'
import {sha} from '../_shared/websiteStaging.js'
import {buildWebsitePublicationBundle} from '../_shared/websitePublicationBundle.js'

import {websiteNativeSnapshotChecksum} from '../_shared/websiteNativeDesign.js'

const id = (n: number) => 'a0000000-0000-4000-8000-' + String(n).padStart(12, '0')
const common = {organization_id: id(1), project_id: id(2), engagement_id: id(3)}
const origin = 'https://publication.example.test'
const identity = {protocol: 'anka-publication-v1', receiver_version: '1.0.0', environment: 'production', wordpress_version: '7.1.3', php_version: '8.3.33', compiler: 'anka-native-block-v1', base_url: origin, site_id: id(20), publication_enabled: true}
const connection = {id: id(21), base_url: origin, revision: '2026-10-29T10:00:00Z', username: 'synthetic-publisher', secret_name: 'ANKA_WORDPRESS_FIXTURE'}
const target = {id: id(22), connection_id: connection.id, connection_revision: connection.revision, site_id: identity.site_id, base_url: origin}
const request = (body: unknown) => new Request('https://edge.example.test/website-publication', {method: 'POST', headers: {Authorization: 'Bearer synthetic-fixture'}, body: JSON.stringify(body)})

async function fixture() {
  const manifest = await websiteNativeFixture(), native = await buildWebsiteBlockSource(manifest)
  const zip = createStoredZip(Object.entries(native.files).sort(([a], [b]) => a.localeCompare(b)).map(([name, content]) => ({name: native.directory + '/' + name, bytes: new TextEncoder().encode(content)})))
  const job = {id: id(23), artifact_sha256: await sha(zip), seo_verification: {file_hashes: native.file_hashes, package_bytes: zip.byteLength}}
  const qa = {receipt_id: id(24), artifact_version_id: id(25), run_id: id(26), page_id: manifest.scope.page_id, package_sha256: job.artifact_sha256, current: true}
  const release_approval = {id: id(27), artifact_version_id: qa.artifact_version_id, decision: 'approved', current: true}
  const sources = {site_version_id: manifest.sources.site_system.version_id, pages: [{page_id: manifest.scope.page_id, page_key: manifest.scope.page_key, path: 'home', job_id: job.id, package_sha256: job.artifact_sha256, source_review_sha256: 'c'.repeat(64), site_version_id: manifest.sources.site_system.version_id, qa, release_approval}], packages: [{page_id: manifest.scope.page_id, source: {manifest}, job}]}
  const bundle = await buildWebsitePublicationBundle(sources)
  const inventory = {site_id: identity.site_id, origin, environment: 'production', head: null, theme_sha256: bundle.theme.theme_sha256, complete: true, posts: []}
  const inspectedInventory = {...inventory, inventory_sha256: await websiteNativeSnapshotChecksum(inventory)}
  const calls: any[] = [], network: any[] = []
  let role = 'operations_admin', failSourcesAfterFirst = false, sourceReads = 0
  const admin = {rpc: async (name: string, args: any) => {
    calls.push({name, args})
    if (name === 'get_website_publication_target') return {data: args.p_target_id ? {target, connection} : {connection}, error: null}
    if (name === 'bind_website_publication_target') return {data: target, error: null}
    if (name === 'record_website_publication_review') return {data: {id: id(33), created_at: '2026-10-29T10:00:00Z'}, error: null}
    if (name === 'get_website_publication_sources') {
      sourceReads++
      if (failSourcesAfterFirst && sourceReads > 1) return {data: null, error: {code: '42501', message: 'synthetic private authority detail'}}
      return {data: sources, error: null}
    }
    throw Error('Unexpected RPC')
  }}
  const dependencies = {
    resolveContext: (async () => ({organizationId: common.organization_id, projectId: common.project_id, engagementId: common.engagement_id, user: {id: id(30)}, membership: {member_kind: 'team', status: 'active', get role() {return role}}, admin})) as any,
    env: (key: string) => key === 'WEBSITE_PUBLICATION_ALLOWED_ORIGINS' ? JSON.stringify([origin]) : key === connection.secret_name ? 'synthetic-only-not-a-credential' : undefined,
    resolver: async () => ['8.8.8.8'],
    fetcher: (async (url: any, options: any) => {network.push({url: String(url), method: options.method}); return Response.json(String(url).endsWith('/inventory') ? {identity, inventory: inspectedInventory} : identity, {headers: {'Cache-Control': 'private, no-store'}})}) as typeof fetch,
  }
  const body = {action: 'review', ...common, target_id: target.id, request_id: id(32), pages: [{qa_receipt_id: qa.receipt_id, approval_id: release_approval.id, operation: 'create', post_id: null, expected_post_revision: null, expected_post_sha256: null}], theme_change: {mode: 'retain', expected_sha256: inventory.theme_sha256, sitewide_impact_acknowledged: false, affected_posts: []}}
  return {calls, network, dependencies, body, sources, bundle, inspectedInventory, setRole(value: string) {role = value}, revokeDuringReview() {failSourcesAfterFirst = true}}
}

Deno.test('review uses stored QA/approval sources and only GETs production inspection', async () => {
  const f = await fixture(), response = await handler(request(f.body), f.dependencies), result = await response.json()
  assertEquals(response.status, 200)
  assertEquals(result.data.executable, false)
  assertEquals(result.data.requires_live_target_approval, true)
  assertEquals(f.network.map(row => row.method), ['GET', 'GET'])
  assertEquals(f.calls.filter(row => row.name === 'get_website_publication_sources').length, 2)
  assertEquals(JSON.stringify(result).includes('secret_name'), false)
  assertEquals(JSON.stringify(result).includes('post_content'), false)
})
Deno.test('revocation during remote inspection rejects review without leaking database detail', async () => {
  const f = await fixture(); f.revokeDuringReview()
  const response = await handler(request(f.body), f.dependencies), result = await response.json()
  assertEquals(response.status, 403)
  assertEquals(result.executable, false)
  assertEquals(JSON.stringify(result).includes('private authority detail'), false)
})
Deno.test('non-owner and unsupported execution actions never reach a target or network', async () => {
  const f = await fixture(); f.setRole('contributor')
  assertEquals((await handler(request(f.body), f.dependencies)).status, 403)
  assertEquals((await handler(request({...f.body, action: 'publish'}), f.dependencies)).status, 400)
  assertEquals(f.calls.length, 0); assertEquals(f.network.length, 0)
})
Deno.test('production binding requires fresh exact inspection and explicit confirmation', async () => {
  const f = await fixture()
  const inspectionResponse = await handler(request({action: 'inspect', ...common, connection_id: connection.id}), f.dependencies)
  const inspected = (await inspectionResponse.json()).data
  const binding = {action: 'bind', ...common, connection_id: connection.id, inspection: inspected.inspection, inspection_sha256: inspected.inspection_sha256, confirmed: false, request_id: id(31)}
  assertEquals((await handler(request(binding), f.dependencies)).status, 400)
  assertEquals(f.calls.some(row => row.name === 'bind_website_publication_target'), false)
  const response = await handler(request({...binding, confirmed: true}), f.dependencies)
  assertEquals(response.status, 200)
  assertEquals((await response.json()).data.publication_authorized, false)
})

async function executableFixture() {
  const f=await fixture(), reviewed=(await (await handler(request(f.body),f.dependencies)).json()).data
  const ctx=await f.dependencies.resolveContext(request(f.body),{} as any),originalRpc=ctx.admin.rpc
  const review={id:reviewed.review_id,kind:'publication',snapshot:reviewed.snapshot,review_sha256:reviewed.review_sha256,source_selection:f.body.pages.map(p=>({qa_receipt_id:p.qa_receipt_id,approval_id:p.approval_id})),created_by:ctx.user.id,created_at:new Date(Date.now()-1000).toISOString()}
  const command={id:id(41),request_id:id(40),review_id:review.id,created_by:ctx.user.id,created_at:new Date().toISOString()}
  const unsigned={...f.inspectedInventory,head:command.request_id,posts:[{post_id:101,revision:102,path:'/home',sha256:'a'.repeat(64),managed_page_id:f.sources.pages[0].page_id,post_type:'page',post_status:'publish'}]}
  const {inventory_sha256:_hash,...snapshot}=unsigned
  const inventory={...snapshot,inventory_sha256:await websiteNativeSnapshotChecksum(snapshot)}
  const receipt={request_id:command.request_id,command_id:command.id,kind:'publication',status:'succeeded',review_sha256:review.review_sha256,head:command.request_id,backup_snapshot_sha256:'f'.repeat(64)}
  const state:{admitted:boolean;published:boolean;lost:boolean;saved:any}={admitted:false,published:false,lost:false,saved:null}
  ctx.admin.rpc=async(name:string,args:any)=>{
    if(name==='start_website_publication_command'){f.calls.push({name,args});const created=!state.admitted;state.admitted=true;return{data:{created,command},error:null}}
    if(name==='get_website_publication_command'){f.calls.push({name,args});return{data:{command,review,target,result:state.saved},error:null}}
    if(name==='record_website_publication_result'){f.calls.push({name,args});state.saved={outcome:args.p_receipt.status,receipt:args.p_receipt,remote_state:args.p_remote_state,projection_status:'applied'};return{data:state.saved,error:null}}
    return originalRpc(name,args)
  }
  f.dependencies.fetcher=(async(url:any,options:any)=>{
    const path=String(url);f.network.push({url:path,method:options.method})
    if(options.method==='POST'){state.published=true;if(state.lost)throw Error('Synthetic lost reply');return Response.json(receipt,{headers:{'Cache-Control':'private, no-store'}})}
    return Response.json(path.includes('/requests/')?{identity,...receipt,state:{inventory}}:path.endsWith('/inventory')?{identity,inventory:state.published?inventory:f.inspectedInventory}:identity,{headers:{'Cache-Control':'private, no-store'}})
  }) as typeof fetch
  return{...f,state,publish:{action:'publish',...common,review_id:review.id,review_sha256:review.review_sha256,confirmed:true,request_id:command.request_id}}
}
Deno.test('explicit fresh command dispatches once and settles verified original proof',async()=>{
  const f=await executableFixture(),result=await (await handler(request(f.publish),f.dependencies)).json()
  assertEquals(result.data.status,'succeeded');assertEquals(f.network.filter(x=>x.method==='POST').length,1)
  assertEquals(f.calls.filter(x=>x.name==='record_website_publication_result').length,1)
  const settled=f.calls.find(x=>x.name==='record_website_publication_result')
  assertEquals(settled.args.p_remote_state.inventory.head,f.publish.request_id)
  assertEquals(JSON.stringify(result).includes('post_content'),false)
})
Deno.test('lost receiver reply retains uncertainty and repeated original request only reads recovery',async()=>{
  const f=await executableFixture();f.state.lost=true
  assertEquals((await (await handler(request(f.publish),f.dependencies)).json()).data.status,'uncertain')
  assertEquals((await (await handler(request(f.publish),f.dependencies)).json()).data.status,'succeeded')
  assertEquals(f.network.filter(x=>x.method==='POST').length,1)
})
Deno.test('unchecked confirmation and revoked original sources never dispatch',async()=>{
  const f=await executableFixture()
  assertEquals((await handler(request({...f.publish,confirmed:false}),f.dependencies)).status,400)
  assertEquals(f.state.admitted,false)
  f.revokeDuringReview()
  assertEquals((await (await handler(request(f.publish),f.dependencies)).json()).data.status,'uncertain')
  assertEquals(f.network.some(x=>x.method==='POST'),false)
})
