import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { useOrganization } from '../context/OrganizationContext.jsx'
import { CONTENT_ARTIFACT_FORMS } from '../data/contentStudio.js'
import { contentCustomFields } from '../data/contentCustomFieldsRepository.js'

const FIELD_TYPES = [
  ['text', 'Text'], ['number', 'Number'], ['date', 'Date'],
  ['single_select', 'Single select'], ['multi_select', 'Multi select'], ['checkbox', 'Checkbox'],
]
const INPUT = 'w-full rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-2.5 text-sm text-white outline-none focus:border-purple-500 focus:ring-2 focus:ring-purple-500/20'
const BUTTON = 'rounded-xl bg-purple-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-purple-500 disabled:cursor-not-allowed disabled:opacity-50'

function optionList(value) {
  return String(value || '').split(/[\n,]/).map(item => item.trim()).filter(Boolean)
}

export default function ContentCustomFieldSettings() {
  const {
    activeOrganizationId, selectionRequired, loading: organizationLoading,
    requestSignal, scopeRevision, handleOrganizationAccessError,
  } = useOrganization()
  const organizationReady = Boolean(activeOrganizationId) && !organizationLoading && !selectionRequired
  const repository = useMemo(() => organizationReady
    ? contentCustomFields.forOrganization(activeOrganizationId, { signal: requestSignal })
    : null, [activeOrganizationId, organizationReady, requestSignal])
  const [definitions, setDefinitions] = useState([])
  const [artifactType, setArtifactType] = useState('content')
  const [name, setName] = useState('')
  const [fieldType, setFieldType] = useState('text')
  const [options, setOptions] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const loadGeneration = useRef(0)
  const currentOrganization = useRef({ organizationId: activeOrganizationId, revision: scopeRevision })
  currentOrganization.current = { organizationId: activeOrganizationId, revision: scopeRevision }

  function currentScope(request) {
    return !request.signal?.aborted && currentOrganization.current.organizationId === request.organizationId
      && currentOrganization.current.revision === request.revision
  }

  const load = useCallback(async () => {
    const generation = ++loadGeneration.current
    if (!repository) { setDefinitions([]); setLoading(false); return }
    setLoading(true); setError('')
    try {
      const rows = await repository.listDefinitions()
      if (generation === loadGeneration.current) setDefinitions(rows)
    } catch (reason) {
      if (generation !== loadGeneration.current || requestSignal?.aborted) return
      if (!handleOrganizationAccessError(reason)) setError(reason.message)
    } finally {
      if (generation === loadGeneration.current) setLoading(false)
    }
  }, [handleOrganizationAccessError, repository, requestSignal])
  useEffect(() => { load() }, [load])
  useEffect(() => {
    loadGeneration.current += 1
    setDefinitions([]); setSaving(false); setMessage(''); setError('')
  }, [activeOrganizationId, scopeRevision])

  async function create(event) {
    const request = { organizationId: activeOrganizationId, revision: scopeRevision, signal: requestSignal }
    event.preventDefault(); setSaving(true); setError(''); setMessage('')
    try {
      if (!repository) throw new Error('Active organization is required')
      await repository.createDefinition({
        artifact_type: artifactType, name, field_type: fieldType,
        options: ['single_select', 'multi_select'].includes(fieldType) ? optionList(options) : [],
      })
      if (!currentScope(request)) return
      setName(''); setOptions('')
      setMessage('Custom field definition created for future and existing versions of this artifact type.')
      await load()
    } catch (reason) {
      if (!currentScope(request) || reason?.name === 'AbortError') return
      if (!handleOrganizationAccessError(reason)) setError(reason.message)
    } finally {
      if (currentScope(request)) setSaving(false)
    }
  }

  const visible = definitions.filter(definition => definition.artifact_type === artifactType)
  return <section className="rounded-2xl border border-purple-500/30 bg-purple-950/10 p-5">
    <div><p className="text-xs font-semibold uppercase tracking-[0.16em] text-purple-400">Content metadata</p><h2 className="mt-1 text-xl font-semibold">Artifact custom fields</h2><p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">Define stored, typed metadata for exact Content artifact versions. Values are entered manually and never copied automatically to a new version.</p></div>
    {(error || message) && <div className={`mt-4 rounded-xl border px-4 py-3 text-sm ${error ? 'border-red-900/60 bg-red-950/40 text-red-300' : 'border-emerald-900/60 bg-emerald-950/30 text-emerald-300'}`}>{error || message}</div>}
    <div className="mt-5 grid gap-5 xl:grid-cols-[1fr_380px]">
      <div><label className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">Artifact type<select className={`${INPUT} mt-2 normal-case tracking-normal`} value={artifactType} onChange={event => setArtifactType(event.target.value)}>{Object.entries(CONTENT_ARTIFACT_FORMS).map(([id, definition]) => <option key={id} value={id}>{definition.label}</option>)}</select></label><div className="mt-4 space-y-2">{loading ? <p className="text-sm text-slate-500">Loading definitions…</p> : visible.length ? visible.map(definition => <article key={definition.id} className="rounded-xl border border-slate-800 bg-slate-950/60 p-3"><div className="flex flex-wrap items-center justify-between gap-3"><p className="font-semibold text-white">{definition.name.replaceAll('_', ' ')}</p><span className="rounded-full bg-purple-950 px-2.5 py-1 text-[10px] font-semibold uppercase text-purple-300">{definition.field_type.replaceAll('_', ' ')}</span></div>{definition.options?.length > 0 && <p className="mt-2 text-xs text-slate-500">{definition.options.join(' · ')}</p>}</article>) : <div className="rounded-xl border border-dashed border-slate-700 p-6 text-center text-sm text-slate-500">No custom fields are defined for this Content artifact type.</div>}</div></div>
      <form onSubmit={create} className="space-y-4 rounded-xl border border-slate-800 bg-slate-900/70 p-4"><h3 className="font-semibold">Define a field</h3><label className="block text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">Name<input required maxLength="80" className={`${INPUT} mt-2 normal-case tracking-normal`} value={name} onChange={event => setName(event.target.value)} placeholder="e.g. reading_level" /></label><label className="block text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">Type<select className={`${INPUT} mt-2 normal-case tracking-normal`} value={fieldType} onChange={event => setFieldType(event.target.value)}>{FIELD_TYPES.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>{['single_select', 'multi_select'].includes(fieldType) && <label className="block text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">Options<span className="ml-2 font-normal normal-case tracking-normal text-slate-600">Comma or line separated</span><textarea required rows="4" className={`${INPUT} mt-2 normal-case tracking-normal`} value={options} onChange={event => setOptions(event.target.value)} /></label>}<button disabled={saving || !organizationReady || !name.trim()} className={`${BUTTON} w-full`}>{saving ? 'Creating…' : 'Create custom field'}</button></form>
    </div>
  </section>
}
