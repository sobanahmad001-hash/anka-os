import { useCallback, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'

const words = value => value ? String(value).replaceAll('_', ' ') : 'Not recorded'
const styles = `.people-access-profile{box-sizing:border-box;width:100%;max-width:1000px;margin:auto;padding:20px;color:var(--anka-ink);background:var(--anka-canvas);font:15px/1.5 system-ui}.people-access-profile *{box-sizing:border-box;min-width:0;overflow-wrap:anywhere}.people-access-profile h2{font-size:22px;margin:0}.people-access-profile h3{font-size:17px;margin:0 0 10px}.people-access-profile p{margin:8px 0}.people-access-profile .pap-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,300px),1fr));gap:14px}.people-access-profile section{padding:16px;border:1px solid var(--anka-line);border-radius:12px;background:var(--anka-surface);margin-top:14px}.people-access-profile label{display:block;margin:16px 0}.people-access-profile select,.people-access-profile button{font:inherit;padding:9px;border:1px solid var(--anka-line);border-radius:6px;background:var(--anka-surface);max-width:100%;color:inherit}.people-access-profile select{display:block;width:100%;margin-top:5px}.people-access-profile button{cursor:pointer}.people-access-profile :focus-visible{outline:3px solid var(--anka-focus);outline-offset:3px}.people-access-profile dl{margin:0}.people-access-profile dt{font-weight:600}.people-access-profile dd{margin:0 0 10px}.people-access-profile ul{padding-left:20px}.people-access-profile small{display:block;color:var(--anka-muted)}.people-access-profile [role=alert]{border-left:4px solid var(--anka-danger);padding:10px}.people-access-profile .pap-note{background:var(--anka-violet-soft);padding:12px;border-radius:8px}.people-access-profile .pap-access{list-style:none;padding:0}.people-access-profile .pap-access li{border-top:1px solid var(--anka-line);padding:10px 0}.people-access-profile header{display:flex;flex-wrap:wrap;gap:10px;align-items:center;justify-content:space-between}@media(max-width:480px){.people-access-profile{padding:12px}.people-access-profile section{padding:12px}}`

// No global auth/client imports. Host supplies a stable, approved read adapter.
export default function PeopleAccessProfile({ organizationId, organizationName, repository, requestSignal, initialUserId = '' }) {
  const [revision, setRevision] = useState(0)
  // A keyed subtree synchronously discards previous-org data before any effects.
  return <PeopleProfileScope key={organizationId} {...{ organizationId, organizationName, repository, requestSignal, revision, initialUserId }} onReload={() => setRevision(n => n + 1)} />
}

function PeopleProfileScope({ organizationId, organizationName, repository, requestSignal, revision, initialUserId, onReload }) {
  const subscribe = useCallback(listener => {
    requestSignal?.addEventListener('abort', listener)
    return () => requestSignal?.removeEventListener('abort', listener)
  }, [requestSignal])
  const aborted = useSyncExternalStore(subscribe, () => Boolean(requestSignal?.aborted), () => Boolean(requestSignal?.aborted))
  const [members, setMembers] = useState([]), [userId, setUserId] = useState(initialUserId)
  const [data, setData] = useState(null), [loading, setLoading] = useState(true), [error, setError] = useState('')
  const [history, setHistory] = useState(null), [historyBusy, setHistoryBusy] = useState(false), [historyError, setHistoryError] = useState('')
  const historyController = useRef(null), target = useRef(userId)
  target.current = userId
  useLayoutEffect(() => {
    const controller = new AbortController(), abort = () => {
      controller.abort(); historyController.current?.abort(); target.current = ''
      setData(null); setMembers([]); setUserId(''); setHistory(null); setHistoryBusy(false)
      setLoading(false); setError(''); setHistoryError('')
    }
    requestSignal?.addEventListener('abort', abort, { once: true })
    setLoading(true); setData(null); setHistory(null); setHistoryBusy(false); setError(''); setHistoryError('')
    if (requestSignal?.aborted) { abort(); return () => requestSignal.removeEventListener('abort', abort) }
    ;(async () => {
      const rows = await repository.list(organizationId, { signal: controller.signal })
      if (controller.signal.aborted) return
      setMembers(rows)
      if (userId) {
        if (!rows.some(row => row.id === userId)) throw Error('Selected team membership is no longer available')
        const next = await repository.read(organizationId, userId, { signal: controller.signal })
        if (next.organizationId !== organizationId || next.userId !== userId) throw Error('Profile scope changed')
        if (!controller.signal.aborted) setData(next)
      }
    })().catch(reason => { if (!controller.signal.aborted) { setMembers([]); setError(reason.message || 'People access read unavailable') } })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => { controller.abort(); historyController.current?.abort(); requestSignal?.removeEventListener('abort', abort) }
  }, [organizationId, userId, repository, requestSignal, revision])
  async function loadHistory() {
    if (historyBusy || !data || aborted || requestSignal?.aborted) return
    const controller = new AbortController(), abort = () => controller.abort(), selected = userId
    historyController.current = controller
    requestSignal?.addEventListener('abort', abort, { once: true })
    setHistoryBusy(true); setHistoryError('')
    try {
      const rows = await repository.history(organizationId, selected, { signal: controller.signal })
      if (!controller.signal.aborted && target.current === selected) setHistory(rows)
    } catch (reason) { if (!controller.signal.aborted && target.current === selected) setHistoryError(reason.message || 'Retained history unavailable') }
    finally { requestSignal?.removeEventListener('abort', abort); if (!controller.signal.aborted && target.current === selected) setHistoryBusy(false) }
  }
  return <article className="people-access-profile" aria-label="People and access profile">
    <style>{styles}</style><header><div><h2>People & access</h2><p>{organizationName || 'Selected organization'}</p></div><button type="button" onClick={() => { if (!requestSignal?.aborted) onReload() }} disabled={loading || aborted}>Refresh</button></header>
    <p className="pap-note">View identity, organization membership and access details. No changes can be made here.</p>
    {aborted && <p role="alert">Organization access changed. Reopen this profile in the current scope.</p>}
    {error && <p role="alert">{error}</p>}
    {loading && <p role="status">Loading people…</p>}
    <label>Team member<select aria-label="People access team member" value={userId} disabled={loading || aborted} onChange={event => { if (requestSignal?.aborted) return; setData(null); setHistory(null); setHistoryBusy(false); setHistoryError(''); setError(''); setUserId(event.target.value) }}><option value="">Select a person</option>{members.map(row => <option key={row.id} value={row.id}>{row.name} · {words(row.status)}</option>)}</select></label>
    {!aborted && !loading && !members.length && !error && <p>No team members available. Client contacts are not included in this view.</p>}
    {data && !loading && !aborted && <>
      <div className="pap-grid"><section aria-label="Identity and organization access"><h3>{data.name}</h3><dl><dt>Profile availability</dt><dd>{words(data.profile.state)}{data.profile.message && ` · ${data.profile.message}`}</dd><dt>Organization role</dt><dd>{words(data.membership.role)}</dd><dt>Organization membership</dt><dd>{words(data.membership.status)} · {data.membership.kind}</dd><dt>Global profile role</dt><dd>{data.profile.state === 'available' ? words(data.profile.role) : 'Unknown'}</dd><dt>Sign-in and invitation status</dt><dd>Not evaluated. Organization membership status does not establish sign-in or invitation acceptance.</dd></dl>{data.discrepancies.map(text => <p key={text} className="pap-note">{text}</p>)}</section>
      <section aria-label="Department affiliations"><h3>Departments & designation</h3><p>Primary department: {words(data.membership.primaryDepartment)}</p><small>Additional departments do not automatically grant approval rights.</small><ul>{data.departments.map(row => <li key={row.id}>{words(row.department)} · additional · {words(row.status)}<small>Recorded by: {words(row.source)}{row.revokedAt && ` · revoked ${row.revokedAt}`}</small></li>)}</ul>{!data.departments.length && <p>No additional departments recorded.</p>}<h3>Contributor designation</h3>{data.designations.map(row => <p key={row.id}>{words(row.label)} · {words(row.status)}<small>Label only; grants no permissions · recorded by: {words(row.source)}</small></p>)}{!data.designations.length && <p>No designation recorded.</p>}</section></div>
      <section aria-label="Project relationships"><h3>Project relationships</h3><p>{data.relationships.teamVisibility}</p><ul>{data.managerBindings.map(row => <li key={row.id}>{row.name} · Project manager · {words(row.status)}<small>Recorded by: {words(row.source)} · Managing a project does not automatically grant release rights.</small></li>)}</ul>{!data.managerBindings.length && <p>No project-manager relationships recorded.</p>}<p>{data.relationships.ownership}</p><p>{data.relationships.clientGrants}</p></section>
      <section aria-label="Effective access summary"><h3>Effective access</h3><ul className="pap-access">{data.effective.map(row => <li key={row.action}><strong>{row.action}: {row.state}</strong><small>{row.reason}</small></li>)}</ul><small>Read at {data.observedAt}. Access has not been checked on this person’s behalf.</small></section>
      <section aria-label="Retained access history"><h3>Retained history</h3><p>The records above include removed relationships. You can also view previous organization deactivations.</p><button type="button" disabled={historyBusy} onClick={loadHistory}>{historyBusy ? 'Reading history…' : 'Read retained deactivation history'}</button>{historyError && <p role="alert">{historyError}</p>}{history && (history.length ? <ul>{history.map(row => <li key={row.id}>{row.occurredAt || 'Date not available'} · {row.reassignmentCount ?? 'Unknown'} assignments recorded for review</li>)}</ul> : <p>No previous deactivations recorded.</p>)}</section>
    </>}
  </article>
}
