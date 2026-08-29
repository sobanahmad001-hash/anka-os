import { useCallback, useEffect, useMemo, useState } from 'react'

import { useAuth } from '../context/AuthContext.jsx'
import { artifactApprovals } from '../data/artifactApprovalRepository.js'
import { moveApprover } from '../data/multiApproverPolicies.js'

const THEMES = {
  amber: { accent: 'text-amber-300', border: 'border-amber-500/30', button: 'bg-amber-600 hover:bg-amber-500' },
  emerald: { accent: 'text-emerald-300', border: 'border-emerald-500/30', button: 'bg-emerald-600 hover:bg-emerald-500' },
  blue: { accent: 'text-blue-300', border: 'border-blue-500/30', button: 'bg-blue-600 hover:bg-blue-500' },
}
const SECONDARY = 'rounded-xl border border-slate-700 px-3 py-2 text-xs font-semibold text-slate-200 hover:border-slate-500 disabled:cursor-not-allowed disabled:opacity-40'

function label(approver) {
  if (!approver) return 'Team member'
  const detail = [approver.department_id, String(approver.role || '').replaceAll('_', ' ')].filter(Boolean).join(' · ')
  return `${approver.full_name || approver.email || 'Team member'}${detail ? ` — ${detail}` : ''}`
}

export default function ArtifactApprovalPanel({
  version, approval, theme = 'amber', onSingleApprove, singleApprovalLabel, onChanged,
}) {
  const { user } = useAuth()
  const colors = THEMES[theme] || THEMES.amber
  const [state, setState] = useState({ request: null, signoffs: [], approvers: [] })
  const [policy, setPolicy] = useState('sequential')
  const [selected, setSelected] = useState([])
  const [loading, setLoading] = useState(Boolean(version))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    if (!version?.id) return
    setLoading(true); setError('')
    try { setState(await artifactApprovals.load(version.id)) }
    catch (reason) { setError(reason.message) }
    finally { setLoading(false) }
  }, [version?.id])

  useEffect(() => { load() }, [load])

  const approverById = useMemo(() => new Map(
    state.approvers.map(approver => [approver.user_id, approver]),
  ), [state.approvers])
  const orderedSignoffs = useMemo(() => [...state.signoffs].sort((left, right) => {
    if (state.request?.approval_policy === 'parallel') return label(approverById.get(left.required_approver_id)).localeCompare(label(approverById.get(right.required_approver_id)))
    return Number(left.sequence_position) - Number(right.sequence_position)
  }), [state.signoffs, state.request?.approval_policy, approverById])
  const ownSignoff = state.signoffs.find(item => item.required_approver_id === user?.id)
  const earlierPending = state.request?.approval_policy === 'sequential' && ownSignoff
    ? state.signoffs.some(item => Number(item.sequence_position) < Number(ownSignoff.sequence_position) && !item.signed_off_at)
    : false

  async function run(callback) {
    setBusy(true); setError('')
    try {
      await callback()
      await load()
      await onChanged?.()
    } catch (reason) { setError(reason.message) }
    finally { setBusy(false) }
  }

  function toggle(userId) {
    setSelected(current => current.includes(userId)
      ? current.filter(id => id !== userId)
      : [...current, userId])
  }

  if (!version) return null
  if (approval) return <section className="mt-4 rounded-2xl border border-emerald-500/30 bg-emerald-950/15 p-5"><p className="text-sm font-semibold text-emerald-300">Exact version approved</p><p className="mt-1 text-xs text-slate-500">The immutable approval record for version {version.version_number} is complete.</p></section>

  return <section className={`mt-4 rounded-2xl border ${colors.border} bg-slate-900/70 p-5`}>
    <div><p className={`text-xs font-semibold uppercase tracking-[0.14em] ${colors.accent}`}>Version approval</p><h3 className="mt-1 font-semibold text-white">Version {version.version_number}</h3></div>
    {error && <p className="mt-3 rounded-xl border border-red-900/60 bg-red-950/40 px-3 py-2 text-sm text-red-300">{error}</p>}
    {loading ? <p className="mt-4 text-sm text-slate-500">Loading approval policy…</p> : state.request ? <div className="mt-4 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3"><p className="text-sm text-slate-300"><span className="font-semibold capitalize text-white">{state.request.approval_policy}</span> policy · <span className="capitalize">{state.request.status}</span></p><span className="text-xs text-slate-500">{state.signoffs.filter(item => item.signed_off_at).length}/{state.signoffs.length} signed</span></div>
      <ol className="space-y-2">{orderedSignoffs.map(signoff => <li key={signoff.id} className="flex items-center gap-3 rounded-xl border border-slate-800 bg-slate-950/50 px-3 py-2.5"><span className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-800 text-[10px] font-semibold text-slate-300">{state.request.approval_policy === 'sequential' ? signoff.sequence_position : '•'}</span><span className="min-w-0 flex-1 text-sm text-slate-300">{label(approverById.get(signoff.required_approver_id))}{signoff.required_approver_id === user?.id ? ' (you)' : ''}</span><span className={`text-xs font-semibold ${signoff.signed_off_at ? 'text-emerald-300' : 'text-amber-300'}`}>{signoff.signed_off_at ? 'Signed' : 'Pending'}</span></li>)}</ol>
      {state.request.status === 'pending' && ownSignoff && !ownSignoff.signed_off_at && <button type="button" disabled={busy || earlierPending} onClick={() => run(() => artifactApprovals.signOff(state.request.id))} className={`rounded-xl px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40 ${colors.button}`}>{busy ? 'Signing…' : earlierPending ? 'Waiting for earlier approvers' : 'Sign off this exact version'}</button>}
      {state.request.status === 'pending' && (!ownSignoff || ownSignoff.signed_off_at) && <p className="text-xs text-slate-500">{ownSignoff ? 'Your sign-off is recorded. The remaining named approvers must complete this request.' : 'Only a named required approver can sign this request.'}</p>}
    </div> : <div className="mt-4 space-y-4">
      <div className="flex flex-wrap gap-2">{onSingleApprove && <button type="button" disabled={busy} onClick={() => run(onSingleApprove)} className={SECONDARY}>{singleApprovalLabel || `Approve version ${version.version_number}`}</button>}<p className="self-center text-xs text-slate-500">Or create a governed request for multiple named approvers.</p></div>
      <label className="block text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Policy<select value={policy} onChange={event => setPolicy(event.target.value)} className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm normal-case tracking-normal text-white"><option value="sequential">Sequential — sign in supplied order</option><option value="parallel">Parallel — sign in any order</option></select></label>
      <div><p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Required approvers <span className="font-normal normal-case tracking-normal">({selected.length} selected)</span></p><div className="mt-2 space-y-2">{state.approvers.map(approver => { const chosenIndex = selected.indexOf(approver.user_id); return <div key={approver.user_id} className="flex items-center gap-2 rounded-xl border border-slate-800 bg-slate-950/50 p-3"><label className="flex min-w-0 flex-1 items-center gap-3 text-sm text-slate-300"><input type="checkbox" checked={chosenIndex >= 0} onChange={() => toggle(approver.user_id)} /><span>{label(approver)}{approver.user_id === user?.id ? ' (you)' : ''}</span></label>{policy === 'sequential' && chosenIndex >= 0 && <><span className="text-xs font-semibold text-slate-500">#{chosenIndex + 1}</span><button type="button" aria-label="Move approver earlier" disabled={chosenIndex === 0} className={SECONDARY} onClick={() => setSelected(current => moveApprover(current, approver.user_id, -1))}>↑</button><button type="button" aria-label="Move approver later" disabled={chosenIndex === selected.length - 1} className={SECONDARY} onClick={() => setSelected(current => moveApprover(current, approver.user_id, 1))}>↓</button></>}</div>})}</div></div>
      <button type="button" disabled={busy || selected.length < 2} onClick={() => run(() => artifactApprovals.createRequest(version.id, policy, selected))} className={`rounded-xl px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40 ${colors.button}`}>{busy ? 'Creating request…' : 'Create multi-approver request'}</button>
    </div>}
  </section>
}
