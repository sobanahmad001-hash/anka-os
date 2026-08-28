import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'

import DepartmentChat from '../components/DepartmentChat.jsx'
import {
  CONTENT_ARTIFACT_FORMS,
  CONTENT_ARTIFACT_TYPES,
  approvalForVersion,
  bestContentStage,
  contentArtifactEditor,
  latestVersion,
  newContentRecord,
  serializeContentArtifact,
} from '../data/contentStudio.js'
import { contentStudio } from '../data/contentStudioRepository.js'

const INPUT = 'w-full rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-2.5 text-sm text-white outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-500/20'
const BUTTON = 'rounded-xl border border-slate-700 px-4 py-2 text-sm font-semibold text-slate-200 transition hover:border-amber-500 hover:text-white disabled:cursor-not-allowed disabled:opacity-50'
const PRIMARY = 'rounded-xl bg-amber-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-amber-500 disabled:cursor-not-allowed disabled:opacity-50'

export default function ContentStudio() {
  const [engagements, setEngagements] = useState([])
  const [engagementId, setEngagementId] = useState('')
  const [workspace, setWorkspace] = useState(null)
  const [type, setType] = useState('discovery')
  const [tab, setTab] = useState('artifacts')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  async function loadWorkspace(id) {
    if (!id) { setWorkspace(null); setLoading(false); return }
    setLoading(true); setError('')
    try { setWorkspace(await contentStudio.load(id)) }
    catch (reason) { setError(reason.message) }
    finally { setLoading(false) }
  }

  useEffect(() => {
    let active = true
    contentStudio.listEngagements().then(rows => {
      if (!active) return
      setEngagements(rows || [])
      const first = rows?.[0]?.id || ''
      setEngagementId(first)
      if (first) loadWorkspace(first)
      else setLoading(false)
    }).catch(reason => { if (active) { setError(reason.message); setLoading(false) } })
    return () => { active = false }
  }, [])

  async function act(callback, success) {
    setSaving(true); setError(''); setMessage('')
    try {
      const result = await callback()
      setMessage(success)
      await loadWorkspace(engagementId)
      return result
    } catch (reason) {
      setError(reason.message)
      return null
    } finally { setSaving(false) }
  }

  const artifactForType = artifactType => workspace?.artifacts.find(item => item.artifact_type === artifactType) || null

  return <div className="h-full overflow-y-auto bg-slate-950 text-white">
    <header className="border-b border-slate-800 bg-[radial-gradient(circle_at_top_left,rgba(245,158,11,0.12),transparent_36%)] px-6 py-6">
      <div className="mx-auto flex max-w-7xl flex-wrap items-end justify-between gap-5">
        <div><p className="text-xs font-semibold uppercase tracking-[0.16em] text-amber-400">Content department</p><h1 className="mt-1 text-3xl font-semibold tracking-tight">Content Studio</h1><p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">Build the approved context and structured content system that Design, Development, and Marketing consume.</p></div>
        <Link to="/sphere/content" className={BUTTON}>Open Content work queue</Link>
      </div>
    </header>
    <main className="mx-auto max-w-7xl space-y-6 px-6 py-6">
      {(error || message) && <div className={`rounded-xl border px-4 py-3 text-sm ${error ? 'border-red-900/60 bg-red-950/40 text-red-300' : 'border-emerald-900/60 bg-emerald-950/30 text-emerald-300'}`}>{error || message}</div>}
      <section className="flex flex-wrap items-end gap-4 rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
        <label className="min-w-72 flex-1 text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">Content engagement
          <select value={engagementId} onChange={event => { setEngagementId(event.target.value); loadWorkspace(event.target.value) }} className={`${INPUT} mt-2 normal-case tracking-normal`}>
            {engagements.map(item => <option key={item.id} value={item.id}>{item.name} · {item.brands?.name || 'Brand'}</option>)}
          </select>
        </label>
        {workspace?.engagement && <div className="rounded-xl bg-slate-950 px-4 py-3 text-sm text-slate-400"><span className="font-semibold text-white">{workspace.engagement.brands?.name}</span><span className="mx-2 text-slate-700">/</span>{workspace.engagement.agency_clients?.name}</div>}
      </section>
      <nav className="flex gap-2 overflow-x-auto border-b border-slate-800">
        {[['artifacts', 'Artifact workspace'], ['chat', 'Shared Department Chat']].map(([id, label]) => <button key={id} onClick={() => setTab(id)} className={`border-b-2 px-4 py-3 text-sm font-semibold ${tab === id ? 'border-amber-400 text-amber-300' : 'border-transparent text-slate-500 hover:text-white'}`}>{label}</button>)}
      </nav>
      {loading ? <div className="py-20 text-center text-sm text-slate-500">Loading Content Studio…</div> : !workspace ? <div className="rounded-2xl border border-dashed border-slate-700 px-6 py-16 text-center text-sm text-slate-500">Activate a Content service on an engagement to begin.</div> : tab === 'artifacts' ? (
        <ArtifactWorkspace workspace={workspace} type={type} setType={setType} saving={saving} act={act} />
      ) : <DepartmentChat departmentId="content" engagement={workspace.engagement} artifactTypes={CONTENT_ARTIFACT_TYPES} artifactDefinitions={CONTENT_ARTIFACT_FORMS} artifactForType={artifactForType} stageForType={artifactType => bestContentStage(workspace.stages, artifactType)} onPropose={contentStudio.proposeArtifact} onCreated={() => loadWorkspace(engagementId)} />}
    </main>
  </div>
}

function ArtifactWorkspace({ workspace, type, setType, saving, act }) {
  const artifact = workspace.artifacts.find(item => item.artifact_type === type)
  const versions = workspace.versions.filter(item => item.artifact_id === artifact?.id)
  const latest = latestVersion(versions)
  const approval = approvalForVersion(workspace.approvals, latest?.id)
  return <div className="grid gap-6 xl:grid-cols-[320px_1fr]">
    <section className="space-y-3">{Object.entries(CONTENT_ARTIFACT_FORMS).map(([id, definition]) => {
      const item = workspace.artifacts.find(candidate => candidate.artifact_type === id)
      const itemLatest = latestVersion(workspace.versions.filter(version => version.artifact_id === item?.id))
      const itemApproval = approvalForVersion(workspace.approvals, itemLatest?.id)
      return <button key={id} onClick={() => setType(id)} className={`w-full rounded-2xl border p-4 text-left ${type === id ? 'border-amber-500/60 bg-amber-950/20' : 'border-slate-800 bg-slate-900/70 hover:border-slate-700'}`}><div className="flex items-start justify-between gap-3"><p className="font-semibold text-white">{definition.label}</p><span className={`rounded-full px-2.5 py-1 text-[10px] uppercase ${itemApproval ? 'bg-emerald-950 text-emerald-300' : itemLatest ? 'bg-amber-950 text-amber-300' : 'bg-slate-950 text-slate-500'}`}>{itemApproval ? 'Approved' : itemLatest ? 'Draft' : 'Missing'}</span></div><p className="mt-2 text-xs leading-5 text-slate-500">{definition.description}</p></button>
    })}</section>
    <ArtifactForm key={`${type}:${latest?.id || 'new'}`} workspace={workspace} type={type} artifact={artifact} latest={latest} approval={approval} saving={saving} act={act} />
  </div>
}

function ArtifactForm({ workspace, type, artifact, latest, approval, saving, act }) {
  const definition = CONTENT_ARTIFACT_FORMS[type]
  const [form, setForm] = useState(contentArtifactEditor(type, latest?.content))
  const [summary, setSummary] = useState(latest ? `Revision from version ${latest.version_number}` : 'Initial Content Studio version')
  const [classification, setClassification] = useState(latest?.data_classification || 'internal')
  const [aiSafe, setAiSafe] = useState(latest?.ai_use_allowed || false)

  async function save(event) {
    event.preventDefault()
    await act(() => contentStudio.saveArtifact({
      engagement_id: workspace.engagement.id, artifact_id: artifact?.id || null,
      engagement_stage_instance_id: bestContentStage(workspace.stages, type)?.id || null,
      artifact_type: type, title: artifact?.title || `${definition.label} artifact`,
      content: serializeContentArtifact(type, form), change_summary: summary,
      data_classification: classification, ai_use_allowed: aiSafe,
    }), `${definition.label} saved as a new immutable version.`)
  }

  return <form onSubmit={save} className="rounded-2xl border border-slate-800 bg-slate-900/70 p-6">
    <div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-xs font-semibold uppercase tracking-[0.14em] text-amber-400">Canonical immutable artifact</p><h2 className="mt-1 text-2xl font-semibold">{definition.label}</h2><p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">{definition.description}</p></div><div className="text-right text-xs text-slate-500"><p>{latest ? `Version ${latest.version_number}` : 'No version yet'}</p><p className={approval ? 'mt-1 text-emerald-400' : 'mt-1 text-amber-400'}>{approval ? 'Exact version approved' : 'Approval pending'}</p></div></div>
    <div className="mt-6 space-y-5">{definition.fields.map(field => <ArtifactField key={field.key} field={field} value={form[field.key]} onChange={value => setForm(current => ({ ...current, [field.key]: value }))} />)}</div>
    <div className="mt-6 grid gap-4 md:grid-cols-2"><label className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">Change summary<input required className={`${INPUT} mt-2 normal-case tracking-normal`} value={summary} onChange={event => setSummary(event.target.value)} /></label><label className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">Data classification<select className={`${INPUT} mt-2 normal-case tracking-normal`} value={classification} onChange={event => setClassification(event.target.value)}><option>internal</option><option>confidential</option><option>public</option><option>restricted</option></select></label></div>
    <label className="mt-4 flex items-start gap-3 rounded-xl border border-slate-800 bg-slate-950/60 p-4 text-sm text-slate-300"><input type="checkbox" className="mt-1" checked={aiSafe} onChange={event => setAiSafe(event.target.checked)} /><span>Explicitly allow this exact version to be included in approved AI context. Restricted versions remain excluded.</span></label>
    <div className="mt-6 flex flex-wrap justify-end gap-3 border-t border-slate-800 pt-5">{latest && !approval && <button type="button" disabled={saving} onClick={() => act(() => contentStudio.approveArtifact(latest.id), `${definition.label} exact version approved.`)} className={BUTTON}>Approve version {latest.version_number}</button>}<button disabled={saving} className={PRIMARY}>{saving ? 'Saving…' : latest ? 'Create new version' : 'Save first version'}</button></div>
  </form>
}

function ArtifactField({ field, value, onChange }) {
  if (field.kind === 'records') return <div><div className="flex items-center justify-between gap-3"><p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">{field.label}</p><button type="button" className={BUTTON} onClick={() => onChange([...(value || []), newContentRecord(field)])}>{field.addLabel}</button></div><div className="mt-3 space-y-4">{(value || []).map((record, index) => <RecordEditor key={index} index={index} field={field} record={record} onChange={next => onChange(value.map((item, itemIndex) => itemIndex === index ? next : item))} onRemove={() => onChange(value.filter((_, itemIndex) => itemIndex !== index))} />)}{!(value || []).length && <div className="rounded-xl border border-dashed border-slate-700 p-6 text-center text-sm text-slate-500">Add at least one structured record.</div>}</div></div>
  const textarea = field.kind === 'textarea' || field.kind === 'list'
  return <label className="block text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">{field.label}{field.kind === 'list' && <span className="ml-2 font-normal normal-case tracking-normal text-slate-600">One item per line</span>}{textarea ? <textarea required rows={field.kind === 'list' ? 4 : 5} className={`${INPUT} mt-2 normal-case tracking-normal`} value={value || ''} onChange={event => onChange(event.target.value)} /> : <input required className={`${INPUT} mt-2 normal-case tracking-normal`} value={value || ''} onChange={event => onChange(event.target.value)} />}</label>
}

function RecordEditor({ index, field, record, onChange, onRemove }) {
  return <div className="rounded-2xl border border-slate-800 bg-slate-950/50 p-4"><div className="mb-4 flex items-center justify-between"><p className="text-xs font-semibold uppercase tracking-[0.12em] text-amber-400">{field.label} {index + 1}</p><button type="button" onClick={onRemove} className="text-xs font-semibold text-red-300">Remove</button></div><div className="grid gap-4 md:grid-cols-2">{field.recordFields.map(([key, label, kind]) => <label key={key} className={`text-xs font-semibold uppercase tracking-[0.12em] text-slate-500 ${kind === 'textarea' || kind === 'list' ? 'md:col-span-2' : ''}`}>{label}{kind === 'list' && <span className="ml-2 font-normal normal-case tracking-normal">Comma separated</span>}{kind === 'textarea' ? <textarea required rows="4" className={`${INPUT} mt-2 normal-case tracking-normal`} value={record[key] || ''} onChange={event => onChange({ ...record, [key]: event.target.value })} /> : <input required className={`${INPUT} mt-2 normal-case tracking-normal`} value={Array.isArray(record[key]) ? record[key].join(', ') : record[key] || ''} onChange={event => onChange({ ...record, [key]: event.target.value })} />}</label>)}</div></div>
}
