import { useEffect, useState } from 'react'

import {
  CONFIGURABLE_CONNECTOR_IDS,
  CONNECTOR_CATALOG,
  DEPARTMENT_LABELS,
  connectorLabel,
} from '../config/connectorCatalog.js'
import { integrations } from '../data/integrationRepository.js'

const INPUT = 'w-full rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-2.5 text-sm text-white outline-none focus:border-purple-500 focus:ring-2 focus:ring-purple-500/20'
const BUTTON = 'rounded-xl border border-slate-700 px-3.5 py-2 text-sm font-medium text-slate-200 transition hover:border-purple-500 hover:text-white disabled:cursor-not-allowed disabled:opacity-50'

function initialForm(provider = 'openai') {
  const connector = CONNECTOR_CATALOG[provider]
  return {
    provider,
    display_name: '',
    base_url: '',
    secret_name: `${connector.secretPrefix || ''}PRIMARY`,
    department_ids: [...connector.departments],
    owner: '', repo: '', file_key: '', username: '',
    model_id: provider === 'openai' ? 'gpt-5.6-terra' : '',
  }
}

function labelize(value) {
  return String(value || 'unknown').replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function Status({ value }) {
  const style = value === 'verified' ? 'bg-emerald-950 text-emerald-300' : value === 'error' ? 'bg-red-950 text-red-300' : value === 'oauth_planned' ? 'bg-amber-950 text-amber-300' : 'bg-slate-800 text-slate-300'
  return <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${style}`}>{labelize(value)}</span>
}

export default function Settings() {
  const [connections, setConnections] = useState([])
  const [canManage, setCanManage] = useState(false)
  const [form, setForm] = useState(initialForm())
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [testingId, setTestingId] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  async function loadConnections() {
    setError('')
    try {
      const result = await integrations.list()
      setConnections(result.connections || [])
      setCanManage(Boolean(result.can_manage))
    } catch (loadError) {
      setError(loadError.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadConnections() }, [])

  function chooseProvider(provider) {
    setForm(initialForm(provider))
    setMessage('')
    setError('')
  }

  function toggleDepartment(departmentId) {
    setForm((current) => ({
      ...current,
      department_ids: current.department_ids.includes(departmentId)
        ? current.department_ids.filter((id) => id !== departmentId)
        : [...current.department_ids, departmentId],
    }))
  }

  async function saveConnection(event) {
    event.preventDefault()
    if (!CONFIGURABLE_CONNECTOR_IDS.includes(form.provider)) return
    if (!form.department_ids.length) return setError('Select at least one department for this connector.')
    setSaving(true)
    setMessage('')
    setError('')
    try {
      const publicConfig = form.provider === 'github'
        ? { owner: form.owner, repo: form.repo }
        : form.provider === 'figma'
          ? { file_key: form.file_key }
          : form.provider === 'wordpress'
            ? { username: form.username }
            : { model_id: form.model_id }
      await integrations.save({
        provider: form.provider,
        display_name: form.display_name,
        base_url: form.base_url,
        secret_name: form.secret_name,
        public_config: publicConfig,
        department_ids: form.department_ids,
      })
      setMessage('Connector metadata saved. Configure the named Supabase secret before testing.')
      setForm(initialForm(form.provider))
      await loadConnections()
    } catch (saveError) {
      setError(saveError.message)
    } finally {
      setSaving(false)
    }
  }

  async function testConnection(connection) {
    setTestingId(connection.id)
    setMessage('')
    setError('')
    try {
      const result = await integrations.test(connection.id)
      setMessage(`${connectorLabel(connection.provider)} verified in ${result.latency_ms} ms.`)
      await loadConnections()
    } catch (testError) {
      setError(testError.message)
    } finally {
      setTestingId('')
    }
  }

  async function disableConnection(connection) {
    setSaving(true)
    setMessage('')
    setError('')
    try {
      await integrations.disable(connection.id)
      setMessage(`${connection.display_name} was disabled. Its Supabase secret was not deleted.`)
      await loadConnections()
    } catch (disableError) {
      setError(disableError.message)
    } finally {
      setSaving(false)
    }
  }

  const selected = CONNECTOR_CATALOG[form.provider]

  return (
    <div className="h-full overflow-y-auto bg-slate-950 text-white">
      <header className="border-b border-slate-800 px-6 py-5">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-purple-400">Administration</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">Connector Centre</h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">Configure a provider once, assign it to the departments allowed to use it, and keep all credentials in Supabase Edge Function secrets. External writes remain human-controlled.</p>
      </header>

      <main className="mx-auto max-w-7xl space-y-6 px-6 py-6">
        {error && <div className="rounded-xl border border-red-900/60 bg-red-950/50 px-4 py-3 text-sm text-red-300">{error}</div>}
        {message && <div className="rounded-xl border border-emerald-900/60 bg-emerald-950/40 px-4 py-3 text-sm text-emerald-300">{message}</div>}

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {Object.entries(CONNECTOR_CATALOG).map(([id, connector]) => {
            const providerConnections = connections.filter((connection) => connection.provider === id)
            const verified = providerConnections.filter((connection) => connection.status === 'verified').length
            return (
              <button key={id} type="button" onClick={() => chooseProvider(id)} className={`rounded-2xl border p-5 text-left transition ${form.provider === id ? 'border-purple-500 bg-purple-950/20' : 'border-slate-800 bg-slate-900/70 hover:border-slate-700'}`}>
                <div className="flex items-start justify-between gap-3"><div><p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">{connector.category}</p><h2 className="mt-1 font-semibold">{connector.label}</h2></div><Status value={connector.availability === 'available' ? (verified ? 'verified' : 'disconnected') : connector.availability} /></div>
                <p className="mt-3 text-sm leading-6 text-slate-400">{connector.description}</p>
              </button>
            )
          })}
        </section>

        <div className="grid gap-6 xl:grid-cols-[1fr_400px]">
          <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
            <div className="flex items-center justify-between gap-3"><div><h2 className="font-semibold">Configured connections</h2><p className="mt-1 text-sm text-slate-500">Department mappings are visible; credentials and provider response bodies are never returned.</p></div><span className="text-xs text-slate-500">{connections.length} total</span></div>
            <div className="mt-5 space-y-3">
              {loading ? <p className="text-sm text-slate-500">Loading connectors…</p> : connections.length === 0 ? (
                <div className="rounded-xl border border-dashed border-slate-700 px-5 py-10 text-center text-sm text-slate-500">No connectors configured yet.</div>
              ) : connections.map((connection) => (
                <article key={connection.id} className="rounded-xl border border-slate-800 bg-slate-950/50 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="font-medium text-white">{connection.display_name}</p><p className="mt-1 text-xs text-slate-500">{connectorLabel(connection.provider)} · {connection.secret_configured ? 'Secret configured' : 'Secret missing'}</p></div><Status value={connection.status} /></div>
                  <div className="mt-3 flex flex-wrap gap-2">{(connection.department_ids || []).map((departmentId) => <span key={departmentId} className="rounded-full bg-slate-900 px-2.5 py-1 text-[11px] text-slate-400">{DEPARTMENT_LABELS[departmentId]}</span>)}</div>
                  <div className="mt-4 flex flex-wrap gap-2">
                    {canManage && <button type="button" disabled={!connection.secret_configured || testingId === connection.id} onClick={() => testConnection(connection)} className={BUTTON}>{testingId === connection.id ? 'Testing…' : 'Test connection'}</button>}
                    {canManage && <button type="button" disabled={saving} onClick={() => disableConnection(connection)} className={BUTTON}>Disable</button>}
                  </div>
                </article>
              ))}
            </div>
          </section>

          <section className="h-fit rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
            <h2 className="font-semibold">{selected.availability === 'available' ? `Add ${selected.label}` : selected.label}</h2>
            {selected.availability !== 'available' ? (
              <div className="mt-5 rounded-xl border border-amber-900/60 bg-amber-950/30 p-4 text-sm leading-6 text-amber-200">
                {selected.availability === 'oauth_planned' ? 'This connector needs a secure OAuth authorisation flow. It is shown in the relevant department now, but Anka OS will not request or store substitute credentials.' : 'This connector is recorded in the product catalogue and will be implemented in a later connector phase.'}
              </div>
            ) : !canManage && !loading ? <p className="mt-4 text-sm leading-6 text-amber-300">Only system owners, operations admins, and executives can configure connectors.</p> : (
              <form onSubmit={saveConnection} className="mt-5 space-y-4">
                <label className="block text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">Connection name<input required value={form.display_name} onChange={(event) => setForm({ ...form, display_name: event.target.value })} className={`${INPUT} mt-2 normal-case tracking-normal`} placeholder={`Primary ${selected.shortLabel} connection`} /></label>
                {form.provider === 'openai' && <label className="block text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">Default model<input required value={form.model_id} onChange={(event) => setForm({ ...form, model_id: event.target.value })} className={`${INPUT} mt-2 font-mono normal-case tracking-normal`} /></label>}
                {form.provider === 'github' && <div className="grid grid-cols-2 gap-3"><label className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">Owner<input required value={form.owner} onChange={(event) => setForm({ ...form, owner: event.target.value })} className={`${INPUT} mt-2 normal-case tracking-normal`} /></label><label className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">Repository<input required value={form.repo} onChange={(event) => setForm({ ...form, repo: event.target.value })} className={`${INPUT} mt-2 normal-case tracking-normal`} /></label></div>}
                {form.provider === 'figma' && <label className="block text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">File key<input required value={form.file_key} onChange={(event) => setForm({ ...form, file_key: event.target.value })} className={`${INPUT} mt-2 normal-case tracking-normal`} placeholder="From the Figma file URL" /></label>}
                {form.provider === 'wordpress' && <><label className="block text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">Site URL<input required type="url" value={form.base_url} onChange={(event) => setForm({ ...form, base_url: event.target.value })} className={`${INPUT} mt-2 normal-case tracking-normal`} placeholder="https://example.com" /></label><label className="block text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">WordPress username<input required value={form.username} onChange={(event) => setForm({ ...form, username: event.target.value })} className={`${INPUT} mt-2 normal-case tracking-normal`} /></label></>}

                <fieldset><legend className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">Department access</legend><div className="mt-2 grid grid-cols-2 gap-2">{Object.entries(DEPARTMENT_LABELS).map(([departmentId, label]) => <label key={departmentId} className="flex items-center gap-2 rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-slate-300"><input type="checkbox" checked={form.department_ids.includes(departmentId)} onChange={() => toggleDepartment(departmentId)} />{label}</label>)}</div></fieldset>

                <label className="block text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">Supabase secret name<input required value={form.secret_name} onChange={(event) => setForm({ ...form, secret_name: event.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, '_') })} className={`${INPUT} mt-2 font-mono normal-case tracking-normal`} /><span className="mt-2 block font-normal normal-case leading-5 tracking-normal text-slate-500">Enter the environment variable name only. Never paste the credential into Anka OS.</span></label>
                <button disabled={saving} className="w-full rounded-xl bg-purple-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-purple-500 disabled:opacity-50">{saving ? 'Saving…' : 'Save connector metadata'}</button>
              </form>
            )}
          </section>
        </div>
      </main>
    </div>
  )
}
