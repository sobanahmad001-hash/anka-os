import { useState } from 'react'
import { delivery } from '../data/delivery.js'

const ROLES = [['viewer', 'Viewer'], ['collaborator', 'Collaborator'], ['approver', 'Approver'], ['admin', 'Admin']]
const ACTIVE = new Set(['completed', 'cancelled', 'archived'])
const label = (value) => value ? value.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase()) : 'Unknown'

export default function ClientPeopleAccess({ rows, projects, clientId, organizationId, canInvite, onInvited }) {
  const [open, setOpen] = useState(false)
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [portalRole, setPortalRole] = useState('collaborator')
  const [projectIds, setProjectIds] = useState([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const eligibleProjects = projects.filter((project) => !ACTIVE.has(project.status))
  const toggleProject = (id) => setProjectIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id])
  const submit = async (event) => {
    event.preventDefault()
    if (busy || !canInvite || !eligibleProjects.some((project) => projectIds.includes(project.id))) return
    setBusy(true)
    setError('')
    setSuccess('')
    try {
      const result = await delivery.inviteClientContact({ organizationId, clientId, fullName: fullName.trim(), email: email.trim(), portalRole, projectIds })
      setSuccess(result.message || 'Portal invitation sent.')
      setOpen(false)
      setFullName('')
      setEmail('')
      setProjectIds([])
      await onInvited()
    } catch (cause) {
      setError(cause.message || 'Unable to send the invitation.')
    } finally {
      setBusy(false)
    }
  }
  return <div className="space-y-5">
    <section className="rounded-2xl border border-[var(--anka-line)] bg-[var(--anka-surface)] p-5"><h2 className="font-semibold">People & project access</h2><p className="mt-1 text-xs text-[var(--anka-muted)]">Existing client contacts and their project access.</p><div className="mt-4 space-y-3">{rows.length ? rows.map((contact) => <div key={contact.id} className="rounded-xl border border-[var(--anka-line)] bg-[var(--anka-canvas)] p-4"><div className="flex items-start justify-between gap-3"><div><p className="font-medium">{contact.full_name}</p><p className="mt-1 text-xs text-[var(--anka-muted)]">{contact.email || 'No email'} · {label(contact.portal_role)}</p></div><span className="rounded-full border border-[var(--anka-line)] px-2 py-1 text-[11px]">{label(contact.status)}</span></div><div className="mt-3 flex flex-wrap gap-2">{contact.access.length ? contact.access.map((grant) => <span key={grant.id} className="rounded-full border border-[var(--anka-violet)] bg-[var(--anka-violet-soft)] px-2 py-1 text-[11px] text-[var(--anka-violet)]">{grant.projectName} · {label(grant.access_role)} · {label(grant.status)}</span>) : <span className="text-xs text-[var(--anka-muted)]">No project access grants.</span>}</div></div>) : <p className="text-sm text-[var(--anka-muted)]">No client contacts recorded.</p>}</div></section>
    {canInvite && <section className="rounded-2xl border border-[var(--anka-line)] bg-[var(--anka-surface)] p-5"><h2 className="font-semibold">Invite a client contact</h2><p className="mt-1 text-xs text-[var(--anka-muted)]">Sending creates a client portal account and emails an invitation. Access is limited to the selected projects.</p>
      {!open ? <button type="button" onClick={() => { setError(''); setSuccess(''); setOpen(true) }} disabled={!eligibleProjects.length} className="mt-4 rounded-xl border border-[var(--anka-violet)] bg-[var(--anka-violet)] px-4 py-2 text-sm font-medium text-[var(--anka-on-violet)] disabled:opacity-50">Prepare invitation</button> : <form onSubmit={submit} className="mt-4 space-y-4">
        <div className="grid gap-4 sm:grid-cols-2"><label className="block text-sm">Full name<input required maxLength={160} value={fullName} onChange={(event) => setFullName(event.target.value)} className="mt-1 w-full rounded-lg border border-[var(--anka-line)] bg-[var(--anka-canvas)] p-2 text-[var(--anka-ink)]" /></label><label className="block text-sm">Email<input required type="email" value={email} onChange={(event) => setEmail(event.target.value)} className="mt-1 w-full rounded-lg border border-[var(--anka-line)] bg-[var(--anka-canvas)] p-2 text-[var(--anka-ink)]" /></label></div>
        <label className="block text-sm">Portal role<select value={portalRole} onChange={(event) => setPortalRole(event.target.value)} className="mt-1 w-full rounded-lg border border-[var(--anka-line)] bg-[var(--anka-canvas)] p-2 text-[var(--anka-ink)]">{ROLES.map(([value, title]) => <option key={value} value={value}>{title}</option>)}</select></label>
        <fieldset><legend className="text-sm">Project access (choose at least one)</legend><div className="mt-2 space-y-2">{eligibleProjects.map((project) => <label key={project.id} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={projectIds.includes(project.id)} onChange={() => toggleProject(project.id)} />{project.name}</label>)}</div></fieldset>
        <div className="flex gap-2"><button type="submit" disabled={busy || !projectIds.length} className="rounded-xl bg-[var(--anka-violet)] px-4 py-2 text-sm font-medium text-[var(--anka-on-violet)] disabled:opacity-50">{busy ? 'Sending…' : 'Send portal invitation'}</button><button type="button" disabled={busy} onClick={() => { setOpen(false); setError('') }} className="rounded-xl border border-[var(--anka-line)] px-4 py-2 text-sm">Cancel</button></div>
      </form>}
      {error && <p role="alert" className="mt-3 text-sm text-[var(--anka-danger)]">{error}</p>}{success && <p role="status" className="mt-3 text-sm text-[var(--anka-success)]">{success}</p>}
    </section>}
  </div>
}
