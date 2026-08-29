import { useEffect, useMemo, useState } from 'react'

import DevelopmentTrackingPanel from '../components/DevelopmentTrackingPanel.jsx'
import WorkItemsPanel from '../components/WorkItemsPanel.jsx'
import { useAuth } from '../context/AuthContext.jsx'
import { OPERATING_DEPARTMENTS } from '../data/operatingSpineRepository.js'
import { operatingSpine } from '../data/operatingSpine.js'

const INPUT = 'w-full rounded-xl border border-white/10 bg-black/20 px-3.5 py-2.5 text-sm text-white outline-none transition focus:border-violet-500/60 focus:ring-2 focus:ring-violet-500/10'
const LABEL = 'mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500'
const EMPTY_ASSET = { asset_kind: 'brand_context', name: '', source_url: '', notes: '' }
const INITIAL_CLIENT = { name: '', legalName: '', primaryEmail: '', websiteUrl: '', industry: '', brandName: '', brandDescription: '' }
const INITIAL_BRAND = { clientId: '', name: '', description: '', websiteUrl: '' }
const INITIAL_ENGAGEMENT = {
  clientId: '', brandId: '', name: '', engagementType: 'project', objective: '',
  leadOwnerId: '', startDate: '', targetDate: '', serviceIds: [], serviceOwners: {},
  existingAssets: [],
}

const labelize = value => String(value || '').replaceAll('_', ' ').replace(/\b\w/g, letter => letter.toUpperCase())

function formatDate(value) {
  if (!value) return 'Not set'
  return new Intl.DateTimeFormat('en', { dateStyle: 'medium' }).format(new Date(`${value}T00:00:00`))
}

export default function OperatingSpine({ initialView = 'engagements' }) {
  const { user } = useAuth()
  const [view, setView] = useState(initialView)
  const [clients, setClients] = useState([])
  const [services, setServices] = useState([])
  const [owners, setOwners] = useState([])
  const [engagements, setEngagements] = useState([])
  const [workspace, setWorkspace] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [modal, setModal] = useState('')
  const [clientForm, setClientForm] = useState(INITIAL_CLIENT)
  const [brandForm, setBrandForm] = useState(INITIAL_BRAND)
  const [engagementForm, setEngagementForm] = useState(INITIAL_ENGAGEMENT)

  useEffect(() => { loadAll() }, [])

  const ownerOptions = useMemo(() => owners.map(owner => ({
    id: owner.user_id,
    label: owner.profile?.full_name || owner.profile?.email || owner.user_id,
    department: owner.department_id || owner.profile?.department,
  })), [owners])

  const selectedClient = clients.find(client => client.id === engagementForm.clientId)
  const availableBrands = selectedClient?.brands || []

  async function loadAll() {
    setLoading(true)
    setError('')
    try {
      const [clientRows, serviceRows, ownerRows, engagementRows] = await Promise.all([
        operatingSpine.listClientsAndBrands(),
        operatingSpine.listServices(),
        operatingSpine.listOwners(),
        operatingSpine.listEngagements(),
      ])
      setClients(clientRows || [])
      setServices(serviceRows || [])
      setOwners(ownerRows || [])
      setEngagements(engagementRows || [])
    } catch (loadError) {
      setError(loadError.message)
    } finally {
      setLoading(false)
    }
  }

  async function createClient(event) {
    event.preventDefault()
    if (!user?.id) return
    setSaving(true); setError(''); setNotice('')
    try {
      const result = await operatingSpine.createClient(clientForm, user.id)
      setClientForm(INITIAL_CLIENT)
      setModal('')
      setNotice(`${result.client.name} and ${result.brand.name} are ready for engagements.`)
      await loadAll()
    } catch (saveError) {
      setError(saveError.message)
    } finally { setSaving(false) }
  }

  async function createBrand(event) {
    event.preventDefault()
    if (!user?.id) return
    setSaving(true); setError(''); setNotice('')
    try {
      const brand = await operatingSpine.createBrand(brandForm, user.id)
      setBrandForm(INITIAL_BRAND)
      setModal('')
      setNotice(`${brand.name} was added to the client registry.`)
      await loadAll()
    } catch (saveError) {
      setError(saveError.message)
    } finally { setSaving(false) }
  }

  function chooseClient(clientId) {
    const client = clients.find(item => item.id === clientId)
    const brandId = client?.brands?.find(brand => brand.is_default)?.id || client?.brands?.[0]?.id || ''
    setEngagementForm(current => ({ ...current, clientId, brandId }))
  }

  function toggleService(serviceId) {
    setEngagementForm(current => {
      const selected = current.serviceIds.includes(serviceId)
      const serviceIds = selected
        ? current.serviceIds.filter(id => id !== serviceId)
        : [...current.serviceIds, serviceId]
      const serviceOwners = { ...current.serviceOwners }
      if (selected) delete serviceOwners[serviceId]
      return { ...current, serviceIds, serviceOwners }
    })
  }

  function setServiceOwner(serviceId, ownerId) {
    setEngagementForm(current => ({
      ...current,
      serviceOwners: { ...current.serviceOwners, [serviceId]: ownerId },
    }))
  }

  function addAsset() {
    setEngagementForm(current => ({ ...current, existingAssets: [...current.existingAssets, { ...EMPTY_ASSET }] }))
  }

  function updateAsset(index, field, value) {
    setEngagementForm(current => ({
      ...current,
      existingAssets: current.existingAssets.map((asset, assetIndex) => assetIndex === index ? { ...asset, [field]: value } : asset),
    }))
  }

  function removeAsset(index) {
    setEngagementForm(current => ({ ...current, existingAssets: current.existingAssets.filter((_, assetIndex) => assetIndex !== index) }))
  }

  async function createEngagement(event) {
    event.preventDefault()
    setSaving(true); setError(''); setNotice('')
    try {
      const engagementId = await operatingSpine.composeEngagement(engagementForm)
      setEngagementForm(INITIAL_ENGAGEMENT)
      setModal('')
      await loadAll()
      await openEngagement(engagementId)
      setNotice('Engagement created with only the selected service stages and required context gates.')
    } catch (saveError) {
      setError(saveError.message)
    } finally { setSaving(false) }
  }

  async function openEngagement(id, { quiet = false } = {}) {
    if (!quiet) setLoading(true)
    setError('')
    try {
      setWorkspace(await operatingSpine.getEngagement(id))
    } catch (loadError) {
      setError(loadError.message)
    } finally { if (!quiet) setLoading(false) }
  }

  if (loading) return <div className="flex h-full items-center justify-center"><div className="h-9 w-9 animate-spin rounded-full border-2 border-slate-800 border-t-violet-500" /></div>

  if (workspace) return <EngagementWorkspace workspace={workspace} owners={ownerOptions} onRefresh={() => openEngagement(workspace.engagement.id, { quiet: true })} onBack={() => setWorkspace(null)} />

  return (
    <div className="h-full overflow-y-auto text-white">
      <div className="mx-auto max-w-[1480px] px-4 py-6 sm:px-6 lg:px-8">
        <header className="flex flex-wrap items-start justify-between gap-5">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-violet-400">Operating Spine</p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight">Client → Brand → Engagement</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">Build the commercial context once, activate only purchased services, and instantiate the smallest valid journey.</p>
          </div>
          <div className="flex gap-2">
            <button onClick={() => setModal('client')} className="rounded-xl border border-white/10 px-4 py-2.5 text-sm font-semibold text-slate-200 hover:bg-white/5">New client</button>
            <button disabled={!clients.length} onClick={() => setModal('engagement')} className="rounded-xl bg-violet-500 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-40">New engagement</button>
          </div>
        </header>

        <div className="mt-7 flex gap-2 border-b border-white/[0.07]">
          {[['engagements', 'Engagements'], ['clients', 'Clients & Brands'], ['services', 'Service Catalogue']].map(([id, label]) => (
            <button key={id} onClick={() => setView(id)} className={`border-b-2 px-4 py-3 text-sm font-semibold ${view === id ? 'border-violet-400 text-white' : 'border-transparent text-slate-500'}`}>{label}</button>
          ))}
        </div>

        {error && <div className="mt-5 rounded-xl border border-red-900/60 bg-red-950/50 px-4 py-3 text-sm text-red-300">{error}</div>}
        {notice && <div className="mt-5 rounded-xl border border-emerald-900/60 bg-emerald-950/40 px-4 py-3 text-sm text-emerald-300">{notice}</div>}

        {view === 'engagements' && <EngagementDirectory engagements={engagements} onOpen={openEngagement} />}
        {view === 'clients' && <ClientRegistry clients={clients} onNewBrand={clientId => { setBrandForm({ ...INITIAL_BRAND, clientId }); setModal('brand') }} />}
        {view === 'services' && <ServiceCatalogue services={services} />}
      </div>

      {modal === 'client' && <Modal title="Create client and first brand" onClose={() => setModal('')}><ClientForm form={clientForm} setForm={setClientForm} onSubmit={createClient} saving={saving} /></Modal>}
      {modal === 'brand' && <Modal title="Add brand" onClose={() => setModal('')}><BrandForm form={brandForm} setForm={setBrandForm} clients={clients} onSubmit={createBrand} saving={saving} /></Modal>}
      {modal === 'engagement' && <Modal title="Compose engagement" onClose={() => setModal('')} wide><EngagementComposer form={engagementForm} setForm={setEngagementForm} clients={clients} brands={availableBrands} services={services} owners={ownerOptions} chooseClient={chooseClient} toggleService={toggleService} setServiceOwner={setServiceOwner} addAsset={addAsset} updateAsset={updateAsset} removeAsset={removeAsset} onSubmit={createEngagement} saving={saving} /></Modal>}
    </div>
  )
}

function EngagementDirectory({ engagements, onOpen }) {
  return <section className="mt-6">
    <div className="grid gap-3 sm:grid-cols-3"><Metric label="Engagements" value={engagements.length} /><Metric label="Active services" value={engagements.reduce((sum, item) => sum + (item.engagement_services?.filter(service => service.status === 'active').length || 0), 0)} /><Metric label="Partial journeys supported" value="Yes" /></div>
    <div className="mt-6 grid gap-4 xl:grid-cols-2">{engagements.map(engagement => <button key={engagement.id} onClick={() => onOpen(engagement.id)} className="rounded-2xl border border-white/[0.07] bg-[#0e111a]/80 p-5 text-left transition hover:border-violet-500/30"><div className="flex items-start justify-between gap-4"><div><p className="text-xs text-violet-400">{engagement.agency_clients?.name} · {engagement.brands?.name}</p><h2 className="mt-1 text-lg font-semibold">{engagement.name}</h2></div><Badge>{labelize(engagement.status)}</Badge></div><p className="mt-3 line-clamp-2 text-sm text-slate-500">{engagement.objective || 'No objective recorded yet.'}</p><div className="mt-4 flex flex-wrap gap-2">{engagement.engagement_services?.map(item => <span key={item.id} className="rounded-full bg-white/[0.05] px-2.5 py-1 text-[11px] text-slate-300">{item.service_catalog?.name}</span>)}</div><p className="mt-4 text-xs text-slate-600">Target {formatDate(engagement.target_date)}</p></button>)}</div>
    {!engagements.length && <Empty text="No canonical engagements yet. Create one by selecting a client, brand, and any combination of services." />}
  </section>
}

function ClientRegistry({ clients, onNewBrand }) {
  return <section className="mt-6 grid gap-4 xl:grid-cols-2">{clients.map(client => <article key={client.id} className="rounded-2xl border border-white/[0.07] bg-[#0e111a]/80 p-5"><div className="flex items-start justify-between gap-3"><div><p className="text-xs text-violet-400">Client</p><h2 className="mt-1 text-lg font-semibold">{client.name}</h2><p className="mt-1 text-sm text-slate-500">{client.legal_name || client.industry || 'No additional details'}</p></div><button onClick={() => onNewBrand(client.id)} className="rounded-lg border border-white/10 px-3 py-2 text-xs font-semibold">Add brand</button></div><div className="mt-5 space-y-2">{client.brands?.map(brand => <div key={brand.id} className="flex items-center justify-between rounded-xl border border-white/[0.06] bg-white/[0.025] p-3"><div><p className="text-sm font-medium">{brand.name}</p><p className="mt-1 text-xs text-slate-600">{brand.description || 'Reusable brand context'}</p></div>{brand.is_default && <Badge>Default</Badge>}</div>)}</div></article>)}</section>
}

function ServiceCatalogue({ services }) {
  return <section className="mt-6 grid gap-5 xl:grid-cols-2">{OPERATING_DEPARTMENTS.map(department => <article key={department.id} className="rounded-2xl border border-white/[0.07] bg-[#0e111a]/80 p-5"><p className="text-xs font-semibold uppercase tracking-[0.16em] text-violet-400">{department.name}</p><div className="mt-4 grid gap-2">{services.filter(service => service.department_id === department.id).map(service => <div key={service.id} className="rounded-xl border border-white/[0.06] bg-white/[0.025] p-3"><p className="text-sm font-semibold">{service.name}</p><p className="mt-1 text-xs leading-5 text-slate-500">{service.description}</p></div>)}</div></article>)}</section>
}

function EngagementWorkspace({ workspace, owners, onRefresh, onBack }) {
  const [tab, setTab] = useState('overview')
  const stageById = new Map(workspace.stages.map(stage => [stage.id, stage]))
  const hasDevelopment = workspace.services.some(item => item.status === 'active' && item.service_catalog?.department_id === 'development')

  return <div className="h-full overflow-y-auto text-white"><div className="mx-auto max-w-[1480px] px-4 py-6 sm:px-6 lg:px-8">
    <button onClick={onBack} className="text-sm text-slate-500 hover:text-white">← Back to engagements</button>
    <header className="mt-5 flex flex-wrap items-start justify-between gap-5"><div><p className="text-xs text-violet-400">{workspace.engagement.agency_clients?.name} · {workspace.engagement.brands?.name}</p><h1 className="mt-1 text-3xl font-semibold">{workspace.engagement.name}</h1><p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">{workspace.engagement.objective || 'No objective recorded.'}</p></div><Badge>{labelize(workspace.engagement.status)}</Badge></header>
    <div className="mt-7 grid gap-3 sm:grid-cols-4"><Metric label="Services" value={workspace.services.length} /><Metric label="Journey stages" value={workspace.stages.length} /><Metric label="Dependencies" value={workspace.dependencies.length} /><Metric label="Scoped connectors" value={workspace.connectors.length} /></div>
    <nav className="mt-7 flex gap-2 border-b border-white/[0.07]"><button onClick={() => setTab('overview')} className={`border-b-2 px-4 py-3 text-sm font-semibold ${tab === 'overview' ? 'border-violet-400 text-white' : 'border-transparent text-slate-500'}`}>Overview</button><button onClick={() => setTab('work')} className={`border-b-2 px-4 py-3 text-sm font-semibold ${tab === 'work' ? 'border-violet-400 text-white' : 'border-transparent text-slate-500'}`}>Work</button>{hasDevelopment && <button onClick={() => setTab('development')} className={`border-b-2 px-4 py-3 text-sm font-semibold ${tab === 'development' ? 'border-blue-400 text-blue-300' : 'border-transparent text-slate-500'}`}>Development</button>}</nav>
    {tab === 'work' ? <WorkItemsPanel workspace={workspace} owners={owners} onRefresh={onRefresh} /> : tab === 'development' && hasDevelopment ? <DevelopmentTrackingPanel workspace={workspace} onRefresh={onRefresh} /> : <div className="mt-7 grid gap-6 xl:grid-cols-[1.4fr_1fr]">
      <section className="rounded-2xl border border-white/[0.07] bg-[#0e111a]/80 p-5"><h2 className="font-semibold">Instantiated journey</h2><p className="mt-1 text-xs text-slate-500">Only selected service stages and unresolved short prerequisites appear.</p><div className="mt-5 space-y-3">{workspace.stages.map((stage, index) => { const blockers = workspace.dependencies.filter(item => item.stage_instance_id === stage.id).map(item => stageById.get(item.depends_on_stage_instance_id)?.name).filter(Boolean); return <div key={stage.id} className="rounded-xl border border-white/[0.07] bg-white/[0.025] p-4"><div className="flex items-center gap-3"><span className="flex h-7 w-7 items-center justify-center rounded-full bg-violet-500/15 text-xs font-semibold text-violet-300">{index + 1}</span><div className="flex-1"><div className="flex flex-wrap items-center gap-2"><p className="font-medium">{stage.name}</p>{stage.stage_kind === 'short_prerequisite' && <Badge>Short prerequisite</Badge>}</div><p className="mt-1 text-xs text-slate-500">{labelize(stage.accountable_department_id)} · {labelize(stage.status)}</p>{blockers.length > 0 && <p className="mt-2 text-xs text-amber-300">Depends on: {blockers.join(', ')}</p>}</div></div></div> })}</div></section>
      <div className="space-y-6"><Panel title="Activated services">{workspace.services.map(item => <Record key={item.id} title={item.service_catalog?.name} note={`${labelize(item.service_catalog?.department_id)} · ${labelize(item.status)}`} />)}</Panel><Panel title="Prerequisite record">{workspace.prerequisites.length ? workspace.prerequisites.map(item => <Record key={item.id} title={labelize(item.prerequisite_key)} note={`${labelize(item.satisfaction_method)} · ${labelize(item.status)}`} />) : <p className="text-sm text-slate-500">No additional prerequisite was required.</p>}</Panel><Panel title="Existing assets">{workspace.assets.length ? workspace.assets.map(item => <Record key={item.id} title={item.name} note={labelize(item.asset_kind)} />) : <p className="text-sm text-slate-500">No assets supplied.</p>}</Panel><Panel title="Audit trail">{workspace.events.map(item => <Record key={item.id} title={labelize(item.event_type)} note={new Date(item.occurred_at).toLocaleString()} />)}</Panel></div>
    </div>}
  </div></div>
}

function ClientForm({ form, setForm, onSubmit, saving }) { return <form onSubmit={onSubmit} className="grid gap-4 sm:grid-cols-2"><Field label="Client name"><input required className={INPUT} value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></Field><Field label="Legal name"><input className={INPUT} value={form.legalName} onChange={e => setForm({ ...form, legalName: e.target.value })} /></Field><Field label="Primary email"><input type="email" className={INPUT} value={form.primaryEmail} onChange={e => setForm({ ...form, primaryEmail: e.target.value })} /></Field><Field label="Website"><input type="url" className={INPUT} value={form.websiteUrl} onChange={e => setForm({ ...form, websiteUrl: e.target.value })} /></Field><Field label="Industry"><input className={INPUT} value={form.industry} onChange={e => setForm({ ...form, industry: e.target.value })} /></Field><Field label="First brand"><input required className={INPUT} value={form.brandName} onChange={e => setForm({ ...form, brandName: e.target.value })} /></Field><div className="sm:col-span-2"><Field label="Brand description"><textarea rows="3" className={INPUT} value={form.brandDescription} onChange={e => setForm({ ...form, brandDescription: e.target.value })} /></Field></div><button disabled={saving} className="sm:col-span-2 rounded-xl bg-violet-500 px-4 py-2.5 text-sm font-semibold disabled:opacity-50">Create client and brand</button></form> }

function BrandForm({ form, setForm, clients, onSubmit, saving }) { return <form onSubmit={onSubmit} className="space-y-4"><Field label="Client"><select required className={INPUT} value={form.clientId} onChange={e => setForm({ ...form, clientId: e.target.value })}><option value="">Select client</option>{clients.map(client => <option key={client.id} value={client.id}>{client.name}</option>)}</select></Field><Field label="Brand name"><input required className={INPUT} value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></Field><Field label="Website"><input type="url" className={INPUT} value={form.websiteUrl} onChange={e => setForm({ ...form, websiteUrl: e.target.value })} /></Field><Field label="Description"><textarea rows="3" className={INPUT} value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} /></Field><button disabled={saving} className="w-full rounded-xl bg-violet-500 px-4 py-2.5 text-sm font-semibold disabled:opacity-50">Add brand</button></form> }

function EngagementComposer({ form, setForm, clients, brands, services, owners, chooseClient, toggleService, setServiceOwner, addAsset, updateAsset, removeAsset, onSubmit, saving }) {
  return <form onSubmit={onSubmit} className="space-y-7"><section className="grid gap-4 sm:grid-cols-2"><Field label="Client"><select required className={INPUT} value={form.clientId} onChange={e => chooseClient(e.target.value)}><option value="">Select client</option>{clients.map(client => <option key={client.id} value={client.id}>{client.name}</option>)}</select></Field><Field label="Brand"><select required className={INPUT} value={form.brandId} onChange={e => setForm({ ...form, brandId: e.target.value })}><option value="">Select brand</option>{brands.map(brand => <option key={brand.id} value={brand.id}>{brand.name}</option>)}</select></Field><Field label="Engagement name"><input required className={INPUT} value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></Field><Field label="Commercial type"><select className={INPUT} value={form.engagementType} onChange={e => setForm({ ...form, engagementType: e.target.value })}><option value="project">Project</option><option value="retainer">Retainer</option></select></Field><Field label="Lead owner"><select className={INPUT} value={form.leadOwnerId} onChange={e => setForm({ ...form, leadOwnerId: e.target.value })}><option value="">Use current user</option>{owners.map(owner => <option key={owner.id} value={owner.id}>{owner.label}</option>)}</select></Field><div className="grid grid-cols-2 gap-3"><Field label="Start date"><input type="date" className={INPUT} value={form.startDate} onChange={e => setForm({ ...form, startDate: e.target.value })} /></Field><Field label="Target date"><input type="date" className={INPUT} value={form.targetDate} onChange={e => setForm({ ...form, targetDate: e.target.value })} /></Field></div><div className="sm:col-span-2"><Field label="Objective"><textarea rows="3" className={INPUT} value={form.objective} onChange={e => setForm({ ...form, objective: e.target.value })} /></Field></div></section><section><div className="flex items-end justify-between"><div><h3 className="font-semibold">Purchased services</h3><p className="mt-1 text-xs text-slate-500">Choose any combination. Unselected departments and stages are not created.</p></div><Badge>{form.serviceIds.length} selected</Badge></div><div className="mt-4 grid gap-4 lg:grid-cols-2">{OPERATING_DEPARTMENTS.map(department => <div key={department.id} className="rounded-2xl border border-white/[0.07] p-4"><p className="text-xs font-semibold uppercase tracking-wider text-violet-400">{department.name}</p><div className="mt-3 space-y-2">{services.filter(service => service.department_id === department.id).map(service => { const selected = form.serviceIds.includes(service.id); return <div key={service.id} className={`rounded-xl border p-3 ${selected ? 'border-violet-500/35 bg-violet-500/10' : 'border-white/[0.06] bg-white/[0.02]'}`}><label className="flex cursor-pointer items-start gap-3"><input type="checkbox" className="mt-1" checked={selected} onChange={() => toggleService(service.id)} /><span><span className="block text-sm font-medium">{service.name}</span><span className="mt-1 block text-xs leading-5 text-slate-500">{service.description}</span></span></label>{selected && <select aria-label={`Owner for ${service.name}`} className={`${INPUT} mt-3`} value={form.serviceOwners[service.id] || ''} onChange={e => setServiceOwner(service.id, e.target.value)}><option value="">Use engagement lead</option>{owners.filter(owner => !owner.department || owner.department === department.id).map(owner => <option key={owner.id} value={owner.id}>{owner.label}</option>)}</select>}</div>})}</div></div>)}</div></section><section><div className="flex items-end justify-between"><div><h3 className="font-semibold">Existing assets</h3><p className="mt-1 text-xs text-slate-500">Supplied context can satisfy prerequisites without adding a full upstream cycle.</p></div><button type="button" onClick={addAsset} className="rounded-lg border border-white/10 px-3 py-2 text-xs font-semibold">Add asset</button></div><div className="mt-3 space-y-3">{form.existingAssets.map((asset, index) => <div key={index} className="grid gap-3 rounded-xl border border-white/[0.07] p-3 sm:grid-cols-[1fr_1fr_1.2fr_auto]"><select className={INPUT} value={asset.asset_kind} onChange={e => updateAsset(index, 'asset_kind', e.target.value)}><option value="brand_context">Brand context</option><option value="discovery_statement">Discovery statement</option><option value="audience_context">Audience context</option><option value="approved_content">Approved content</option><option value="approved_design">Approved design</option><option value="technical_brief">Technical brief</option><option value="campaign_brief">Campaign brief</option></select><input required placeholder="Asset name" className={INPUT} value={asset.name} onChange={e => updateAsset(index, 'name', e.target.value)} /><input type="url" placeholder="Optional link" className={INPUT} value={asset.source_url} onChange={e => updateAsset(index, 'source_url', e.target.value)} /><button type="button" onClick={() => removeAsset(index)} className="px-2 text-xs text-red-300">Remove</button></div>)}</div></section><button disabled={saving || !form.clientId || !form.brandId || !form.serviceIds.length} className="w-full rounded-xl bg-violet-500 px-4 py-3 text-sm font-semibold disabled:opacity-40">Create engagement and instantiate journey</button></form>
}

function Modal({ title, onClose, children, wide = false }) { return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"><div className={`max-h-[92vh] w-full overflow-y-auto rounded-2xl border border-white/10 bg-[#111520] p-6 shadow-2xl ${wide ? 'max-w-6xl' : 'max-w-2xl'}`}><div className="mb-6 flex items-center justify-between gap-4"><h2 className="text-xl font-semibold">{title}</h2><button type="button" onClick={onClose} className="text-sm text-slate-500 hover:text-white">Close</button></div>{children}</div></div> }
function Field({ label, children }) { return <label><span className={LABEL}>{label}</span>{children}</label> }
function Metric({ label, value }) { return <div className="rounded-2xl border border-white/[0.07] bg-[#0e111a]/80 p-5"><p className="text-2xl font-semibold">{value}</p><p className="mt-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-600">{label}</p></div> }
function Panel({ title, children }) { return <section className="rounded-2xl border border-white/[0.07] bg-[#0e111a]/80 p-5"><h2 className="font-semibold">{title}</h2><div className="mt-4 space-y-2">{children}</div></section> }
function Record({ title, note }) { return <div className="rounded-xl border border-white/[0.06] bg-white/[0.025] p-3"><p className="text-sm font-medium">{title}</p><p className="mt-1 text-xs text-slate-600">{note}</p></div> }
function Badge({ children }) { return <span className="inline-flex rounded-full bg-violet-500/10 px-2.5 py-1 text-[11px] font-semibold text-violet-300">{children}</span> }
function Empty({ text }) { return <div className="mt-6 rounded-2xl border border-dashed border-white/10 py-16 text-center text-sm text-slate-500">{text}</div> }
