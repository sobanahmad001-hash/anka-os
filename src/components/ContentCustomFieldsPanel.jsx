import { useCallback, useEffect, useMemo, useState } from 'react'

import {
  customFieldDraftValue,
  customFieldValueFromInput,
} from '../data/contentCustomFields.js'
import { contentCustomFields } from '../data/contentCustomFieldsRepository.js'

const INPUT = 'w-full rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-2.5 text-sm text-white outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-500/20'
const BUTTON = 'rounded-xl border border-slate-700 px-3 py-2 text-xs font-semibold text-slate-200 hover:border-amber-500 disabled:cursor-not-allowed disabled:opacity-50'

function FieldInput({ definition, value, onChange }) {
  if (definition.field_type === 'checkbox') return <label className="flex items-center gap-3 rounded-xl border border-slate-800 bg-slate-950/60 px-3 py-2.5 text-sm text-slate-300"><input type="checkbox" checked={value === true} onChange={event => onChange(event.target.checked)} />Checked</label>
  if (definition.field_type === 'single_select') return <select className={INPUT} value={value || ''} onChange={event => onChange(event.target.value)}><option value="">No value</option>{(definition.options || []).map(option => <option key={option} value={option}>{option}</option>)}</select>
  if (definition.field_type === 'multi_select') return <div className="flex flex-wrap gap-2">{(definition.options || []).map(option => <label key={option} className="flex items-center gap-2 rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-slate-300"><input type="checkbox" checked={(value || []).includes(option)} onChange={() => onChange((value || []).includes(option) ? value.filter(item => item !== option) : [...(value || []), option])} />{option}</label>)}</div>
  return <input className={INPUT} type={definition.field_type === 'number' ? 'number' : definition.field_type === 'date' ? 'date' : 'text'} step={definition.field_type === 'number' ? 'any' : undefined} value={value ?? ''} onChange={event => onChange(event.target.value)} />
}

export default function ContentCustomFieldsPanel({ artifactType, versions, initialVersionId }) {
  const orderedVersions = useMemo(() => [...versions].sort((left, right) => right.version_number - left.version_number), [versions])
  const [versionId, setVersionId] = useState(initialVersionId || orderedVersions[0]?.id || '')
  const [definitions, setDefinitions] = useState([])
  const [drafts, setDrafts] = useState({})
  const [loading, setLoading] = useState(Boolean(versionId))
  const [savingId, setSavingId] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    if (!versionId) return
    setLoading(true); setError('')
    try {
      const [nextDefinitions, values] = await Promise.all([
        contentCustomFields.listDefinitions(artifactType),
        contentCustomFields.listValues(versionId),
      ])
      const valueByDefinition = new Map(values.map(item => [item.field_def_id, item.value]))
      setDefinitions(nextDefinitions)
      setDrafts(Object.fromEntries(nextDefinitions.map(definition => [
        definition.id, customFieldDraftValue(definition, valueByDefinition.get(definition.id)),
      ])))
    } catch (reason) { setError(reason.message) }
    finally { setLoading(false) }
  }, [artifactType, versionId])
  useEffect(() => { load() }, [load])

  async function save(definition) {
    setSavingId(definition.id); setError(''); setMessage('')
    try {
      const value = customFieldValueFromInput(definition.field_type, drafts[definition.id])
      await contentCustomFields.saveValue(versionId, definition.id, value)
      setMessage(`${definition.name.replaceAll('_', ' ')} saved on this exact version.`)
      await load()
    } catch (reason) { setError(reason.message) }
    finally { setSavingId('') }
  }

  if (!versions.length) return null
  return <section className="mt-4 rounded-2xl border border-amber-500/25 bg-amber-950/10 p-5">
    <div className="flex flex-wrap items-end justify-between gap-4"><div><p className="text-xs font-semibold uppercase tracking-[0.14em] text-amber-400">Typed custom metadata</p><h3 className="mt-1 font-semibold text-white">Version custom fields</h3><p className="mt-1 text-xs leading-5 text-slate-500">Values belong only to the selected immutable version. They do not change its content or approval and are not copied to revisions.</p></div><label className="min-w-48 text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Exact version<select className={`${INPUT} mt-2 normal-case tracking-normal`} value={versionId} onChange={event => { setVersionId(event.target.value); setMessage(''); setError('') }}>{orderedVersions.map(version => <option key={version.id} value={version.id}>Version {version.version_number}</option>)}</select></label></div>
    {(error || message) && <div className={`mt-4 rounded-xl border px-3 py-2 text-sm ${error ? 'border-red-900/60 bg-red-950/40 text-red-300' : 'border-emerald-900/60 bg-emerald-950/30 text-emerald-300'}`}>{error || message}</div>}
    {loading ? <p className="mt-4 text-sm text-slate-500">Loading custom fields…</p> : definitions.length ? <div className="mt-4 grid gap-3 lg:grid-cols-2">{definitions.map(definition => <article key={definition.id} className="rounded-xl border border-slate-800 bg-slate-900/70 p-4"><div className="mb-3 flex items-center justify-between gap-3"><div><p className="text-sm font-semibold capitalize text-white">{definition.name.replaceAll('_', ' ')}</p><p className="mt-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-600">{definition.field_type.replaceAll('_', ' ')}</p></div><button type="button" className={BUTTON} disabled={savingId === definition.id} onClick={() => save(definition)}>{savingId === definition.id ? 'Saving…' : 'Save value'}</button></div><FieldInput definition={definition} value={drafts[definition.id]} onChange={value => setDrafts(current => ({ ...current, [definition.id]: value }))} /></article>)}</div> : <div className="mt-4 rounded-xl border border-dashed border-slate-700 p-6 text-center text-sm text-slate-500">No custom fields are defined for this artifact type. Add them in organisation settings.</div>}
  </section>
}
