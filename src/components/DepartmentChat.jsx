import { useState } from 'react'

import { departmentChatProfile } from '../data/departmentChatProfiles.js'
import { departmentChat } from '../data/departmentChatRepository.js'

const INPUT = 'w-full rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-2.5 text-sm text-white outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20'
const PRIMARY = 'rounded-xl bg-sky-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-50'

export default function DepartmentChat({
  departmentId,
  departmentLabel,
  engagement,
  artifactDefinitions = {},
  artifactForType = () => null,
  stageForType = () => null,
  onPropose,
  onProposeWorkItem,
  onCreated,
}) {
  const profile = departmentChatProfile(departmentId)
  const resolvedDepartmentLabel = departmentLabel || profile.label
  const [artifactType, setArtifactType] = useState(profile.artifactTypes[0] || '')
  const [proposalMode, setProposalMode] = useState('artifact')
  const [prompt, setPrompt] = useState('')
  const [safe, setSafe] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState(null)
  const [title, setTitle] = useState('')
  const [workItemType, setWorkItemType] = useState('task')
  const [priority, setPriority] = useState('medium')

  async function submit(event) {
    event.preventDefault()
    setBusy(true)
    setError('')
    setResult(null)
    try {
      if (!onProposeWorkItem && proposalMode === 'work_item') {
        throw new Error('Work-item proposal is not available for this workflow.')
      }
      const proposed = proposalMode === 'artifact'
        ? await onPropose({
          engagement_id: engagement.id,
          artifact_id: (artifactForType(artifactType) || {}).id || null,
          engagement_stage_instance_id: (stageForType(artifactType) || {}).id || null,
          artifact_type: artifactType,
          title: (artifactForType(artifactType)?.title) || `${artifactDefinitions[artifactType]?.label || resolvedDepartmentLabel} artifact`,
          prompt,
          prompt_safe_for_ai: safe,
          change_summary: 'Draft proposed via Shared Department Chat',
        })
        : await onProposeWorkItem({
          engagement_id: engagement.id,
          title: title || `${artifactDefinitions[artifactType]?.label || 'Work item'} request`,
          work_item_type: workItemType,
          priority,
          prompt,
          prompt_safe_for_ai: safe,
        })
      setResult(proposed)
      setPrompt('')
      setSafe(false)
    } catch (reason) {
      setError(reason.message)
    } finally {
      setBusy(false)
    }
  }

  async function decide(action) {
    if (!result?.proposal_id) return
    setBusy(true)
    setError('')
    try {
      const decision = action === 'confirm'
        ? await departmentChat.confirmProposal(result.proposal_id)
        : await departmentChat.rejectProposal(result.proposal_id)
      setResult(current => ({ ...current, status: decision.outcome, decision }))
      if (decision.outcome === 'accepted') await onCreated(decision)
    } catch (reason) {
      setError(reason.message)
    } finally {
      setBusy(false)
    }
  }

  const isWorkItemMode = proposalMode === 'work_item'

  return <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
    <form onSubmit={submit} className="rounded-2xl border border-slate-800 bg-slate-900/70 p-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-sky-400">Shared Department Chat · {departmentId}</p>
        <h2 className="mt-2 text-2xl font-semibold text-white">Propose a structured artifact or work item</h2>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">The single configured model receives this engagement and approved AI-safe context. It creates one ordinary unapproved draft or work item; it cannot approve, release, publish, call a business connector, or perform external work.</p>
      </div>
      {error && <div className="mt-5 rounded-xl border border-red-900/60 bg-red-950/40 p-3 text-sm text-red-300">{error}</div>}
      {result && <ProposalPreview result={result} busy={busy} onConfirm={() => decide('confirm')} onReject={() => decide('reject')} />}
      <div className="mt-6 space-y-5">
        <label className="block text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">Proposal mode
          <select className={`${INPUT} mt-2 normal-case tracking-normal`} value={proposalMode} onChange={event => setProposalMode(event.target.value)}>
            <option value="artifact">Artifact draft</option>
            <option value="work_item">Work item draft</option>
          </select>
        </label>

        {isWorkItemMode ? (
          <>
            <label className="block text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">Work item title
              <input required className={`${INPUT} mt-2 normal-case tracking-normal`} value={title} onChange={event => setTitle(event.target.value)} placeholder="Short title for the proposed work item" />
            </label>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">Work item type
                <select className={`${INPUT} mt-2 normal-case tracking-normal`} value={workItemType} onChange={event => setWorkItemType(event.target.value)}>
                  {profile.workItemTypes.map(type => <option key={type} value={type}>{type[0].toUpperCase() + type.slice(1)}</option>)}
                </select>
              </label>
              <label className="block text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">Priority
                <select className={`${INPUT} mt-2 normal-case tracking-normal`} value={priority} onChange={event => setPriority(event.target.value)}>
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                  <option value="urgent">Urgent</option>
                </select>
              </label>
            </div>
          </>
        ) : (
          <>
            <label className="block text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">Artifact type
              <select className={`${INPUT} mt-2 normal-case tracking-normal`} value={artifactType} onChange={event => setArtifactType(event.target.value)}>
                {profile.artifactTypes.map(type => <option key={type} value={type}>{artifactDefinitions[type]?.label || type}</option>)}
              </select>
            </label>
            <label className="block text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">Artifact title
              <input className={`${INPUT} mt-2 normal-case tracking-normal`} value={artifactForType(artifactType)?.title || `${artifactDefinitions[artifactType]?.label || resolvedDepartmentLabel} artifact`} readOnly />
            </label>
          </>
        )}

        <label className="block text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">Draft request
          <textarea required rows="10" className={`${INPUT} mt-2 normal-case tracking-normal`} value={prompt} onChange={event => setPrompt(event.target.value)} placeholder="Describe the draft you need, the evidence to prioritize, known constraints, tone, and gaps the team should keep visible." />
        </label>

        <label className="flex items-start gap-3 rounded-xl border border-amber-900/50 bg-amber-950/20 p-4 text-sm leading-6 text-amber-200">
          <input required type="checkbox" className="mt-1" checked={safe} onChange={event => setSafe(event.target.checked)} />
          <span>I confirm this prompt is safe to send to the engagement-mapped {resolvedDepartmentLabel} model. Restricted artifact versions are never included automatically.</span>
        </label>

        <button
          disabled={busy || !safe || (isWorkItemMode && !title.trim()) || (!isWorkItemMode && !artifactType)}
          className={`${PRIMARY} w-full`}
        >
          {busy ? 'Generating safe preview…' : isWorkItemMode ? 'Preview draft work item' : 'Preview draft artifact'}
        </button>
      </div>
    </form>
    <aside className="space-y-4">
      <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Current context</p>
        <p className="mt-2 font-semibold text-white">{engagement.brands?.name || engagement.name}</p>
        <p className="mt-1 text-sm text-slate-400">{engagement.agency_clients?.name}</p>
      </div>
      <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5 text-sm leading-6 text-slate-400">
        <p className="font-semibold text-white">Human control remains intact</p>
        <p className="mt-2">The human user is recorded as the timeline actor. The model run is separately traceable. Approval remains available only through the normal exact-version manager action.</p>
      </div>
    </aside>
  </div>
}

function ProposalPreview({ result, busy, onConfirm, onReject }) {
  const pending = result.status === 'pending' && new Date(result.expires_at).getTime() > Date.now()
  const accepted = result.status === 'accepted'
  return <div className="mt-5 rounded-xl border border-amber-900/60 bg-amber-950/25 p-4 text-sm text-amber-100">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><p className="font-semibold">{accepted ? 'Official unapproved record created' : 'Preview only'}</p><p className="mt-1 text-xs text-amber-300/80">{pending ? 'Expires ' + new Date(result.expires_at).toLocaleString() : 'Status: ' + result.status}</p></div>
      {pending && <div className="flex gap-2"><button type="button" disabled={busy} onClick={onConfirm} className="rounded-lg bg-emerald-700 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">Confirm official draft</button><button type="button" disabled={busy} onClick={onReject} className="rounded-lg border border-amber-700 px-3 py-2 text-xs disabled:opacity-50">Reject</button></div>}
    </div>
    {result.preview && <pre className="mt-4 max-h-96 overflow-auto whitespace-pre-wrap rounded-lg bg-slate-950/60 p-3 text-xs leading-5 text-slate-200">{JSON.stringify(result.preview, null, 2)}</pre>}
    {result.decision?.replayed && <p className="mt-3 text-xs text-slate-400">This confirmation was already completed; the existing official record was returned.</p>}
    {accepted && <p className="mt-3 text-xs text-emerald-300">Confirmation is not approval, release, publication, deployment, launch, or stage completion.</p>}
  </div>
}
