import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { OUTPUT_FAMILIES, latestByVersion } from '../data/designWorkshop.js'
import { designWorkshop } from '../data/designWorkshopRepository.js'
import { useAuth } from '../context/AuthContext.jsx'
import VersionProofingPanel from '../components/VersionProofingPanel.jsx'
import ArtifactRelationsPanel from '../components/ArtifactRelationsPanel.jsx'

const INPUT = 'w-full rounded-xl border border-white/10 bg-slate-950/70 px-3 py-2.5 text-sm text-slate-100 outline-none focus:border-violet-500/60'
const BUTTON = 'rounded-xl bg-violet-500 px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40'

export default function DesignWorkshop() {
  const { user } = useAuth()
  const [engagements, setEngagements] = useState([])
  const [engagementId, setEngagementId] = useState('')
  const [workspace, setWorkspace] = useState(null)
  const [tab, setTab] = useState('artifacts')
  const [modal, setModal] = useState(null)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')

  useEffect(() => { designWorkshop.listEngagements().then(items => {
    const designItems = items.filter(item => (item.engagement_services || []).some(service => {
      const catalog = Array.isArray(service.service_catalog) ? service.service_catalog[0] : service.service_catalog
      return catalog?.department_id === 'design'
    }))
    setEngagements(designItems); if (designItems[0]) setEngagementId(designItems[0].id)
  }).catch(capture) }, [])
  useEffect(() => { if (engagementId) refresh() }, [engagementId])

  function capture(reason) { setError(reason instanceof Error ? reason.message : String(reason)); setBusy('') }
  async function refresh() { setError(''); setBusy('load'); try { setWorkspace(await designWorkshop.load(engagementId)) } catch (reason) { capture(reason) } finally { setBusy('') } }
  async function act(key, action) { setBusy(key); setError(''); try { await action(); setModal(null); await refresh() } catch (reason) { capture(reason) } finally { setBusy('') } }

  if (!engagements.length && !error) return <Shell><Empty title="No Design engagement yet" text="Activate at least one Design service on an engagement before opening the Workshop." /></Shell>
  return <Shell>
    <div className="flex flex-col gap-4 border-b border-white/10 pb-5 lg:flex-row lg:items-end lg:justify-between">
      <div><p className="text-xs font-semibold uppercase tracking-[.24em] text-violet-400">Designer-controlled environment</p><h1 className="mt-2 text-3xl font-semibold">Design Workshop</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">Approved human context becomes three traceable directions. Nothing is approved or released automatically.</p></div>
      <Field label="Engagement"><select className={`${INPUT} min-w-72`} value={engagementId} onChange={event => setEngagementId(event.target.value)}>{engagements.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field>
    </div>
    {error && <div className="mt-5 rounded-xl border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-200">{error}</div>}
    <div className="mt-5 flex gap-2">{[['artifacts', 'Approved Content context'], ['workshop', 'Direction workshop']].map(([id, label]) => <button key={id} onClick={() => setTab(id)} className={`rounded-xl px-4 py-2 text-sm font-semibold ${tab === id ? 'bg-white text-slate-950' : 'bg-white/5 text-slate-300'}`}>{label}</button>)}</div>
    {busy === 'load' || !workspace ? <div className="py-20 text-center text-sm text-slate-500">Loading exact versions…</div>
      : tab === 'artifacts' ? <ArtifactWorkspace workspace={workspace} />
        : <WorkshopWorkspace workspace={workspace} currentUserId={user?.id} onCreate={() => setModal({ kind: 'session' })} onGenerate={session => act(`generate-${session.id}`, () => designWorkshop.generateDirections(session.id))} onRefine={(direction, version) => setModal({ kind: 'refine', direction, version })} onPromote={version => act(`promote-${version.id}`, () => designWorkshop.promoteDirectionExperiment(version.id))} onSelect={(session, version) => act(`select-${version.id}`, () => designWorkshop.selectDirection(session.id, version.id))} onRelease={session => act(`release-${session.id}`, () => designWorkshop.releaseDirection(session.id, 'Released by the accountable human reviewer.'))} busy={busy} />}
    {modal?.kind === 'session' && <SessionModal workspace={workspace} busy={busy} onClose={() => setModal(null)} onSave={input => act('create-session', () => designWorkshop.createSession(input))} />}
    {modal?.kind === 'refine' && <RefineModal {...modal} reviewers={workspace.experimentReviewers || []} currentUserId={user?.id} busy={busy} onClose={() => setModal(null)} onSave={(content, experiment) => act('refine', () => designWorkshop.createDirectionRevision(modal.direction.id, modal.version.id, content, experiment))} />}
  </Shell>
}

function ArtifactWorkspace({ workspace }) {
  const types = [['discovery', 'Discovery'], ['vision', 'Vision'], ['audience', 'Audience']]
  return <div className="mt-6"><Panel><div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-xs font-semibold uppercase tracking-wider text-violet-400">Read-only upstream context</p><h2 className="mt-2 text-xl font-semibold">Content Studio owns these artifacts</h2><p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">Design compiles the exact approved versions below. Creation, revision, and approval now happen in Content Studio.</p></div><Link to="/sphere/content/studio" className={BUTTON}>Open Content Studio</Link></div></Panel><div className="mt-5 grid gap-5 xl:grid-cols-3">{types.map(([type, label]) => {
    const artifact = workspace.artifacts.find(item => item.artifact_type === type)
    const versions = workspace.versions.filter(item => item.artifact_id === artifact?.id)
    const approval = [...workspace.approvals].filter(item => item.artifact_id === artifact?.id).sort((a, b) => new Date(b.approved_at) - new Date(a.approved_at))[0]
    const approvedVersion = versions.find(item => item.id === approval?.artifact_version_id)
    return <Panel key={type}><div className="flex items-start justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-wider text-violet-400">{label}</p><h2 className="mt-2 text-lg font-semibold">{artifact?.title || `${label} artifact`}</h2></div><Badge tone={approvedVersion ? 'green' : 'amber'}>{approvedVersion ? 'Approved' : 'Missing'}</Badge></div>
      {approvedVersion ? <><div className="mt-5 space-y-2 rounded-xl bg-white/[0.03] p-3 text-xs text-slate-400"><p>Exact approved version {approvedVersion.version_number} · {new Date(approval.approved_at).toLocaleString()}</p><p>{approvedVersion.ai_use_allowed ? 'Authorised for Design AI context' : 'Not authorised for Design AI context'} · {approvedVersion.data_classification}</p></div><ArtifactRelationsPanel artifact={artifact} /></> : <Empty title="No approved version" text="Complete and approve this artifact in Content Studio." compact />}
    </Panel>
  })}</div></div>
}

function WorkshopWorkspace({ workspace, currentUserId, onCreate, onGenerate, onRefine, onPromote, onSelect, onRelease, busy }) {
  const approvedTypes = new Set(workspace.approvals.map(approval => workspace.artifacts.find(item => item.id === approval.artifact_id)?.artifact_type).filter(Boolean))
  const ready = ['discovery', 'vision', 'audience'].every(type => approvedTypes.has(type))
  const session = workspace.sessions[0]
  const directions = session ? workspace.directions.filter(item => item.session_id === session.id) : []
  const selection = session && workspace.selections.find(item => item.session_id === session.id)
  const release = session && workspace.releases.find(item => item.session_id === session.id)
  return <div className="mt-6 space-y-6">
    {!session ? <Panel><h2 className="text-xl font-semibold">Compile approved context</h2><p className="mt-2 text-sm text-slate-400">The session snapshots exact approved Discovery, Vision and Audience versions, then adds an output brief and designer-safe instructions.</p><div className="mt-4 flex items-center gap-3"><Badge tone={ready ? 'green' : 'amber'}>{approvedTypes.size}/3 approved</Badge><button disabled={!ready} className={BUTTON} onClick={onCreate}>Create Design Workshop session</button></div></Panel>
      : <Panel><div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-xs font-semibold uppercase tracking-wider text-violet-400">Compiled session</p><h2 className="mt-2 text-xl font-semibold">{familyLabel(session.output_family)}</h2><p className="mt-2 text-sm text-slate-400">Context {session.context_checksum.slice(0, 12)}… · {Object.keys(session.context_manifest?.artifacts || {}).length} exact approved inputs</p></div><Badge tone={release ? 'green' : session.status === 'generation_failed' ? 'red' : 'violet'}>{release ? 'Released' : session.status.replaceAll('_', ' ')}</Badge></div><p className="mt-4 rounded-xl bg-white/[0.03] p-4 text-sm leading-6 text-slate-300">{session.designer_instructions}</p>{!directions.length && <button disabled={busy === `generate-${session.id}` || !['ready', 'generation_failed'].includes(session.status)} onClick={() => onGenerate(session)} className={`${BUTTON} mt-4`}>{busy === `generate-${session.id}` ? 'Generating three distinct directions…' : 'Generate three directions'}</button>}</Panel>}
    {!!directions.length && <div className="grid gap-5 xl:grid-cols-3">{directions.map(direction => { const versions = workspace.directionVersions.filter(item => item.direction_id === direction.id); const version = latestByVersion(versions); const selected = selection?.direction_version_id === version?.id; return <DirectionCard key={direction.id} direction={direction} versions={versions} version={version} selected={selected} released={release?.direction_version_id === version?.id} onRefine={() => onRefine(direction, version)} onSelect={() => onSelect(session, version)} canSelect={!selection} busy={busy} /> })}</div>}
    {!!workspace.experimentalDirectionVersions.length && <Panel><div><p className="text-xs font-semibold uppercase tracking-wider text-amber-300">Private experiments</p><h2 className="mt-2 text-xl font-semibold">Experimental versions</h2><p className="mt-2 text-sm text-slate-400">Visible only to each creator and invited reviewers. Experiments stay outside the main history until promoted.</p></div><div className="mt-5 grid gap-4 lg:grid-cols-2">{workspace.experimentalDirectionVersions.map(version => { const direction = directions.find(item => item.id === version.direction_id); const canPromote = version.created_by === currentUserId || (version.experiment_visibility || []).includes(currentUserId); return <ExperimentCard key={version.id} direction={direction} version={version} canPromote={canPromote} onPromote={() => onPromote(version)} busy={busy} /> })}</div></Panel>}
    {selection && !release && <Panel><h3 className="font-semibold">Human selection recorded</h3><p className="mt-2 text-sm text-slate-400">Selection does not equal release. The accountable Design manager must perform the separate release action.</p><button disabled={busy === `release-${session.id}`} onClick={() => onRelease(session)} className={`${BUTTON} mt-4`}>Release selected exact version</button></Panel>}
  </div>
}

function ExperimentCard({ direction, version, canPromote, onPromote, busy }) {
  const content = version.content || {}
  return <section className="rounded-2xl border border-amber-400/20 bg-amber-400/[0.04] p-4"><div className="flex items-start justify-between gap-3"><div><p className="text-xs uppercase tracking-wider text-amber-300">Direction {direction?.direction_slot} · experimental v{version.version_number}</p><h3 className="mt-2 text-lg font-semibold">{content.title}</h3></div><Badge tone="amber">Experiment</Badge></div><p className="mt-3 text-sm leading-6 text-slate-400">{content.rationale}</p><p className="mt-3 text-xs text-slate-500">Immutable version {version.id.slice(0, 8)} · {version.experiment_visibility?.length || 0} invited reviewer(s)</p>{canPromote && <button disabled={busy === `promote-${version.id}`} onClick={onPromote} className={`${BUTTON} mt-4`}>{busy === `promote-${version.id}` ? 'Promoting…' : 'Promote to main version'}</button>}<VersionProofingPanel targetKind="design_direction" versions={[version]} initialVersionId={version.id} department="design" theme="violet" /></section>
}

function DirectionCard({ direction, versions, version, selected, released, onRefine, onSelect, canSelect, busy }) {
  const content = version?.content || {}; const palette = Array.isArray(content.palette) ? content.palette : []
  const [anchor, setAnchor] = useState(null)
  function anchorAt(event) { const bounds = event.currentTarget.getBoundingClientRect(); setAnchor({ x: (event.clientX - bounds.left) / bounds.width, y: (event.clientY - bounds.top) / bounds.height }) }
  return <Panel><div className="flex items-start justify-between gap-3"><div><p className="text-xs uppercase tracking-wider text-slate-500">Direction {direction.direction_slot} · v{version?.version_number}</p><h3 className="mt-2 text-xl font-semibold">{content.title}</h3></div>{(selected || released) && <Badge tone="green">{released ? 'Released' : 'Selected'}</Badge>}</div><div role="button" tabIndex="0" aria-label="Click to anchor a proofing comment" onClick={anchorAt} onKeyDown={event => { if (event.key === 'Enter') setAnchor({ x: 0.5, y: 0.5 }) }} className="relative mt-4 cursor-crosshair overflow-hidden rounded-2xl border border-white/10" style={{ background: content.preview_spec?.background || '#111827' }}><div className="p-5"><div className="h-2 w-16 rounded-full" style={{ background: content.preview_spec?.accent || '#8b5cf6' }} /><p className="mt-10 text-2xl font-bold text-white">{content.creative_thesis}</p><p className="mt-3 text-sm text-white/70">{content.preview_spec?.composition}</p></div><div className="flex">{palette.map((color, index) => <div key={index} title={`${color.name}: ${color.hex}`} className="h-10 flex-1" style={{ background: color.hex }} />)}</div>{anchor && <span className="pointer-events-none absolute h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-violet-500 shadow-lg" style={{ left: `${anchor.x * 100}%`, top: `${anchor.y * 100}%` }} />}</div><p className="mt-2 text-[11px] text-violet-300">Click the preview to anchor a positional comment.</p><p className="mt-4 text-sm leading-6 text-slate-400">{content.rationale}</p><div className="mt-4 flex flex-wrap gap-2">{(content.visual_principles || []).map(item => <Badge key={item}>{item}</Badge>)}</div><p className="mt-4 text-xs text-slate-500">Model run {version?.generation_run_id?.slice(0, 8) || 'human refinement'} · immutable version {version?.id?.slice(0, 8)}</p><div className="mt-5 flex gap-2"><button onClick={onRefine} className="rounded-xl border border-white/10 px-3 py-2 text-sm font-semibold">Refine as new version</button>{canSelect && <button disabled={busy === `select-${version.id}`} onClick={onSelect} className={BUTTON}>Select this version</button>}</div><VersionProofingPanel targetKind="design_direction" versions={versions} initialVersionId={version?.id} department="design" theme="violet" visualAnchor={anchor} visualAnchorVersionId={version?.id} onClearVisualAnchor={() => setAnchor(null)} /></Panel>
}

function SessionModal({ workspace, onClose, onSave, busy }) {
  const [family, setFamily] = useState('brand_identity'); const [instructions, setInstructions] = useState('')
  const [goal, setGoal] = useState(''); const [format, setFormat] = useState('Concept direction and design system recommendation')
  const [modelIds, setModelIds] = useState(workspace.models.slice(0, 2).map(item => item.id)); const [safe, setSafe] = useState(false)
  function toggle(id) { setModelIds(current => current.includes(id) ? current.filter(item => item !== id) : current.length < 3 ? [...current, id] : current) }
  function submit(event) { event.preventDefault(); onSave({ engagement_id: workspace.engagement.id, brand_id: workspace.engagement.brand_id, engagement_stage_instance_id: bestStage(workspace.stages, 'design')?.id || null, output_family: family, output_brief: { goal, required_format: format }, designer_instructions: instructions, instructions_safe_for_ai: safe, model_registry_ids: modelIds }) }
  return <Modal title="Create Design Workshop session" onClose={onClose}><form onSubmit={submit} className="space-y-5"><Field label="Output family"><select className={INPUT} value={family} onChange={event => setFamily(event.target.value)}>{OUTPUT_FAMILIES.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></Field><Field label="Output goal"><textarea required rows="3" className={INPUT} value={goal} onChange={event => setGoal(event.target.value)} /></Field><Field label="Required format"><input required className={INPUT} value={format} onChange={event => setFormat(event.target.value)} /></Field><Field label="Designer instructions"><textarea required rows="5" className={INPUT} value={instructions} onChange={event => setInstructions(event.target.value)} placeholder="Desired direction, references, exclusions, dimensions and production constraints" /></Field><div><p className="text-sm font-medium">Model routing</p><div className="mt-2 grid gap-2 sm:grid-cols-2">{workspace.models.map(model => <label key={model.id} className="flex items-start gap-3 rounded-xl border border-white/10 p-3"><input type="checkbox" checked={modelIds.includes(model.id)} onChange={() => toggle(model.id)} /><span><span className="block text-sm font-semibold">{model.display_name}</span><span className="mt-1 block text-xs text-slate-500">{model.speed_class} · {model.cost_class} cost · {model.limitations}</span></span></label>)}</div></div><label className="flex items-center gap-3 rounded-xl border border-amber-500/20 bg-amber-500/5 p-3 text-sm"><input required type="checkbox" checked={safe} onChange={event => setSafe(event.target.checked)} /><span>I confirm these designer instructions are safe to send to the selected models.</span></label><button disabled={busy === 'create-session' || !modelIds.length || !safe} className={`${BUTTON} w-full`}>Compile exact approved context</button></form></Modal>
}

function RefineModal({ version, reviewers, currentUserId, onClose, onSave, busy }) {
  const [content, setContent] = useState(version.content)
  const [isExperimental, setIsExperimental] = useState(false)
  const [reviewerIds, setReviewerIds] = useState([])
  const set = (key, value) => setContent(current => ({ ...current, [key]: value }))
  function toggleReviewer(id) { setReviewerIds(current => current.includes(id) ? current.filter(item => item !== id) : [...current, id]) }
  return <Modal title={`Refine “${version.content.title}” as a new version`} onClose={onClose}><form onSubmit={event => { event.preventDefault(); onSave(content, { isExperimental, reviewerIds }) }} className="space-y-4"><Field label="Concept title"><input required className={INPUT} value={content.title || ''} onChange={event => set('title', event.target.value)} /></Field><Field label="Rationale"><textarea required rows="4" className={INPUT} value={content.rationale || ''} onChange={event => set('rationale', event.target.value)} /></Field><Field label="Creative thesis"><textarea required rows="3" className={INPUT} value={content.creative_thesis || ''} onChange={event => set('creative_thesis', event.target.value)} /></Field><Field label="Imagery direction"><textarea rows="3" className={INPUT} value={content.imagery_direction || ''} onChange={event => set('imagery_direction', event.target.value)} /></Field><Field label="Layout direction"><textarea rows="3" className={INPUT} value={content.layout_direction || ''} onChange={event => set('layout_direction', event.target.value)} /></Field><label className="flex items-start gap-3 rounded-xl border border-amber-400/20 bg-amber-400/5 p-3"><input type="checkbox" checked={isExperimental} onChange={event => setIsExperimental(event.target.checked)} /><span><span className="block text-sm font-semibold text-amber-200">Mark as experimental</span><span className="mt-1 block text-xs text-slate-400">Keep this version outside main comparison and history until someone promotes it.</span></span></label>{isExperimental && <div><p className="text-sm font-medium">Invite reviewers</p><div className="mt-2 grid gap-2 sm:grid-cols-2">{reviewers.filter(reviewer => reviewer.user_id !== currentUserId).map(reviewer => <label key={reviewer.user_id} className="flex gap-3 rounded-xl border border-white/10 p-3"><input type="checkbox" checked={reviewerIds.includes(reviewer.user_id)} onChange={() => toggleReviewer(reviewer.user_id)} /><span><span className="block text-sm font-semibold">{reviewer.full_name}</span><span className="text-xs capitalize text-slate-500">{reviewer.department_id || 'cross-functional'} · {reviewer.role.replaceAll('_', ' ')}</span></span></label>)}</div></div>}<button disabled={busy === 'refine'} className={`${BUTTON} w-full`}>{isExperimental ? 'Create private experiment' : 'Create linked version'}</button></form></Modal>
}

function bestStage(stages, type) { const terms = type === 'discovery' ? ['discovery'] : type === 'vision' ? ['vision', 'identity'] : type === 'audience' ? ['audience'] : ['design']; return stages.find(stage => terms.some(term => stage.name.toLowerCase().includes(term))) }
function familyLabel(value) { return OUTPUT_FAMILIES.find(([id]) => id === value)?.[1] || value }
function Shell({ children }) { return <main className="min-h-full bg-slate-950 px-5 py-6 text-slate-100 lg:px-8">{children}</main> }
function Panel({ children }) { return <section className="rounded-2xl border border-white/[0.08] bg-slate-900/60 p-5 shadow-xl shadow-black/10">{children}</section> }
function Badge({ children, tone = 'slate' }) { const colors = { slate: 'bg-white/5 text-slate-300', green: 'bg-emerald-500/10 text-emerald-300', amber: 'bg-amber-500/10 text-amber-300', violet: 'bg-violet-500/10 text-violet-300', red: 'bg-red-500/10 text-red-300' }; return <span className={`inline-flex rounded-full px-2.5 py-1 text-[11px] font-semibold capitalize ${colors[tone]}`}>{children}</span> }
function Field({ label, children }) { return <label className="block"><span className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-slate-500">{label}</span>{children}</label> }
function Empty({ title, text, compact = false }) { return <div className={`${compact ? 'mt-5 py-3' : 'py-24'} text-center`}><p className="font-semibold text-slate-300">{title}</p><p className="mt-1 text-sm text-slate-500">{text}</p></div> }
function Modal({ title, onClose, children }) { return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4"><div className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-2xl border border-white/10 bg-slate-900 p-6 shadow-2xl"><div className="mb-5 flex items-center justify-between"><h2 className="text-xl font-semibold">{title}</h2><button type="button" onClick={onClose} className="rounded-lg px-3 py-2 text-sm text-slate-400 hover:bg-white/5">Close</button></div>{children}</div></div> }
