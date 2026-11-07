import { validateProjectSetup } from './projectSetup.js'
const need = (v, message) => { if (!v) throw Error(message) }
const freeze = v => { if (v && typeof v === 'object') { Object.values(v).forEach(freeze); Object.freeze(v) } return v }
const sha = async v => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(v))))].map(v => v.toString(16).padStart(2, '0')).join('')

/** Explicit local review bridge. Existing combined setup review/apply is the only save path. */
export async function reviewWebsiteIntakeForSetup(snapshot, currentPlan, draft, decisions, { pendingRequestId = null } = {}) {
  need(pendingRequestId === null, 'Recover the original setup save before changing this proposal')
  const { sha256, ...value } = structuredClone(draft || {})
  need(value.version === 1 && value.kind === 'project_website_intake_draft' && value.review_required === true && value.project_changes_applied === false && value.reference_material_only === true && sha256 === await sha(value), 'Exact original source-attributed draft required')
  need(value.scope.organization_id === snapshot.organization_id && value.scope.project_id === snapshot.project_id && value.scope.setup_token === snapshot.token, 'Refresh the current project setup before reviewing this extract')
  need(Array.isArray(decisions) && decisions.length === value.facts.length && new Set(decisions.map(d => d.fact_index)).size === value.facts.length, 'Accept, edit or dismiss each exact proposed fact')
  const plan = structuredClone(currentPlan), reviewed = []
  for (const decision of decisions) {
    need(decision && Object.keys(decision).sort().join(',') === 'action,edited_text,fact_index,service_id' && Number.isSafeInteger(decision.fact_index) && value.facts[decision.fact_index] && ['accept', 'edit', 'dismiss'].includes(decision.action), 'Exact explicit fact review required')
    const fact = value.facts[decision.fact_index]
    need(fact.source?.kind === 'user_supplied' && fact.source.supporting_extract === fact.proposed_text && typeof fact.proposed_text === 'string' && /^[a-f0-9]{64}$/.test(fact.source.content_sha256 || ''), 'Original user-supplied source attribution required')
    if (decision.action === 'dismiss') {
      need(decision.service_id === null && decision.edited_text === null, 'Dismissed facts cannot change setup fields')
      reviewed.push({ ...decision, source: structuredClone(fact.source) }); continue
    }
    need(snapshot.can_manage === true, 'Current setup management permission is required')
    const item = plan.items.find(i => i.service_id === decision.service_id)
    need(item && typeof item.evidence === 'string', 'Choose an already selected setup service; intake cannot add services')
    need(decision.action === 'accept' ? decision.edited_text === null : typeof decision.edited_text === 'string' && decision.edited_text.trim().length > 0 && decision.edited_text.length <= 300, 'Review the edited interpretation explicitly')
    const evidence = item.evidence + '\nUser-supplied website reference: ' + fact.source.page_url + '\nSupporting extract: ' + fact.source.supporting_extract
      + '\nExtract SHA256: ' + fact.source.content_sha256
      + (decision.action === 'edit' ? '\nReviewed interpretation: ' + decision.edited_text : '')
    need(evidence.length <= 500, 'Select a shorter extract or evidence before review; source attribution cannot be truncated')
    item.evidence = evidence
    reviewed.push({ ...decision, source: structuredClone(fact.source) })
  }
  const changed = reviewed.some(d => d.action !== 'dismiss')
  const validated = changed ? validateProjectSetup(plan, snapshot) : null
  return freeze({ version: 1, state: changed ? 'awaiting_existing_setup_review' : 'dismissed', scope: structuredClone(value.scope), draft_sha256: sha256, decisions: reviewed, plan: changed ? validated : structuredClone(currentPlan), review_required: changed, project_changes_applied: false })
}
