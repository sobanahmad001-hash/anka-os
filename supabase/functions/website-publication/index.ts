import {resolveServerOrganizationContext} from '../_shared/serverOrganizationContext.ts'
import {uuid} from '../_shared/websiteStagingContracts.js'
import {createPublicationInspection} from '../_shared/websitePublicationInspection.js'
import {buildWebsitePublicationBundle} from '../_shared/websitePublicationBundle.js'
import {reviewWebsitePublication, reviewWebsiteRollback} from '../_shared/websitePublicationReview.js'
import {publicationCommand, rollbackCommand, verifyPublicationReceipt} from '../_shared/websitePublicationCommand.js'
import {websiteNativeSnapshotChecksum} from '../_shared/websiteNativeDesign.js'

type Json = Record<string, any>
const cors = {'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS'}
const reply = (data: Json, status = 200) => new Response(JSON.stringify(data), {status, headers: {...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store'}})
function exact(value: Json, keys: string[]) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) throw Error('Exact publication request fields required')
}
async function rpc(admin: any, name: string, args: Json) {
  const {data, error} = await admin.rpc(name, args)
  if (error) throw Object.assign(Error('Publication access or current source verification failed'), {status: error.code === '42501' ? 403 : 409})
  return data
}
const realEnv = (name: string) => Deno.env.get(name)
const resolveHost = async (host: string) => {
  const answers = await Promise.allSettled([Deno.resolveDns(host, 'A'), Deno.resolveDns(host, 'AAAA')])
  return answers.flatMap(answer => answer.status === 'fulfilled' ? answer.value : [])
}

// Fixed explicit owner operations; only a newly admitted original command may dispatch.
export async function handler(req: Request, dependencies: {resolveContext?: typeof resolveServerOrganizationContext; env?: (key: string) => string | undefined; resolver?: (host: string) => Promise<string[]>; fetcher?: typeof fetch} = {}) {
  if (req.method === 'OPTIONS') return new Response('ok', {headers: cors})
  if (req.method !== 'POST') return reply({error: 'Method not allowed'}, 405)
  try {
    const stream = req.body?.getReader(); if (!stream) throw Error('Publication request required')
    const chunks: Uint8Array[] = []; let size = 0
    for (;;) {
      const part = await stream.read(); if (part.done) break
      size += part.value.byteLength
      if (size > 1048576) {await stream.cancel(); return reply({error: 'Publication request exceeds its bound'}, 413)}
      chunks.push(part.value)
    }
    const bytes = new Uint8Array(size); let offset = 0
    for (const chunk of chunks) {bytes.set(chunk, offset); offset += chunk.byteLength}
    const body = JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(bytes))
    const fields: Record<string, string[]> = {workspace: [], inventory: ['target_id'], inspect: ['connection_id'], bind: ['connection_id', 'inspection', 'inspection_sha256', 'confirmed', 'request_id'], review: ['target_id', 'pages', 'theme_change', 'request_id'], 'review-rollback': ['publication_request_id', 'theme_change', 'request_id'], publish: ['review_id', 'review_sha256', 'confirmed', 'request_id'], rollback: ['review_id', 'review_sha256', 'confirmed', 'request_id'], recover: ['request_id']}
    if (!fields[body?.action]) throw Error('Unsupported publication action; live execution is unavailable')
    exact(body, ['action', 'organization_id', 'project_id', 'engagement_id', ...fields[body.action]])
    for (const key of ['organization_id', 'project_id', 'engagement_id', ...fields[body.action].filter(key => key.endsWith('_id'))]) if (!uuid(body[key])) throw Error('Exact publication identities required')
    const ctx = await (dependencies.resolveContext || resolveServerOrganizationContext)(req, {root: {kind: 'engagement', id: body.engagement_id}, requestedOrganizationId: body.organization_id})
    if (ctx.organizationId !== body.organization_id || ctx.projectId !== body.project_id || ctx.engagementId !== body.engagement_id || ctx.membership.member_kind !== 'team' || ctx.membership.status !== 'active' || !['system_owner', 'operations_admin'].includes(ctx.membership.role)) return reply({error: 'Current organization owner or operations admin required'}, 403)
    const scope = {p_organization_id: ctx.organizationId, p_project_id: ctx.projectId, p_engagement_id: ctx.engagementId, p_actor_id: ctx.user.id}
    const targetContext = (target: string | null, connection: string | null) => rpc(ctx.admin, 'get_website_publication_target', {...scope, p_target_id: target, p_connection_id: connection})
    const transport = (connection: Json) => createPublicationInspection(connection, {env: dependencies.env || realEnv, resolver: dependencies.resolver || resolveHost, fetcher: dependencies.fetcher || fetch})
    const safe = (status: string, requestId: string, extra: Json = {}) => ({organization_id: ctx.organizationId, project_id: ctx.projectId, engagement_id: ctx.engagementId, request_id: requestId, status, ...extra})
    const original = (requestId: string) => rpc(ctx.admin, 'get_website_publication_command', {...scope, p_request_id: requestId})
    async function settle(record: Json) {
      if (!record?.command || !record.review || !record.target) throw Error('Original command is unavailable in this project; nothing was resent')
      const command = record.command, review = record.review
      if (record.result) return safe(record.result.outcome, command.request_id, {kind: review.kind, projection_status: record.result.projection_status, receipt: record.result.receipt})
      const current = await targetContext(record.target.id, null), remote = transport(current.connection)
      await remote.identity(record.target.site_id)
      const proof = await remote.outcome(record.target.site_id, command.request_id)
      const receipt = verifyPublicationReceipt(proof.receipt, review, command)
      if (!['succeeded', 'failed'].includes(receipt.status)) return safe(receipt.status, command.request_id, {kind: review.kind})
      let state = null
      if (receipt.status === 'succeeded') {
        const inventory = proof.state?.inventory
        if (!inventory) throw Error('Original terminal inventory proof unavailable')
        if (review.kind === 'publication') {
          for (const page of review.snapshot.pages) {
            const post = inventory.posts.find((row: Json) => row.managed_page_id === page.page_id)
            if (!post || post.path !== page.path || post.post_type !== 'page' || post.post_status !== 'publish' || (page.operation === 'replace' && post.post_id !== page.post_id)) throw Error('Original published page proof differs')
          }
        } else {
          const publication = await original(review.snapshot.retained.published_head)
          if (!publication?.result || publication.command.id !== review.snapshot.retained.publication_id || publication.result.receipt.backup_snapshot_sha256 !== receipt.backup_snapshot_sha256) throw Error('Original rollback backup proof differs')
          for (const page of publication.review.snapshot.pages) {
            const live = publication.result.remote_state.inventory.posts.find((post: Json) => post.managed_page_id === page.page_id)
            const restored = inventory.posts.find((post: Json) => post.post_id === live?.post_id)
            if (page.operation === 'create' ? Boolean(restored) : !restored || restored.path !== page.path || restored.managed_page_id !== publication.review.snapshot.inspection.posts.find((post: Json) => post.post_id === page.post_id)?.managed_page_id) throw Error('Original restored page proof differs')
          }
        }
        const observed = await remote.inventory(record.target.site_id)
        state = {inventory, observed_inventory_sha256: observed.inventory_sha256}
      }
      const saved = await rpc(ctx.admin, 'record_website_publication_result', {...scope, p_command_id: command.id, p_receipt: receipt, p_remote_state: state})
      return safe(saved.outcome, command.request_id, {kind: review.kind, projection_status: saved.projection_status, receipt: saved.receipt})
    }
    if (body.action === 'workspace') return reply({data: await rpc(ctx.admin, 'get_website_publication_workspace', scope)})
    if (body.action === 'recover') return reply({data: await settle(await original(body.request_id))})
    if (body.action === 'inventory') {
      const current = await targetContext(body.target_id, null), remote = transport(current.connection)
      await remote.identity(current.target.site_id)
      const inventory = await remote.inventory(current.target.site_id)
      await targetContext(body.target_id, null)
      return reply({data: {organization_id: ctx.organizationId, project_id: ctx.projectId, engagement_id: ctx.engagementId, target_id: body.target_id, inventory}})
    }
    if (body.action === 'review-rollback') {
      const retained = await original(body.publication_request_id)
      if (retained?.review?.kind !== 'publication' || retained?.result?.outcome !== 'succeeded') throw Error('Select an original successful publication')
      const current = await targetContext(retained.target.id, null), remote = transport(current.connection)
      await remote.identity(current.target.site_id)
      const proof = await remote.outcome(current.target.site_id, body.publication_request_id)
      verifyPublicationReceipt(proof.receipt, retained.review, retained.command)
      if (!proof.rollback || proof.receipt.status !== 'succeeded') throw Error('Original private backup proof unavailable')
      const {original_theme_sha256, ...backup} = proof.rollback
      const inventory = await remote.inventory(current.target.site_id)
      exact(body.theme_change, ['mode', 'expected_sha256', 'sitewide_impact_acknowledged', 'affected_posts'])
      const reviewed = await reviewWebsiteRollback({scope: {organization_id: ctx.organizationId, project_id: ctx.projectId, engagement_id: ctx.engagementId}, target: retained.review.snapshot.target, inspection: inventory, retained: backup, theme_change: {...body.theme_change, reviewed_sha256: original_theme_sha256}})
      const saved = await rpc(ctx.admin, 'record_website_rollback_review', {...scope, p_publication_request_id: body.publication_request_id, p_snapshot: reviewed.snapshot, p_review_sha256: reviewed.review_sha256, p_request_id: body.request_id})
      return reply({data: {...reviewed, review_id: saved.id, reviewed_at: saved.created_at}})
    }
    if (body.action === 'publish' || body.action === 'rollback') {
      if (body.confirmed !== true) throw Error('Confirm the exact reviewed live operation')
      const claimed = await rpc(ctx.admin, body.action === 'publish' ? 'start_website_publication_command' : 'start_website_rollback_command', {...scope, p_review_id: body.review_id, p_review_sha256: body.review_sha256, p_confirmed: true, p_request_id: body.request_id})
      const record = await original(body.request_id)
      if (!claimed.created) return reply({data: await settle(record)})
      try {
        const current = await targetContext(record.target.id, null), remote = transport(current.connection)
        await remote.identity(current.target.site_id)
        const inventory = await remote.inventory(current.target.site_id)
        if (inventory.inventory_sha256 !== record.review.snapshot.inspection.inventory_sha256) throw Error('Exact remote inventory changed before dispatch')
        let envelope
        if (body.action === 'publish') {
          const sources = await rpc(ctx.admin, 'get_website_publication_sources', {...scope, p_pages: record.review.source_selection})
          const bundle = await buildWebsitePublicationBundle(sources)
          envelope = await publicationCommand(record.review, record.command, bundle, ctx.user.id)
          const latest = await rpc(ctx.admin, 'get_website_publication_sources', {...scope, p_pages: record.review.source_selection})
          if (await websiteNativeSnapshotChecksum(sources) !== await websiteNativeSnapshotChecksum(latest)) throw Error('Publication sources changed before dispatch')
        } else envelope = await rollbackCommand(record.review, record.command, ctx.user.id)
        const latest = await targetContext(record.target.id, null)
        if (await websiteNativeSnapshotChecksum(latest.target) !== await websiteNativeSnapshotChecksum(current.target) || req.signal.aborted) throw Error('Original target or request changed before dispatch')
        verifyPublicationReceipt(await remote.execute(current.target.site_id, envelope), record.review, record.command)
        return reply({data: await settle(record)})
      } catch {
        return reply({data: safe('uncertain', body.request_id, {kind: body.action === 'publish' ? 'publication' : 'rollback', notice: 'Original outcome requires read-only recovery. Nothing will be resent.'})})
      }
    }
    if (body.action === 'inspect' || body.action === 'bind') {
      const current = await targetContext(null, body.connection_id), remote = transport(current.connection)
      const identity = await remote.identity(null)
      const inspection = {connection_id: current.connection.id, connection_revision: current.connection.revision, identity}
      const digest = await websiteNativeSnapshotChecksum(inspection)
      if (body.action === 'inspect') return reply({data: {inspection, inspection_sha256: digest, bound: false, publication_authorized: false}})
      if (body.confirmed !== true || body.inspection_sha256 !== digest || await websiteNativeSnapshotChecksum(body.inspection) !== digest) throw Error('Production identity changed or binding is unchecked; inspect again')
      const bound = await rpc(ctx.admin, 'bind_website_publication_target', {...scope, p_connection_id: body.connection_id, p_connection_revision: current.connection.revision, p_identity: identity, p_confirmed: true, p_request_id: body.request_id})
      return reply({data: {target: bound, publication_authorized: false}})
    }
    if (!Array.isArray(body.pages) || body.pages.length < 1 || body.pages.length > 100) throw Error('Bounded exact page selection required')
    for (const page of body.pages) exact(page, ['qa_receipt_id', 'approval_id', 'operation', 'post_id', 'expected_post_revision', 'expected_post_sha256'])
    exact(body.theme_change, ['mode', 'expected_sha256', 'sitewide_impact_acknowledged', 'affected_posts'])
    const current = await targetContext(body.target_id, null), remote = transport(current.connection)
    await remote.identity(current.target.site_id)
    const sources = await rpc(ctx.admin, 'get_website_publication_sources', {...scope, p_pages: body.pages.map((page: Json) => ({qa_receipt_id: page.qa_receipt_id, approval_id: page.approval_id}))})
    const bundle = await buildWebsitePublicationBundle(sources), inventory = await remote.inventory(current.target.site_id)
    const selected = sources.pages.map((page: Json) => {
      const operation = body.pages.find((row: Json) => row.qa_receipt_id === page.qa.receipt_id)
      if (!operation) throw Error('Exact selected page operation required')
      return {...page, path: page.path.startsWith('/') ? page.path : '/' + page.path, operation: operation.operation, post_id: operation.post_id, expected_post_revision: operation.expected_post_revision, expected_post_sha256: operation.expected_post_sha256}
    })
    if (body.theme_change.mode === 'retain' && inventory.theme_sha256 !== bundle.theme.theme_sha256) throw Error('Retained active theme differs from the compiled site system; review exact theme replacement')
    const review = await reviewWebsitePublication({scope: {organization_id: ctx.organizationId, project_id: ctx.projectId, engagement_id: ctx.engagementId}, target: {target_id: current.target.id, connection_id: current.target.connection_id, site_id: current.target.site_id, origin: current.target.base_url, environment: 'production', connection_revision: current.target.connection_revision}, inspection: inventory, site_version_id: sources.site_version_id, pages: selected, theme_change: {...body.theme_change, reviewed_sha256: bundle.theme.theme_sha256}})
    // Recheck authority and all source records after remote awaits. A stale review never becomes executable.
    const latestTarget = await targetContext(body.target_id, null)
    const latestSources = await rpc(ctx.admin, 'get_website_publication_sources', {...scope, p_pages: body.pages.map((page: Json) => ({qa_receipt_id: page.qa_receipt_id, approval_id: page.approval_id}))})
    if (await websiteNativeSnapshotChecksum(latestTarget.target) !== await websiteNativeSnapshotChecksum(current.target) || await websiteNativeSnapshotChecksum(latestSources) !== await websiteNativeSnapshotChecksum(sources)) throw Error('Publication authority or source changed during inspection; review again')
    const retained = await rpc(ctx.admin, 'record_website_publication_review', {...scope, p_target_id: body.target_id, p_source_selection: body.pages.map((page: Json) => ({qa_receipt_id: page.qa_receipt_id, approval_id: page.approval_id})), p_snapshot: review.snapshot, p_review_sha256: review.review_sha256, p_request_id: body.request_id})
    return reply({data: {...review, review_id: retained.id, reviewed_at: retained.created_at}})
  } catch (error) {
    const e = error as Error & {status?: number}
    return reply({error: e instanceof SyntaxError ? 'Invalid bounded publication JSON' : e.message || 'Publication review unavailable', executable: false}, e.status || 400)
  }
}
if (import.meta.main) Deno.serve(req => handler(req))
