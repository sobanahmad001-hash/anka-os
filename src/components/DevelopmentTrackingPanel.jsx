import { useState } from 'react'

import {
  DEVELOPMENT_ARTIFACTS,
  DEVELOPMENT_ARTIFACT_TYPES,
  DEVELOPMENT_STAGE_STATUSES,
  artifactContent,
  developmentStatus,
  latestArtifactVersion,
} from '../data/developmentStudio.js'
import { developmentStudio } from '../data/developmentStudioRepository.js'

const INPUT = 'w-full rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-2.5 text-sm text-white outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20'
const PRIMARY = 'rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50'

export default function DevelopmentTrackingPanel({ workspace, onRefresh }) {
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const stages = workspace.stages.filter(stage => stage.accountable_department_id === 'development')

  async function act(callback, success) {
    setSaving(true); setError(''); setNotice('')
    try {
      await callback()
      await onRefresh()
      setNotice(success)
    } catch (reason) {
      setError(reason.message)
    } finally {
      setSaving(false)
    }
  }

  return <div className="mt-6 space-y-6">
    <section className="rounded-2xl border border-blue-900/40 bg-blue-950/15 p-5">
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-blue-400">Development tracking only</p>
      <p className="mt-2 max-w-4xl text-sm leading-6 text-slate-400">Record stage progress, concise team notes, and immutable technical or launch artifacts. Source code, builds, deployments, and engineering tickets remain outside Anka Sphere.</p>
    </section>
    {(error || notice) && <div className={`rounded-xl border px-4 py-3 text-sm ${error ? 'border-red-900/60 bg-red-950/40 text-red-300' : 'border-emerald-900/60 bg-emerald-950/30 text-emerald-300'}`}>{error || notice}</div>}
    <section>
      <div><h2 className="text-lg font-semibold">Development stages</h2><p className="mt-1 text-xs text-slate-500">Four status choices and one notes field per instantiated Development stage.</p></div>
      <div className="mt-4 grid gap-4 xl:grid-cols-3">{stages.map(stage => <StageCard key={`${stage.id}:${stage.status}:${stage.team_notes}`} stage={stage} saving={saving} onSave={(status, notes) => act(() => developmentStudio.updateStage({ stage_id: stage.id, status, notes }), `${stage.name} tracking updated.`)} />)}</div>
      {!stages.length && <div className="mt-4 rounded-2xl border border-dashed border-slate-700 p-8 text-center text-sm text-slate-500">No Development stage was instantiated for this engagement.</div>}
    </section>
    <ArtifactPanel workspace={workspace} stages={stages} saving={saving} act={act} />
  </div>
}

function StageCard({ stage, saving, onSave }) {
  const [status, setStatus] = useState(developmentStatus(stage.status))
  const [notes, setNotes] = useState(stage.team_notes || '')
  return <form onSubmit={event => { event.preventDefault(); onSave(status, notes) }} className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
    <div className="flex items-start justify-between gap-3"><div><p className="font-semibold text-white">{stage.name}</p><p className="mt-1 text-xs text-slate-500">Internal stage record</p></div><span className="rounded-full bg-blue-950 px-2.5 py-1 text-[10px] font-semibold uppercase text-blue-300">{DEVELOPMENT_STAGE_STATUSES.find(item => item.id === status)?.label}</span></div>
    <label className="mt-5 block text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Status<select className={`${INPUT} mt-2 normal-case tracking-normal`} value={status} onChange={event => setStatus(event.target.value)}>{DEVELOPMENT_STAGE_STATUSES.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
    <label className="mt-4 block text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Team notes<textarea rows="5" maxLength="12000" className={`${INPUT} mt-2 normal-case tracking-normal`} value={notes} onChange={event => setNotes(event.target.value)} placeholder="What is happening, what is blocked, or what should the next handoff know?" /></label>
    <button disabled={saving} className={`${PRIMARY} mt-4 w-full`}>{saving ? 'Saving…' : 'Save stage tracking'}</button>
  </form>
}

function ArtifactPanel({ workspace, stages, saving, act }) {
  const [type, setType] = useState('technical_brief')
  const artifact = workspace.developmentArtifacts.find(item => item.artifact_type === type)
  const latest = latestArtifactVersion(workspace.developmentArtifactVersions, artifact?.id)
  return <section>
    <div><h2 className="text-lg font-semibold">Development artifacts</h2><p className="mt-1 text-xs text-slate-500">Each save creates a new immutable version linked to this engagement.</p></div>
    <div className="mt-4 grid gap-6 xl:grid-cols-[300px_1fr]">
      <div className="space-y-3">{DEVELOPMENT_ARTIFACT_TYPES.map(id => {
        const item = workspace.developmentArtifacts.find(candidate => candidate.artifact_type === id)
        const itemLatest = latestArtifactVersion(workspace.developmentArtifactVersions, item?.id)
        return <button key={id} onClick={() => setType(id)} className={`w-full rounded-2xl border p-4 text-left ${type === id ? 'border-blue-500/60 bg-blue-950/20' : 'border-slate-800 bg-slate-900/70 hover:border-slate-700'}`}><div className="flex items-start justify-between gap-3"><p className="font-semibold text-white">{DEVELOPMENT_ARTIFACTS[id].label}</p><span className={`rounded-full px-2.5 py-1 text-[10px] uppercase ${itemLatest ? 'bg-blue-950 text-blue-300' : 'bg-slate-950 text-slate-500'}`}>{itemLatest ? `v${itemLatest.version_number}` : 'Missing'}</span></div><p className="mt-2 text-xs leading-5 text-slate-500">{DEVELOPMENT_ARTIFACTS[id].description}</p></button>
      })}</div>
      <ArtifactForm key={`${type}:${latest?.id || 'new'}`} workspace={workspace} stages={stages} type={type} artifact={artifact} latest={latest} saving={saving} act={act} />
    </div>
  </section>
}

function ArtifactForm({ workspace, stages, type, artifact, latest, saving, act }) {
  const definition = DEVELOPMENT_ARTIFACTS[type]
  const [title, setTitle] = useState(artifact?.title || `${definition.label} — ${workspace.engagement.name}`)
  const [notes, setNotes] = useState(latest?.content?.notes || '')
  const [checklist, setChecklist] = useState((latest?.content?.checklist || []).join('\n'))
  const [summary, setSummary] = useState(latest ? `Revision from version ${latest.version_number}` : 'Initial Development tracking version')
  const [stageId, setStageId] = useState(artifact?.engagement_stage_instance_id || stages[0]?.id || '')
  const [classification, setClassification] = useState(latest?.data_classification || 'internal')

  async function save(event) {
    event.preventDefault()
    const content = artifactContent(notes, checklist)
    if (!content.notes && !content.checklist.length) return
    await act(() => developmentStudio.saveArtifact({
      engagement_id: workspace.engagement.id,
      stage_id: stageId || null,
      artifact_id: artifact?.id || null,
      artifact_type: type,
      title,
      content,
      change_summary: summary,
      data_classification: classification,
      ai_use_allowed: false,
    }), `${definition.label} saved as a new immutable version.`)
  }

  return <form onSubmit={save} className="rounded-2xl border border-slate-800 bg-slate-900/70 p-6">
    <div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-xs font-semibold uppercase tracking-[0.14em] text-blue-400">Immutable internal record</p><h3 className="mt-1 text-xl font-semibold">{definition.label}</h3><p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">{definition.description}</p></div><span className="text-xs text-slate-500">{latest ? `Current version ${latest.version_number}` : 'No version yet'}</span></div>
    <div className="mt-6 grid gap-4 md:grid-cols-2"><label className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Title<input required maxLength="240" className={`${INPUT} mt-2 normal-case tracking-normal`} value={title} onChange={event => setTitle(event.target.value)} /></label><label className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Linked stage<select className={`${INPUT} mt-2 normal-case tracking-normal`} value={stageId} onChange={event => setStageId(event.target.value)}><option value="">Engagement only</option>{stages.map(stage => <option key={stage.id} value={stage.id}>{stage.name}</option>)}</select></label></div>
    <label className="mt-4 block text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Notes<textarea rows="6" maxLength="12000" className={`${INPUT} mt-2 normal-case tracking-normal`} value={notes} onChange={event => setNotes(event.target.value)} placeholder="Record the concise technical or launch context." /></label>
    <label className="mt-4 block text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Checklist<span className="ml-2 font-normal normal-case tracking-normal text-slate-600">One item per line</span><textarea rows="5" className={`${INPUT} mt-2 normal-case tracking-normal`} value={checklist} onChange={event => setChecklist(event.target.value)} /></label>
    <div className="mt-4 grid gap-4 md:grid-cols-2"><label className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Change summary<input required maxLength="1000" className={`${INPUT} mt-2 normal-case tracking-normal`} value={summary} onChange={event => setSummary(event.target.value)} /></label><label className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Classification<select className={`${INPUT} mt-2 normal-case tracking-normal`} value={classification} onChange={event => setClassification(event.target.value)}><option>internal</option><option>confidential</option><option>restricted</option><option>public</option></select></label></div>
    <div className="mt-6 flex items-center justify-between gap-4 border-t border-slate-800 pt-5"><p className="text-xs text-slate-600">AI context is disabled for Development tracking artifacts.</p><button disabled={saving || (!notes.trim() && !checklist.trim())} className={PRIMARY}>{saving ? 'Saving…' : latest ? 'Create new version' : 'Save first version'}</button></div>
  </form>
}
