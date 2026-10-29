import {assertEquals, assertRejects, assertThrows} from 'jsr:@std/assert@1.0.14'
import {createPublicationInspection, publicationReceipt} from './websitePublicationInspection.js'

import {websiteNativeSnapshotChecksum} from './websiteNativeDesign.js'

const site = 'e0000000-0000-4000-8000-000000000001', request = 'e0000000-0000-4000-8000-000000000002'
const origin = 'https://publication.example.test'
const connection = {base_url: origin, username: 'synthetic-publisher', secret_name: 'ANKA_WORDPRESS_FIXTURE'}
const identity = {protocol: 'anka-publication-v1', receiver_version: '1.0.0', environment: 'production', wordpress_version: '7.1.3', php_version: '8.3.33', compiler: 'anka-native-block-v1', base_url: origin, site_id: site, publication_enabled: true}
function fixture(changes: Record<string, any> = {}) {
  const calls: Array<{url: string; method: string; redirect: string}> = []
  const env = (key: string) => key === 'WEBSITE_PUBLICATION_ALLOWED_ORIGINS' ? JSON.stringify([origin]) : key === 'ANKA_WORDPRESS_FIXTURE' ? 'synthetic-not-a-credential' : undefined
  const inventory = {site_id: site, origin, environment: 'production', head: null, theme_sha256: 'b'.repeat(64), complete: true, posts: []}
  const dependencies = {env, resolver: async () => ['8.8.8.8'], fetcher: async (url: string | URL | Request, options?: RequestInit) => {calls.push({url: String(url), method: String(options?.method), redirect: String(options?.redirect)}); return Response.json(String(url).endsWith('/inventory') ? {identity, inventory: {...inventory, inventory_sha256: await websiteNativeSnapshotChecksum(inventory)}} : String(url).includes('/requests/') ? {identity, request_id: request, status: 'missing'} : identity, {headers: {'Cache-Control': 'private, no-store'}})}, ...changes}
  return {calls, dependencies}
}
Deno.test('inspection and original receipt recovery remain GET-only; dispatch is a separate explicit method', async () => {
  const f = fixture(), transport = createPublicationInspection(connection, f.dependencies)
  await transport.identity(site); await transport.inventory(site); await transport.recover(site, request)
  assertEquals(f.calls.map(call => call.method), ['GET', 'GET', 'GET'])
  assertEquals(f.calls.every(call => call.redirect === 'error'), true)
  assertEquals(Object.keys(transport).sort(), ['execute', 'identity', 'inventory', 'origin', 'outcome', 'recover'])
})
Deno.test('production inspection cannot reuse the staging allowlist or omit DNS checks', () => {
  const f = fixture({env: (key: string) => key === 'WEBSITE_STAGING_ALLOWED_ORIGINS' ? JSON.stringify([origin]) : undefined})
  assertThrows(() => createPublicationInspection(connection, f.dependencies))
  assertThrows(() => createPublicationInspection(connection, fixture({resolver: undefined}).dependencies))
})
Deno.test('private and mixed DNS answers block before any HTTP request', async () => {
  for (const addresses of [[], ['127.0.0.1'], ['8.8.8.8', '10.0.0.1'], ['::1']]) {
    const f = fixture({resolver: async () => addresses})
    await assertRejects(() => createPublicationInspection(connection, f.dependencies).identity(site))
    assertEquals(f.calls.length, 0)
  }
})
Deno.test('staging, disabled and foreign receiver identities are rejected', async () => {
  for (const patch of [{environment: 'staging'}, {publication_enabled: false}, {site_id: request}, {base_url: 'https://other.example.test'}]) {
    const f = fixture({fetcher: async () => Response.json({...identity, ...patch}, {headers: {'Cache-Control': 'private, no-store'}})})
    await assertRejects(() => createPublicationInspection(connection, f.dependencies).identity(site))
  }
})
Deno.test('inspection refuses cached bodies, non-JSON and oversized responses', async () => {
  for (const response of [Response.json(identity), new Response('private body', {headers: {'Cache-Control': 'no-store'}}), new Response('x'.repeat(2097153), {headers: {'Content-Type': 'application/json', 'Cache-Control': 'no-store'}})]) {
    const f = fixture({fetcher: async () => response})
    await assertRejects(() => createPublicationInspection(connection, f.dependencies).identity(site))
  }
})
Deno.test('errors do not expose upstream body or the credential', async () => {
  const f = fixture({fetcher: async () => new Response('sensitive synthetic upstream message', {status: 401})})
  const error = await assertRejects(() => createPublicationInspection(connection, f.dependencies).identity(site))
  assertEquals(error instanceof Error ? error.message : null, 'Publication inspection failed (HTTP 401)')
})

Deno.test('recovery never returns upstream private text or accepts incomplete success', () => {
  assertEquals(publicationReceipt({request_id:request,status:'missing',message:'private synthetic message'},request),{request_id:request,status:'missing'})
  const receipt={request_id:request,status:'succeeded',kind:'publication',command_id:site,review_sha256:'a'.repeat(64)}
  assertThrows(()=>publicationReceipt(receipt,request))
  assertEquals(publicationReceipt({...receipt,head:site,backup_snapshot_sha256:'b'.repeat(64),secret:'synthetic'},request),{...receipt,head:site,backup_snapshot_sha256:'b'.repeat(64)})
  assertThrows(()=>publicationReceipt({...receipt,status:'unknown'},request))
})
Deno.test('inventory rejects ambiguous paths, incomplete snapshots and upstream extra fields', async () => {
  for(const inventory of [{site_id:site,origin,environment:'production'}, {site_id:site,origin,environment:'production',head:null,inventory_sha256:'a'.repeat(64),theme_sha256:'b'.repeat(64),complete:true,posts:[],password:'synthetic'}]){
    const f=fixture({fetcher:async()=>Response.json({identity,inventory},{headers:{'Cache-Control':'no-store'}})})
    await assertRejects(()=>createPublicationInspection(connection,f.dependencies).inventory(site))
  }
})
Deno.test('complete inventory bytes must match the receiver checksum before review', async () => {
  const inventory = {site_id:site, origin, environment:'production', head:null, inventory_sha256:'a'.repeat(64), theme_sha256:'b'.repeat(64), complete:true, posts:[]}
  const f=fixture({fetcher:async()=>Response.json({identity, inventory},{headers:{'Cache-Control':'no-store'}})})
  await assertRejects(()=>createPublicationInspection(connection,f.dependencies).inventory(site),Error,'checksum differs')
})
