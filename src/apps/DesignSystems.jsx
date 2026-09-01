import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import ArtifactApprovalPanel from '../components/ArtifactApprovalPanel.jsx'
import ArtifactRelationsPanel from '../components/ArtifactRelationsPanel.jsx'
import VersionProofingPanel from '../components/VersionProofingPanel.jsx'
import DepartmentChat from '../components/DepartmentChat.jsx'
import {
  cloneDesignSystemContent,
  EMPTY_DESIGN_SYSTEM,
  latestVersionFor,
  releasedVersionsFor,
} from '../data/designSystems.js'
import { designSystems } from '../data/designSystemsRepository.js'

const INPUT = 'w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-white outline-none focus:border-pink-500'
const SECONDARY = 'rounded-xl border border-slate-700 px-3 py-2 text-xs font-semibold text-slate-300 hover:border-pink-500 hover:text-white disabled:opacity-40'
const EMPTY_FORM = { title: '', engagement_service_id: '', change_summary: '', data_classification: 'internal', content: cloneDesignSystemContent() }
const DESIGN_CHAT_ARTIFACTS = Object.freeze({ design_system: { label: 'Design system' } })

function related(value) {
  return Array.isArray(value) ? value[0] : value
}

export default function DesignSystems() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [workspace, setWorkspace] = useState({ services: [], artifacts: [], versions: [], approvals: [], stages: [] })
  const [chatServiceId, setChatServiceId] = useState('')
  const [selectedId, setSelectedId] = useState(searchParams.get('artifact') || '')
  const [versionId, setVersionId] = useState('')
  const [form, setForm] = useState(EMPTY_FORM)
  const [search, setSearch] = useState('')
  const [releasedOnly, setReleasedOnly] = useState(true)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  const load = useCallback(async (preferredId = '') => {
    setLoading(true); setError('')
    try {
      const result = await designSystems.loadLibrary()
      setWorkspace(result)
      setChatServiceId(current => result.services.some(service => service.id === current) ? current : result.services[0]?.id || '')
      const requested = preferredId || searchParams.get('artifact') || selectedId
      const nextId = result.artifacts.some(item => item.id === requested) ? requested : result.artifacts[0]?.id || ''
      setSelectedId(nextId)
    } catch (reason) { setError(reason.message) }
    finally { setLoading(false) }
  }, [searchParams, selectedId])

  useEffect(() => { load() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const selectedArtifact = workspace.artifacts.find(item => item.id === selectedId) || null
  const versions = useMemo(() => workspace.versions.filter(item => item.artifact_id === selectedId)
    .sort((left, right) => right.version_number - left.version_number), [workspace.versions, selectedId])
  const releasedVersions = useMemo(() => releasedVersionsFor(selectedId, workspace.versions, workspace.approvals),
    [selectedId, workspace.versions, workspace.approvals])
  const viewedVersion = versions.find(item => item.id === versionId) || releasedVersions[0] || versions[0] || null
  const latestVersion = latestVersionFor(selectedId, workspace.versions)
  const latestApproval = workspace.approvals.find(item => item.artifact_version_id === latestVersion?.id) || null
  const activeService = workspace.services.find(item => item.engagement_id === selectedArtifact?.engagement_id) || null
  const chatService = workspace.services.find(item => item.id === chatServiceId) || null
  const chatEngagement = related(chatService?.engagements)

  useEffect(() => {
    if (!selectedArtifact) return
    const nextVersion = releasedVersions[0] || versions[0] || null
    setVersionId(nextVersion?.id || '')
    setForm({
      title: selectedArtifact.title,
      engagement_service_id: activeService?.id || '',
      change_summary: '', data_classification: nextVersion?.data_classification || 'internal',
      content: cloneDesignSystemContent(versions[0]?.content || EMPTY_DESIGN_SYSTEM),
    })
  }, [selectedArtifact?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const cards = useMemo(() => workspace.artifacts.filter(artifact => {
    const released = releasedVersionsFor(artifact.id, workspace.versions, workspace.approvals)[0]
    if (releasedOnly && !released) return false
    const query = search.trim().toLowerCase()
    return !query || `${artifact.title} ${related(artifact.brands)?.name || ''} ${related(artifact.engagements)?.name || ''}`.toLowerCase().includes(query)
  }), [workspace, search, releasedOnly])

  function choose(artifactId) {
    setSelectedId(artifactId); setSearchParams(artifactId ? { artifact: artifactId } : {})
    setMessage(''); setError('')
  }

  function startNew() {
    const service = workspace.services[0]
    setSelectedId(''); setSearchParams({}); setVersionId('')
    setForm({ ...EMPTY_FORM, content: cloneDesignSystemContent(), engagement_service_id: service?.id || '' })
    setMessage('Creating a new manual design system draft.')
  }

  function serviceChanged(serviceId) {
    setForm(current => ({ ...current, engagement_service_id: serviceId }))
  }

  function updateItem(section, index, key, value) {
    setForm(current => ({ ...current, content: {
      ...current.content,
      [section]: current.content[section].map((item, itemIndex) => itemIndex === index ? { ...item, [key]: value } : item),
    } }))
  }

  function addItem(section, item) {
    setForm(current => ({ ...current, content: { ...current.content, [section]: [...current.content[section], item] } }))
  }

  function removeItem(section, index) {
    setForm(current => ({ ...current, content: {
      ...current.content,
      [section]: current.content[section].filter((_, itemIndex) => itemIndex !== index),
    } }))
  }

  async function save(event) {
    event.preventDefault(); setSaving(true); setError(''); setMessage('')
    try {
      const service = workspace.services.find(item => item.id === form.engagement_service_id)
      if (!service) throw new Error('Select an active Design Systems service')
      const result = await designSystems.save({
        engagement_id: service.engagement_id, engagement_service_id: service.id,
        artifact_id: selectedArtifact?.id || null, title: form.title,
        content: form.content, change_summary: form.change_summary,
        data_classification: form.data_classification,
      })
      setMessage(`Version ${result.version.version_number} saved as an immutable manual draft.`)
      await load(result.artifact_id)
      setSearchParams({ artifact: result.artifact_id })
    } catch (reason) { setError(reason.message) }
    finally { setSaving(false) }
  }

  async function releaseLatest() {
    if (!latestVersion || !activeService) return
    await designSystems.release(latestVersion.id, activeService.id)
    setMessage(`Version ${latestVersion.version_number} released to the permanent library.`)
    await load(selectedId)
  }

  if (loading) return <div className="flex h-full items-center justify-center bg-slate-950 text-sm text-slate-500">Loading Design Systems Library…</div>

  return <div className="h-full overflow-y-auto bg-slate-950 text-white">
    <div className="mx-auto max-w-7xl px-5 py-7 lg:px-8">
      <header className="flex flex-wrap items-start justify-between gap-5">
        <div><p className="text-xs font-semibold uppercase tracking-[0.18em] text-pink-300">Design Studio · Persistent library</p><h1 className="mt-2 text-3xl font-semibold">Design Systems</h1><p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">Manual, versioned specifications for tokens, typography, components, and usage rules. Released versions remain browsable and linkable from other artifacts.</p></div>
        <div className="flex gap-2"><Link to="/sphere/design" className={SECONDARY}>Design workspace</Link><button type="button" onClick={startNew} disabled={!workspace.services.length} className="rounded-xl bg-pink-600 px-4 py-2 text-sm font-semibold hover:bg-pink-500 disabled:opacity-40">New design system</button></div>
      </header>
      <div className="mt-5 rounded-xl border border-pink-500/20 bg-pink-950/15 px-4 py-3 text-sm text-pink-100"><span className="font-semibold">Structured specification, not a renderer.</span> DS5 documents standards for repeat use; it does not generate content or preview live components.</div>
      {error && <div className="mt-4 rounded-xl border border-red-900/60 bg-red-950/40 px-4 py-3 text-sm text-red-300">{error}</div>}
      {message && <div className="mt-4 rounded-xl border border-emerald-800 bg-emerald-950/25 px-4 py-3 text-sm text-emerald-300">{message}</div>}

      <div className="mt-7 grid gap-6 xl:grid-cols-[330px_1fr]">
        <aside className="space-y-4">
          <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4"><input className={INPUT} placeholder="Search systems, brands, engagements" value={search} onChange={event => setSearch(event.target.value)} /><label className="mt-3 flex items-center gap-2 text-xs text-slate-400"><input type="checkbox" checked={releasedOnly} onChange={event => setReleasedOnly(event.target.checked)} />Released library only</label></div>
          <div className="space-y-3">{cards.map(artifact => { const released = releasedVersionsFor(artifact.id, workspace.versions, workspace.approvals)[0]; return <button type="button" key={artifact.id} onClick={() => choose(artifact.id)} className={`w-full rounded-2xl border p-4 text-left ${artifact.id === selectedId ? 'border-pink-500/60 bg-pink-950/20' : 'border-slate-800 bg-slate-900/60 hover:border-slate-700'}`}><div className="flex items-start justify-between gap-3"><p className="font-semibold text-white">{artifact.title}</p><span className={`rounded-full px-2 py-1 text-[10px] font-semibold uppercase ${released ? 'bg-emerald-950 text-emerald-300' : 'bg-amber-950 text-amber-300'}`}>{released ? `Released v${released.version_number}` : 'Draft'}</span></div><p className="mt-2 text-xs text-slate-500">{related(artifact.brands)?.name || 'Brand'} · {related(artifact.engagements)?.name || 'Engagement'}</p></button>})}{!cards.length && <p className="rounded-2xl border border-dashed border-slate-800 p-6 text-center text-sm text-slate-600">No matching released design systems.</p>}</div>
        </aside>

        <main className="min-w-0 space-y-6">
          {selectedArtifact && viewedVersion && <DesignSystemViewer artifact={selectedArtifact} version={viewedVersion} versions={versions} releasedVersions={releasedVersions} setVersionId={setVersionId} />}
          <DesignSystemEditor form={form} setForm={setForm} services={workspace.services} selectedArtifact={selectedArtifact} activeService={activeService} saving={saving} onSubmit={save} onServiceChanged={serviceChanged} updateItem={updateItem} addItem={addItem} removeItem={removeItem} />
          <DesignDepartmentChat
            services={workspace.services} serviceId={chatServiceId} onServiceChange={setChatServiceId}
            engagement={chatEngagement} artifacts={workspace.artifacts} stages={workspace.stages}
            onPropose={designSystems.proposeArtifact} onCreated={() => load()}
          />
          {selectedArtifact && latestVersion && <ArtifactApprovalPanel version={latestVersion} approval={latestApproval} theme="blue" onSingleApprove={activeService ? releaseLatest : null} singleApprovalLabel={`Release version ${latestVersion.version_number}`} onChanged={() => load(selectedId)} />}
          {selectedArtifact && versions.length > 0 && <VersionProofingPanel targetKind="artifact" versions={versions} department="design" theme="violet" />}
          {selectedArtifact && <ArtifactRelationsPanel artifact={selectedArtifact} />}
        </main>
      </div>
    </div>
  </div>
}

function DesignDepartmentChat({ services, serviceId, onServiceChange, engagement, artifacts, stages, onPropose, onCreated }) {
  return <section className="rounded-2xl border border-violet-900/50 bg-violet-950/10 p-5">
    <div className="flex flex-wrap items-end justify-between gap-4"><div><p className="text-xs font-semibold uppercase tracking-[0.14em] text-violet-300">Design workflow</p><h2 className="mt-1 text-xl font-semibold">Shared Department Chat</h2><p className="mt-1 text-sm text-slate-400">Propose an unapproved Design System draft from this engagement's approved AI-safe context.</p></div><label className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Design Systems service<select className={`${INPUT} mt-2 min-w-72 normal-case`} value={serviceId} onChange={event => onServiceChange(event.target.value)}><option value="">Select active service</option>{services.map(service => <option key={service.id} value={service.id}>{related(service.engagements)?.name || 'Engagement'} · {related(related(service.engagements)?.brands)?.name || 'Brand'}</option>)}</select></label></div>
    {engagement ? <div className="mt-5"><DepartmentChat departmentId="design" departmentLabel="Design" engagement={engagement} artifactTypes={['design_system']} artifactDefinitions={DESIGN_CHAT_ARTIFACTS} artifactForType={() => artifacts.find(artifact => artifact.engagement_id === engagement.id && artifact.artifact_type === 'design_system') || null} stageForType={() => stages.find(stage => stage.engagement_id === engagement.id) || null} onPropose={onPropose} onCreated={onCreated} /></div> : <p className="mt-5 rounded-xl border border-amber-800 bg-amber-950/30 px-4 py-3 text-sm text-amber-300">Select an active Design Systems service to start a chat proposal.</p>}
  </section>
}

function DesignSystemViewer({ artifact, version, versions, releasedVersions, setVersionId }) {
  const content = version.content || {}
  const released = releasedVersions.some(item => item.id === version.id)
  return <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-6">
    <div className="flex flex-wrap items-end justify-between gap-4"><div><p className="text-xs font-semibold uppercase tracking-[0.14em] text-pink-300">{released ? 'Permanent released library' : 'Internal draft history'}</p><h2 className="mt-1 text-2xl font-semibold">{artifact.title}</h2></div><label className="text-xs uppercase tracking-[0.12em] text-slate-500">Version<select className={`${INPUT} mt-2 min-w-40 normal-case`} value={version.id} onChange={event => setVersionId(event.target.value)}>{versions.map(item => <option key={item.id} value={item.id}>Version {item.version_number}{releasedVersions.some(releasedItem => releasedItem.id === item.id) ? ' · released' : ' · draft'}</option>)}</select></label></div>
    <div className="mt-6 grid gap-5 lg:grid-cols-2"><Spec title="Color tokens">{(content.color_tokens || []).map(item => <div key={`${item.name}-${item.value}`} className="flex items-center gap-3 rounded-xl border border-slate-800 bg-slate-950/50 p-3"><span className="h-9 w-9 rounded-lg border border-white/10" style={{ backgroundColor: item.value }} /><div><p className="text-sm font-semibold">{item.name}</p><p className="text-xs text-slate-500">{item.value}</p></div></div>)}</Spec><Spec title="Typography scale">{(content.typography_scale || []).map(item => <div key={`${item.name}-${item.font}`} className="rounded-xl border border-slate-800 bg-slate-950/50 p-3"><p className="font-semibold">{item.name}</p><p className="mt-1 text-xs text-slate-500">{item.font} · {item.size} · {item.weight}</p></div>)}</Spec><Spec title="Components">{(content.components || []).map(item => <div key={item.name} className="rounded-xl border border-slate-800 bg-slate-950/50 p-3"><p className="font-semibold">{item.name}</p><p className="mt-2 text-sm leading-6 text-slate-400">{item.description}</p><p className="mt-2 text-xs leading-5 text-pink-200">Usage: {item.usage_notes}</p></div>)}</Spec><Spec title="Usage rules"><p className="whitespace-pre-wrap text-sm leading-6 text-slate-300">{content.usage_rules || 'No usage rules recorded.'}</p></Spec></div>
  </section>
}

function Spec({ title, children }) { return <section><h3 className="mb-3 text-sm font-semibold uppercase tracking-[0.12em] text-slate-400">{title}</h3><div className="space-y-2">{children}</div></section> }

function DesignSystemEditor({ form, setForm, services, selectedArtifact, activeService, saving, onSubmit, onServiceChanged, updateItem, addItem, removeItem }) {
  const serviceAvailable = selectedArtifact ? Boolean(activeService) : Boolean(services.length)
  return <form onSubmit={onSubmit} className="rounded-2xl border border-slate-800 bg-slate-900/70 p-6">
    <div><p className="text-xs font-semibold uppercase tracking-[0.14em] text-pink-300">Manual authoring</p><h2 className="mt-1 text-xl font-semibold">{selectedArtifact ? 'Create the next immutable version' : 'Create a design system'}</h2><p className="mt-1 text-xs text-slate-500">Saving never overwrites history. Release is a separate accountable decision.</p></div>
    {!serviceAvailable && <p className="mt-4 rounded-xl border border-amber-800 bg-amber-950/30 px-3 py-2 text-sm text-amber-300">This engagement no longer has an active Design Systems service. Released versions remain browsable, but new versions are blocked.</p>}
    <div className="mt-5 grid gap-4 md:grid-cols-2"><Field label="Title"><input required className={INPUT} value={form.title} onChange={event => setForm(current => ({ ...current, title: event.target.value }))} /></Field><Field label="Active Design Systems service"><select required disabled={Boolean(selectedArtifact)} className={INPUT} value={selectedArtifact ? activeService?.id || '' : form.engagement_service_id} onChange={event => onServiceChanged(event.target.value)}><option value="">Select engagement service</option>{services.map(service => { const engagement = related(service.engagements); return <option key={service.id} value={service.id}>{engagement?.name || 'Engagement'} · {related(engagement?.brands)?.name || 'Brand'}</option> })}</select></Field></div>
    <EditorSection title="Color tokens" onAdd={() => addItem('color_tokens', { name: '', value: '#000000' })}>{form.content.color_tokens.map((item, index) => <div key={index} className="grid gap-2 sm:grid-cols-[1fr_160px_auto]"><input required aria-label={`Color token ${index + 1} name`} className={INPUT} placeholder="Token name" value={item.name} onChange={event => updateItem('color_tokens', index, 'name', event.target.value)} /><input required aria-label={`Color token ${index + 1} value`} className={INPUT} pattern="#[0-9a-fA-F]{3,8}" placeholder="#2563eb" value={item.value} onChange={event => updateItem('color_tokens', index, 'value', event.target.value)} /><Remove disabled={form.content.color_tokens.length === 1} onClick={() => removeItem('color_tokens', index)} /></div>)}</EditorSection>
    <EditorSection title="Typography scale" onAdd={() => addItem('typography_scale', { name: '', font: '', size: '', weight: '' })}>{form.content.typography_scale.map((item, index) => <div key={index} className="grid gap-2 md:grid-cols-4"><input required className={INPUT} aria-label={`Typography ${index + 1} name`} placeholder="Display" value={item.name} onChange={event => updateItem('typography_scale', index, 'name', event.target.value)} /><input required className={INPUT} aria-label={`Typography ${index + 1} font`} placeholder="Inter" value={item.font} onChange={event => updateItem('typography_scale', index, 'font', event.target.value)} /><input required className={INPUT} aria-label={`Typography ${index + 1} size`} placeholder="48px" value={item.size} onChange={event => updateItem('typography_scale', index, 'size', event.target.value)} /><input required className={INPUT} aria-label={`Typography ${index + 1} weight`} placeholder="700" value={item.weight} onChange={event => updateItem('typography_scale', index, 'weight', event.target.value)} /><Remove disabled={form.content.typography_scale.length === 1} onClick={() => removeItem('typography_scale', index)} /></div>)}</EditorSection>
    <EditorSection title="Components" onAdd={() => addItem('components', { name: '', description: '', usage_notes: '' })}>{form.content.components.map((item, index) => <div key={index} className="rounded-xl border border-slate-800 bg-slate-950/40 p-3"><input required className={INPUT} aria-label={`Component ${index + 1} name`} placeholder="Component name" value={item.name} onChange={event => updateItem('components', index, 'name', event.target.value)} /><div className="mt-2 grid gap-2 md:grid-cols-2"><textarea required className={`${INPUT} min-h-24`} aria-label={`Component ${index + 1} description`} placeholder="Description" value={item.description} onChange={event => updateItem('components', index, 'description', event.target.value)} /><textarea required className={`${INPUT} min-h-24`} aria-label={`Component ${index + 1} usage notes`} placeholder="Usage notes" value={item.usage_notes} onChange={event => updateItem('components', index, 'usage_notes', event.target.value)} /></div><Remove disabled={form.content.components.length === 1} onClick={() => removeItem('components', index)} /></div>)}</EditorSection>
    <div className="mt-5"><Field label="Usage rules"><textarea className={`${INPUT} min-h-32`} value={form.content.usage_rules} onChange={event => setForm(current => ({ ...current, content: { ...current.content, usage_rules: event.target.value } }))} /></Field></div>
    <div className="mt-5 grid gap-4 md:grid-cols-2"><Field label="Change summary"><input className={INPUT} value={form.change_summary} onChange={event => setForm(current => ({ ...current, change_summary: event.target.value }))} /></Field><Field label="Classification"><select className={INPUT} value={form.data_classification} onChange={event => setForm(current => ({ ...current, data_classification: event.target.value }))}><option>public</option><option>internal</option><option>confidential</option><option>restricted</option></select></Field></div>
    <button disabled={saving || !serviceAvailable} className="mt-5 rounded-xl bg-pink-600 px-5 py-2.5 text-sm font-semibold hover:bg-pink-500 disabled:opacity-40">{saving ? 'Saving…' : selectedArtifact ? 'Save new version' : 'Create design system'}</button>
  </form>
}

function EditorSection({ title, onAdd, children }) { return <section className="mt-6"><div className="mb-3 flex items-center justify-between gap-3"><h3 className="text-sm font-semibold uppercase tracking-[0.12em] text-slate-400">{title}</h3><button type="button" onClick={onAdd} className={SECONDARY}>Add</button></div><div className="space-y-3">{children}</div></section> }
function Field({ label: fieldLabel, children }) { return <label className="block text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">{fieldLabel}<div className="mt-2 normal-case tracking-normal">{children}</div></label> }
function Remove({ disabled, onClick }) { return <button type="button" disabled={disabled} onClick={onClick} className={`${SECONDARY} mt-2`}>Remove</button> }
