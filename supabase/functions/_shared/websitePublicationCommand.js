// Fixed original-command envelope. This module does not dispatch or grant authority.
import {uuid} from './websiteStagingContracts.js'
import {sha} from './websiteStaging.js'
import {websiteNativeSnapshotChecksum} from './websiteNativeDesign.js'
import {reviewWebsitePublication, reviewWebsiteRollback} from './websitePublicationReview.js'
import {WEBSITE_BLOCK_FUNCTIONS} from './websiteBlockBuild.js'
import {PUBLICATION_TEMPLATE} from './websitePublicationBundle.js'

function exact(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) throw Error('Exact original publication command fields required')
}
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)

export async function publicationCommand(review, command, bundle, actorId, now = Date.now()) {
  if (![review?.id, command?.id, command?.request_id, command?.review_id, actorId].every(uuid) || command.review_id !== review.id || command.created_by !== actorId || review.created_by !== actorId) throw Error('Actual original publication actor and reviewed command required')
  const created = Date.parse(command.created_at), reviewed = Date.parse(review.created_at)
  if (!Number.isFinite(now) || !Number.isFinite(created) || !Number.isFinite(reviewed) || created > now || reviewed > created || created >= reviewed + 600000 || now >= created + 600000) throw Error('Original publication dispatch window expired; recover without resending')
  const verified = await reviewWebsitePublication(review.snapshot)
  if (verified.review_sha256 !== review.review_sha256) throw Error('Retained publication review checksum differs')
  exact(bundle, ['compiler', 'site_version_id', 'theme', 'pages', 'payload_sha256'])
  const {payload_sha256, ...payload} = bundle
  if (bundle.compiler !== 'anka-publication-v1' || bundle.site_version_id !== review.snapshot.site_version_id || !hash(payload_sha256) || await websiteNativeSnapshotChecksum(payload) !== payload_sha256 || !Array.isArray(bundle.pages) || bundle.pages.length !== review.snapshot.pages.length) throw Error('Original compiled publication payload differs')
  exact(bundle.theme, ['files', 'file_hashes', 'theme_sha256'])
  const paths = ['functions.php', 'parts/footer.html', 'parts/header.html', 'style.css', 'templates/index.html', 'theme.json']
  exact(bundle.theme.files, paths); exact(bundle.theme.file_hashes, paths)
  if (bundle.theme.files['functions.php'] !== WEBSITE_BLOCK_FUNCTIONS || bundle.theme.files['templates/index.html'] !== PUBLICATION_TEMPLATE || await websiteNativeSnapshotChecksum(bundle.theme.files) !== bundle.theme.theme_sha256 || bundle.theme.theme_sha256 !== review.snapshot.theme_change.reviewed_sha256) throw Error('Exact fixed reviewed publication theme required')
  for (const path of paths) {
    const content = bundle.theme.files[path]
    if (typeof content !== 'string' || await sha(new TextEncoder().encode(content)) !== bundle.theme.file_hashes[path]) throw Error('Original publication theme file checksum differs')
  }
  const seen = new Set()
  for (const page of bundle.pages) {
    exact(page, ['page_id', 'page_key', 'job_id', 'package_sha256', 'title', 'meta_description', 'post_content'])
    const selected = review.snapshot.pages.find(row => row.page_id === page.page_id)
    if (!selected || seen.has(page.page_id) || selected.page_key !== page.page_key || selected.job_id !== page.job_id || selected.package_sha256 !== page.package_sha256 || [page.title, page.meta_description, page.post_content].some(value => typeof value !== 'string')) throw Error('Compiled page differs from its exact reviewed package')
    seen.add(page.page_id)
  }
  const envelope = {protocol: 'anka-publication-v1', kind: 'publication', site_id: review.snapshot.target.site_id, request_id: command.request_id, command_id: command.id, review_id: review.id, review_sha256: review.review_sha256, review_snapshot: structuredClone(review.snapshot), bundle: structuredClone(bundle), created_at: command.created_at}
  if (new TextEncoder().encode(JSON.stringify(envelope)).byteLength > 6291456) throw Error('Publication command exceeds six MiB')
  return {...envelope, command_sha256: await websiteNativeSnapshotChecksum(envelope)}
}

export function verifyPublicationReceipt(receipt, review, command) {
  if (receipt?.status === 'missing') throw Error('Original remote receipt is missing; its outcome remains uncertain and recovery never resends')
  if (!receipt || !['pending', 'uncertain', 'succeeded', 'failed'].includes(receipt.status)) throw Error('Original publication outcome is not verified')
  exact(receipt, receipt.status === 'succeeded' ? ['request_id', 'status', 'kind', 'command_id', 'review_sha256', 'head', 'backup_snapshot_sha256'] : ['request_id', 'status', 'kind', 'command_id', 'review_sha256'])
  if (receipt.kind !== (review.kind || 'publication') || receipt.request_id !== command.request_id || receipt.command_id !== command.id || receipt.review_sha256 !== review.review_sha256) throw Error('Remote publication receipt belongs to another original command')
  if (receipt.status === 'succeeded' && (receipt.head !== command.request_id || !hash(receipt.backup_snapshot_sha256))) throw Error('Exact published head and retained backup checksum required')
  return structuredClone(receipt)
}

export async function rollbackCommand(review, command, actorId, now = Date.now()) {
  if (![review?.id, command?.id, command?.request_id, actorId].every(uuid) || command.review_id !== review.id || command.created_by !== actorId || review.created_by !== actorId) throw Error('Actual original rollback actor required')
  const created = Date.parse(command.created_at), reviewed = Date.parse(review.created_at)
  if (!Number.isFinite(now) || !Number.isFinite(created) || !Number.isFinite(reviewed) || created > now || reviewed > created || created >= reviewed + 600000 || now >= created + 600000) throw Error('Original rollback dispatch window expired; recover without resending')
  const verified = await reviewWebsiteRollback(review.snapshot)
  if (verified.review_sha256 !== review.review_sha256) throw Error('Retained rollback review checksum differs')
  const envelope = {protocol:'anka-publication-v1',kind:'rollback',site_id:review.snapshot.target.site_id,request_id:command.request_id,command_id:command.id,review_id:review.id,review_sha256:review.review_sha256,review_snapshot:structuredClone(review.snapshot),created_at:command.created_at}
  return {...envelope,command_sha256:await websiteNativeSnapshotChecksum(envelope)}
}
