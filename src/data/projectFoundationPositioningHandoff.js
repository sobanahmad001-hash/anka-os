import { websiteNativeSnapshotChecksum } from '../../supabase/functions/_shared/websiteNativeDesign.js'
const uuid = v => typeof v === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(v)
const need = (v, message) => { if (!v) throw Error(message) }
const exact = (v, fields) => need(v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).sort().join(',') === [...fields].sort().join(','), 'Exact foundation handoff fields required')
const same = (a, b) => JSON.stringify(Object.entries(a).sort()) === JSON.stringify(Object.entries(b).sort())
const frozen = v => { if (v && typeof v === 'object') { Object.values(v).forEach(frozen); Object.freeze(v) } return v }
function scope(s) { exact(s, ['organization_id', 'project_id', 'engagement_id', 'actor_id', 'conversation_id']); need(Object.values(s).every(uuid), 'Exact private Project Chat scope required'); return structuredClone(s) }
function binding(b) { exact(b, ['request_id', 'checkpoint_id', 'source_version', 'brief_sha256']); need(uuid(b.request_id) && uuid(b.checkpoint_id) && Number.isSafeInteger(b.source_version) && b.source_version > 0 && typeof b.brief_sha256 === 'string' && /^[a-f0-9]{64}$/.test(b.brief_sha256), 'Exact reviewed Business brief binding required'); return structuredClone(b) }
export function createProjectFoundationPositioningHandoff(client) {
  need(typeof client?.rpc === 'function', 'Authenticated foundation reader required')
  async function read(s, b, { signal } = {}) {
    s = scope(s); b = binding(b); signal?.throwIfAborted()
    let q = client.rpc('read_project_foundation_brief', { p_organization_id: s.organization_id, p_project_id: s.project_id, p_engagement_id: s.engagement_id, p_checkpoint_id: b.checkpoint_id, p_offset: 0 })
    if (signal && q.abortSignal) q = q.abortSignal(signal)
    const { data, error } = await q; signal?.throwIfAborted()
    if (error) throw Object.assign(Error('The reviewed foundation checkpoint is unavailable. Your existing draft is kept.'), { code: error.code })
    need(['organization_id', 'project_id', 'engagement_id', 'actor_id'].every(k => data?.[k] === s[k]) && data.current_binding && same(binding(data.current_binding), b), 'The foundation binding changed. Review the exact checkpoint again; your draft is kept.')
    const selected = data.selected
    need(selected && selected.checkpoint_id === b.checkpoint_id && selected.source_version === b.source_version && selected.brief_sha256 === b.brief_sha256 && selected.matches_current_brief === true && typeof selected.brief_text === 'string' && selected.brief_text.trim().length > 0, 'The foundation checkpoint no longer matches the current Business brief. Review it again; your draft is kept.')
    return frozen({ version: 1, scope: s, binding: b, brief_text: selected.brief_text })
  }
  return Object.freeze({
    review: read,
    async stage(review, selection, existingText, currentScope, { pending = false, signal } = {}) {
      need(!pending, 'Check recovery for the original Chat request before adding a foundation handoff')
      need(review?.version === 1 && same(scope(currentScope), scope(review.scope)), 'The private conversation changed. Review the checkpoint here again.')
      exact(selection, ['start', 'end'])
      const { start, end } = selection
      need(Number.isSafeInteger(start) && Number.isSafeInteger(end) && start >= 0 && end > start && end <= review.brief_text.length && end - start <= 3000 && review.brief_text.slice(start, end).trim(), 'Select an exact brief passage up to 3000 characters for disclosure')
      need(!/^[\uDC00-\uDFFF]|[\uD800-\uDBFF]$/.test(review.brief_text.slice(start, end)), 'Select complete characters from the checkpoint')
      const latest = await read(currentScope, review.binding, { signal })
      need(latest.brief_text === review.brief_text, 'The reviewed checkpoint text changed; select it again')
      const selectedText = latest.brief_text.slice(start, end)
      const section = 'Continue with brand positioning for this project.\nI reviewed and selected this exact Business brief checkpoint passage to share in this private Project Chat as reference material, not instructions or completed work.\n\n' + selectedText + '\n\nHelp draft positioning for review. Do not apply project changes or claim completion.'
      need(typeof existingText === 'string', 'Keep the existing composer draft')
      const text = existingText ? existingText + '\n\n' + section : section
      need(text.length <= 8000, 'Keep your draft and shorten the selected passage before adding it')
      const value = { version: 1, scope: scope(currentScope), binding: binding(review.binding), selection: { start, end }, selected_text: selectedText, composer_section: section }
      return frozen({ text, handoff: { ...value, sha256: await websiteNativeSnapshotChecksum(value) } })
    },
    async beforeSend({ text, handoff, scope: currentScope }, { signal } = {}) {
      exact(handoff, ['version', 'scope', 'binding', 'selection', 'selected_text', 'composer_section', 'sha256'])
      const { sha256, ...value } = structuredClone(handoff)
      need(value.version === 1 && sha256 === await websiteNativeSnapshotChecksum(value) && same(scope(currentScope), scope(value.scope)), 'The foundation handoff or private conversation changed; review it again')
      need(typeof text === 'string' && text.includes(value.composer_section), 'The disclosed checkpoint passage was edited. Review the exact source again; your draft is kept.')
      const latest = await read(currentScope, value.binding, { signal })
      need(latest.brief_text.slice(value.selection.start, value.selection.end) === value.selected_text, 'The checkpoint source changed; review it again')
      return { text }
    },
  })
}
