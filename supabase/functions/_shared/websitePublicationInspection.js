// Bounded production inspection, separate explicit dispatch, and GET-only recovery.
import {uuid, stagingOrigin} from './websiteStagingContracts.js'
import {boundedResponse, publicAddress} from './websiteStaging.js'
import {validatePublicationInventory} from './websitePublicationReview.js'
import {websiteNativeSnapshotChecksum} from './websiteNativeDesign.js'

const checksum = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)

// Recovery projects fixed protocol fields only. No upstream messages or content leave this module.
export function publicationReceipt(result, requestId) {
  if (result?.request_id !== requestId) throw Error('Original publication receipt differs')
  if (result.status === 'missing') return {request_id: requestId, status: 'missing'}
  if (!['pending', 'uncertain', 'succeeded', 'failed'].includes(result.status) || !['publication', 'rollback'].includes(result.kind) || !checksum(result.review_sha256) || !uuid(result.command_id)) throw Error('Invalid original publication receipt')
  const receipt = {request_id: requestId, status: result.status, kind: result.kind, command_id: result.command_id, review_sha256: result.review_sha256}
  if (result.status === 'succeeded') {
    if (!uuid(result.head) || !checksum(result.backup_snapshot_sha256)) throw Error('Incomplete successful publication receipt')
    return {...receipt, head: result.head, backup_snapshot_sha256: result.backup_snapshot_sha256}
  }
  return receipt
}

export function verifyPublicationIdentity(identity, origin, siteId) {
  if (identity?.protocol !== 'anka-publication-v1' || identity.receiver_version !== '1.0.0' || identity.environment !== 'production' || identity.wordpress_version !== '7.1.3' || !/^8\.3\.[0-9]+$/.test(identity.php_version || '') || identity.compiler !== 'anka-native-block-v1' || identity.base_url !== origin || !uuid(identity.site_id) || (siteId && identity.site_id !== siteId) || identity.publication_enabled !== true) throw Error('Exact enabled production publication receiver identity required')
  return {protocol: identity.protocol, receiver_version: identity.receiver_version, environment: identity.environment, wordpress_version: identity.wordpress_version, php_version: identity.php_version, compiler: identity.compiler, base_url: identity.base_url, site_id: identity.site_id, publication_enabled: true}
}

export function createPublicationInspection(connection, {env, fetcher = fetch, resolver}) {
  const origin = stagingOrigin(connection.base_url)
  let allowed
  try {allowed = JSON.parse(env('WEBSITE_PUBLICATION_ALLOWED_ORIGINS') || '[]')} catch {throw Error('Publication origin configuration is invalid')}
  if (!Array.isArray(allowed) || !allowed.includes(origin)) throw Error('Exact publication origin is not enabled by the operator')
  if (typeof resolver !== 'function') throw Error('Public DNS verification is required')
  if (!/^ANKA_WORDPRESS_[A-Z0-9_]+$/.test(connection.secret_name || '')) throw Error('Scoped WordPress credential reference required')
  const password = env(connection.secret_name)
  if (!password || typeof connection.username !== 'string' || !connection.username || connection.username.includes(':')) throw Error('Publication connection credential unavailable')
  const authorization = 'Basic ' + btoa(connection.username + ':' + password)
  async function read(route, command = null) {
    if (!(command ? /^\/(?:publish|rollback)$/.test(route) : /^\/(?:identity|inventory|requests\/[0-9a-f-]{36})$/.test(route))) throw Error('Read-only publication inspection route required')
    if (command && new TextEncoder().encode(JSON.stringify(command)).byteLength > 6291456) throw Error('Original command exceeds its bound')
    const addresses = await resolver(new URL(origin).hostname)
    if (!Array.isArray(addresses) || addresses.length === 0 || addresses.some(address => !publicAddress(address))) throw Error('Publication DNS target is not public')
    const response = await fetcher(origin + '/wp-json/anka-publish/v1' + route, {method: command ? 'POST' : 'GET', body: command ? JSON.stringify(command) : undefined, redirect: 'error', signal: AbortSignal.timeout(12000), headers: {Authorization: authorization, Accept: 'application/json', 'Content-Type': 'application/json'}})
    if (!response.ok) throw Error('Publication inspection failed (HTTP ' + response.status + ')')
    if (!response.headers.get('content-type')?.includes('application/json') || !response.headers.get('cache-control')?.includes('no-store')) throw Error('Uncached publication inspection JSON required')
    let body
    try {body = await boundedResponse(response, route.startsWith('/requests/') ? 4194304 : 2097152)} catch {throw Error('Publication inspection response is unavailable or exceeds its bound')}
    try {return JSON.parse(body)} catch {throw Error('Publication inspection returned invalid JSON')}
  }
  return Object.freeze({
    origin,
    async identity(siteId) {return verifyPublicationIdentity(await read('/identity'), origin, siteId)},
    async inventory(siteId) {
      if (!uuid(siteId)) throw Error('Exact inspected site ID required')
      const result = await read('/inventory')
      verifyPublicationIdentity(result.identity, origin, siteId)
      if (result.inventory?.site_id !== siteId || result.inventory.origin !== origin || result.inventory.environment !== 'production') throw Error('Publication inventory belongs to another site')
      const inventory = validatePublicationInventory(result.inventory)
      const {inventory_sha256, ...snapshot} = inventory
      if (await websiteNativeSnapshotChecksum(snapshot) !== inventory_sha256) throw Error('Complete publication inventory checksum differs')
      return inventory
    },
    async execute(siteId, command) {
      if (!uuid(siteId) || command.site_id !== siteId || !['publication', 'rollback'].includes(command.kind)) throw Error('Exact original command target required')
      return publicationReceipt(await read(command.kind === 'publication' ? '/publish' : '/rollback', command), command.request_id)
    },
    async outcome(siteId, requestId) {
      if (!uuid(siteId) || !uuid(requestId)) throw Error('Exact original outcome required')
      const result = await read('/requests/' + requestId); verifyPublicationIdentity(result.identity, origin, siteId)
      const receipt = publicationReceipt(result, requestId)
      if (receipt.status !== 'succeeded') return {receipt}
      const inventory = validatePublicationInventory(result.state?.inventory), {inventory_sha256, ...snapshot} = inventory
      if (inventory.site_id !== siteId || inventory.origin !== origin || inventory.head !== receipt.head || await websiteNativeSnapshotChecksum(snapshot) !== inventory_sha256) throw Error('Original terminal inventory proof differs')
      return {receipt, state: {inventory}, rollback: receipt.kind === 'publication' ? result.rollback : undefined}
    },
    async recover(siteId, requestId) {
      if (!uuid(siteId) || !uuid(requestId)) throw Error('Exact original publication request required')
      const result = await read('/requests/' + requestId)
      verifyPublicationIdentity(result.identity, origin, siteId)
      if (result.request_id !== requestId) throw Error('Original publication receipt differs')
      return publicationReceipt(result, requestId)
    },
  })
}
