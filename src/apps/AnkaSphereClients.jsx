import { useEffect, useState } from 'react'
import { useAuth } from '../context/AuthContext.jsx'
import { delivery } from '../data/delivery.js'

const INPUT = 'w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-white outline-none focus:border-purple-500'
const ROLES = [['admin', 'Client admin'], ['approver', 'Approver'], ['collaborator', 'Collaborator'], ['viewer', 'Viewer']]
const labelize = value => String(value || '').replaceAll('_', ' ').replace(/\b\w/g, letter => letter.toUpperCase())

export default function AnkaSphereClients() {
  const { user } = useAuth()
  const [clients, setClients] = useState([])
  const [selectedId, setSelectedId] = useState('')
  const [workspace, setWorkspace] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [showNewClient, setShowNewClient] = useState(false)
  const [showInvite, setShowInvite] = useState(false)
  const [clientForm, setClientForm] = useState({ name: '', company: '', email: '', industry: '' })
  const [invite, setInvite] = useState({ fullName: '', email: '', portalRole: 'collaborator', projectIds: [] })

  useEffect(() => { loadClients() }, [])
  useEffect(() => { if (selectedId) loadWorkspace(selectedId) }, [selectedId])

  async function loadClients() {
    setLoading(true)
    setError('')
    try {
      const data = await delivery.listClients()
      setClients(data)
      setSelectedId(current => data.some(client => client.id === current) ? current : data[0]?.id || '')
    } catch (loadError) {
      setError(loadError.message)
    } finally {
      setLoading(false)
    }
  }

  async function loadWorkspace(clientId) {
    setLoading(true)
    try {
      setWorkspace(await delivery.getClientWorkspace(clientId))
    } catch (loadError) {
      setError(loadError.message)
    } finally {
      setLoading(false)
    }
  }

  async function createClient(event) {
    event.preventDefault()
    setSaving(true)
    setError('')
    try {
      const created = await delivery.createClient(clientForm, user.id)
      setClientForm({ name: '', company: '', email: '', industry: '' })
      setShowNewClient(false)
      await loadClients()
      setSelectedId(created.id)
    } catch (createError) {
      setError(createError.message)
    } finally {
      setSaving(false)
    }
  }

  async function inviteContact(event) {
    event.preventDefault()
    setSaving(true)
    setError('')
    setNotice('')
    try {
      const result = await delivery.inviteClientContact({ clientId: selectedId, ...invite })
      setNotice(result.message)
      setInvite({ fullName: '', email: '', portalRole: 'collaborator', projectIds: [] })
      setShowInvite(false)
      await loadWorkspace(selectedId)
    } catch (inviteError) {
      setError(inviteError.message)
    } finally {
      setSaving(false)
    }
  }

  function toggleProject(projectId) {
    setInvite(current => ({
      ...current,
      projectIds: current.projectIds.includes(projectId) ? current.projectIds.filter(id => id !== projectId) : [...current.projectIds, projectId],
    }))
  }

  if (loading && !clients.length) return <div className="flex h-full items-center justify-center bg-slate-950"><div className="h-8 w-8 animate-spin rounded-full border-b-2 border-purple-500" /></div>

  return <div className="min-h-full bg-slate-950 text-white">
    <header className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800 px-6 py-5"><div><p className="text-xs font-semibold uppercase tracking-[0.18em] text-purple-400">Relationship management</p><h1 className="mt-1 text-2xl font-semibold">Clients & Portal Access</h1><p className="mt-1 text-sm text-slate-500">One client record connected to engagements, contacts, and explicit project access.</p></div><button onClick={() => setShowNewClient(true)} className="rounded-xl bg-purple-600 px-4 py-2.5 text-sm font-semibold">+ New client</button></header>
    {error && <div className="mx-6 mt-4 rounded-xl border border-red-900 bg-red-950/50 px-4 py-3 text-sm text-red-300">{error}</div>}
    {notice && <div className="mx-6 mt-4 rounded-xl border border-green-900 bg-green-950/50 px-4 py-3 text-sm text-green-300">{notice}</div>}
    <main className="grid min-h-[calc(100vh-120px)] lg:grid-cols-[300px_1fr]">
      <aside className="border-r border-slate-800 p-4"><p className="mb-3 px-2 text-xs font-semibold uppercase tracking-wider text-slate-500">{clients.length} client organizations</p><div className="space-y-2">{clients.map(client => <button key={client.id} onClick={() => setSelectedId(client.id)} className={`w-full rounded-xl border p-4 text-left ${selectedId === client.id ? 'border-purple-600 bg-purple-950/40' : 'border-slate-800 bg-slate-900/70 hover:border-slate-700'}`}><p className="font-medium">{client.name}</p><p className="mt-1 text-xs text-slate-500">{client.company || client.email || 'Client account'}</p></button>)}</div></aside>
      <section className="p-6">{workspace ? <>
        <div className="flex flex-wrap items-start justify-between gap-4"><div><h2 className="text-xl font-semibold">{workspace.client.name}</h2><p className="mt-1 text-sm text-slate-500">{workspace.client.company || 'No company'} · {workspace.client.email || 'No primary email'}</p></div><button disabled={!workspace.projects.length} onClick={() => setShowInvite(true)} className="rounded-xl border border-purple-700 px-4 py-2 text-sm text-purple-300 disabled:opacity-40">Invite portal contact</button></div>
        <div className="mt-6 grid gap-4 md:grid-cols-3"><Stat label="Engagements" value={workspace.projects.length} /><Stat label="Portal contacts" value={workspace.contacts.length} /><Stat label="Active access grants" value={workspace.access.filter(item => item.status === 'active').length} /></div>
        <div className="mt-7 grid gap-6 xl:grid-cols-2"><Panel title="Engagements">{workspace.projects.length ? workspace.projects.map(project => <Record key={project.id} title={project.name} subtitle={`${labelize(project.engagement_type)} · ${labelize(project.status)}`} badge={project.portal_visible ? 'Portal enabled' : 'Internal'} />) : <Empty text="Create a project for this client from Projects & Retainers." />}</Panel><Panel title="Portal contacts">{workspace.contacts.length ? workspace.contacts.map(contact => { const grants = workspace.access.filter(item => item.client_contact_id === contact.id); return <Record key={contact.id} title={contact.full_name} subtitle={`${contact.email || 'No email'} · ${labelize(contact.portal_role)}`} badge={`${grants.length} project${grants.length === 1 ? '' : 's'}`} /> }) : <Empty text="No portal contacts invited yet." />}</Panel></div>
      </> : <Empty text="Select or create a client." />}</section>
    </main>

    {showNewClient && <Modal title="Create client" onClose={() => setShowNewClient(false)}><form onSubmit={createClient} className="space-y-4"><Field label="Client name"><input required className={INPUT} value={clientForm.name} onChange={event => setClientForm({ ...clientForm, name: event.target.value })} /></Field><Field label="Company"><input className={INPUT} value={clientForm.company} onChange={event => setClientForm({ ...clientForm, company: event.target.value })} /></Field><Field label="Primary email"><input type="email" className={INPUT} value={clientForm.email} onChange={event => setClientForm({ ...clientForm, email: event.target.value })} /></Field><Field label="Industry"><input className={INPUT} value={clientForm.industry} onChange={event => setClientForm({ ...clientForm, industry: event.target.value })} /></Field><button disabled={saving} className="w-full rounded-xl bg-purple-600 px-4 py-2.5 text-sm font-semibold disabled:opacity-50">Create client record</button></form></Modal>}

    {showInvite && <Modal title="Invite client portal contact" onClose={() => setShowInvite(false)}><form onSubmit={inviteContact} className="space-y-4"><Field label="Full name"><input required className={INPUT} value={invite.fullName} onChange={event => setInvite({ ...invite, fullName: event.target.value })} /></Field><Field label="Email"><input required type="email" className={INPUT} value={invite.email} onChange={event => setInvite({ ...invite, email: event.target.value })} /></Field><Field label="Portal role"><select className={INPUT} value={invite.portalRole} onChange={event => setInvite({ ...invite, portalRole: event.target.value })}>{ROLES.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></Field><Field label="Project access"><div className="space-y-2">{workspace?.projects.map(project => <label key={project.id} className="flex items-center gap-3 rounded-xl border border-slate-800 p-3 text-sm"><input type="checkbox" checked={invite.projectIds.includes(project.id)} onChange={() => toggleProject(project.id)} />{project.name}</label>)}</div></Field><button disabled={saving || !invite.projectIds.length} className="w-full rounded-xl bg-purple-600 px-4 py-2.5 text-sm font-semibold disabled:opacity-50">Send secure portal invite</button><p className="text-xs text-slate-500">The contact receives access only to the selected projects. No internal tasks, notes, or unreleased files are exposed.</p></form></Modal>}
  </div>
}

function Panel({ title, children }) { return <section><h3 className="mb-3 text-sm font-semibold">{title}</h3><div className="space-y-3">{children}</div></section> }
function Record({ title, subtitle, badge }) { return <article className="flex items-center justify-between gap-4 rounded-2xl border border-slate-800 bg-slate-900/70 p-4"><div><p className="font-medium">{title}</p><p className="mt-1 text-xs text-slate-500">{subtitle}</p></div><span className="rounded-full bg-slate-800 px-2.5 py-1 text-[11px] text-slate-300">{badge}</span></article> }
function Stat({ label, value }) { return <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5"><p className="text-3xl font-semibold">{value}</p><p className="mt-1 text-xs uppercase tracking-wider text-slate-500">{label}</p></div> }
function Empty({ text }) { return <div className="rounded-2xl border border-dashed border-slate-800 py-14 text-center text-sm text-slate-500">{text}</div> }
function Field({ label, children }) { return <label><span className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-slate-400">{label}</span>{children}</label> }
function Modal({ title, onClose, children }) { return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4"><div className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-2xl border border-slate-700 bg-slate-900 p-6"><div className="mb-5 flex justify-between gap-3"><h2 className="text-lg font-semibold">{title}</h2><button onClick={onClose} className="text-sm text-slate-500 hover:text-white">Close</button></div>{children}</div></div> }
