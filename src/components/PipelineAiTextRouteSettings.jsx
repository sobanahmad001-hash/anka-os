import { useEffect, useRef, useState } from 'react'

import { DEPARTMENT_LABELS } from '../config/connectorCatalog.js'
import { createPipelineAiTextRouteSettingsRepository } from '../data/pipelineAiTextRouteSettingsRepository.js'
import { supabase } from '../lib/supabase.js'

const DEPARTMENTS = ['content', 'design', 'marketing']
const repository = createPipelineAiTextRouteSettingsRepository(supabase)

function availableModels(connections, departmentId) {
  return connections.flatMap(connection => {
    if (connection.provider !== 'openai' || connection.status !== 'verified'
      || !(connection.department_ids || []).includes(departmentId)) return []
    const verified = new Set(connection.verified_model_ids || [])
    return (connection.model_configurations || [])
      .filter(configuration => configuration.department_id === departmentId
        && !configuration.revoked_at && verified.has(configuration.model_id))
      .map(configuration => ({
        id: configuration.id,
        label: `${configuration.model_id} · ${connection.display_name}`,
      }))
  })
}

export default function PipelineAiTextRouteSettings({ organizationId, connections, canManage, requestSignal }) {
  const [settings, setSettings] = useState([])
  const [drafts, setDrafts] = useState({})
  const [loading, setLoading] = useState(true)
  const [busyDepartment, setBusyDepartment] = useState('')
  const [message, setMessage] = useState('')
  const pendingRequests = useRef(new Map())

  useEffect(() => {
    let current = true
    if (!organizationId || requestSignal?.aborted) {
      setSettings([])
      setDrafts({})
      setLoading(false)
      return () => { current = false }
    }
    setLoading(true)
    repository.list(organizationId, { signal: requestSignal }).then(rows => {
      if (!current || requestSignal?.aborted) return
      setSettings(rows || [])
      setDrafts(Object.fromEntries((rows || []).map(row => [
        row.department_id, row.model_configuration_ids || [],
      ])))
      setLoading(false)
    }).catch(error => {
      if (!current || requestSignal?.aborted) return
      setMessage(error.message || 'Text routes could not be loaded.')
      setLoading(false)
    })
    return () => { current = false; requests.clear() }
  }, [organizationId, requestSignal])

  function choose(departmentId, priority, selectedId) {
    setDrafts(current => {
      const selected = [...(current[departmentId] || [])]
      if (!selectedId) selected.splice(priority)
      else selected[priority] = selectedId
      return { ...current, [departmentId]: selected.filter(Boolean) }
    })
    setMessage('')
  }

  async function save(departmentId) {
    const selected = drafts[departmentId] || []
    const key = `${departmentId}:${JSON.stringify(selected)}`
    let requestId = pendingRequests.current.get(key)
    if (!requestId) {
      requestId = crypto.randomUUID()
      pendingRequests.current.set(key, requestId)
    }
    setBusyDepartment(departmentId)
    setMessage('')
    try {
      await repository.save({
        organizationId, departmentId, requestId, modelConfigurationIds: selected,
      }, { signal: requestSignal })
      const rows = await repository.list(organizationId, { signal: requestSignal })
      if (requestSignal?.aborted) return
      setSettings(rows || [])
      setDrafts(Object.fromEntries((rows || []).map(row => [
        row.department_id, row.model_configuration_ids || [],
      ])))
      pendingRequests.current.delete(key)
      setMessage(`${DEPARTMENT_LABELS[departmentId]} text routes saved. Jobs remain blocked until all execution gates are released.`)
    } catch (error) {
      if (!requestSignal?.aborted && error?.name !== 'AbortError') {
        setMessage(error.message || 'Text routes could not be saved.')
      }
    } finally {
      if (!requestSignal?.aborted) setBusyDepartment('')
    }
  }

  return <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
    <p className="text-xs font-semibold uppercase tracking-[0.14em] text-purple-400">Pipeline AI text routes</p>
    <h2 className="mt-2 text-lg font-semibold text-white">Ordered eligible models</h2>
    <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">Choose up to three approved text models per department. The exact engagement connection and model are checked again for every job. An empty list disables that department. Saving routes does not start a run or spend money.</p>
    {message && <p role="status" className="mt-3 text-sm text-slate-300">{message}</p>}
    {loading ? <p className="mt-4 text-sm text-slate-500">Loading routes…</p> : <div className="mt-4 grid gap-4 lg:grid-cols-3">
      {DEPARTMENTS.map(departmentId => {
        const models = availableModels(connections, departmentId)
        const selected = drafts[departmentId] || []
        const row = settings.find(item => item.department_id === departmentId)
        const unavailable = selected.some(id => !models.some(model => model.id === id))
        const unchanged = JSON.stringify(selected) === JSON.stringify(row?.model_configuration_ids || [])
        return <div key={departmentId} className="rounded-xl border border-slate-800 bg-slate-950/50 p-4">
          <div className="flex items-center justify-between gap-2">
            <h3 className="font-medium text-white">{DEPARTMENT_LABELS[departmentId]}</h3>
            <span className="text-xs text-slate-500">Revision {row?.revision || 0}</span>
          </div>
          {[0, 1, 2].map(priority => <label key={priority} className="mt-3 block text-xs text-slate-400">
            {['Primary', 'Secondary', 'Third'][priority]}
            <select className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-2 py-2 text-sm text-white disabled:opacity-50"
              value={selected[priority] || ''} disabled={!canManage || busyDepartment !== '' || (priority > 0 && !selected[priority - 1])}
              onChange={event => choose(departmentId, priority, event.target.value)}>
              <option value="">None</option>
              {selected[priority] && !models.some(model => model.id === selected[priority])
                && <option value={selected[priority]} disabled>Unavailable configuration</option>}
              {models.map(model => <option key={model.id} value={model.id}
                disabled={selected.some((id, index) => id === model.id && index !== priority)}>
                {model.label}
              </option>)}
            </select>
          </label>)}
          {!models.length && <p className="mt-3 text-xs text-amber-300">No current approved model for this department.</p>}
          {unavailable && <p className="mt-3 text-xs text-amber-300">A saved model is no longer eligible. Clear or replace it before saving.</p>}
          {canManage && <button type="button" onClick={() => save(departmentId)}
            disabled={busyDepartment !== '' || unavailable || unchanged}
            className="mt-4 rounded-lg border border-purple-700 px-3 py-2 text-xs font-semibold text-purple-200 disabled:opacity-50">
            {busyDepartment === departmentId ? 'Saving…' : 'Save ordered routes'}
          </button>}
        </div>
      })}
    </div>}
  </section>
}