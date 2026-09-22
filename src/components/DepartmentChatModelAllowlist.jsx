import { useEffect, useState } from 'react'

import { DEPARTMENT_LABELS } from '../config/connectorCatalog.js'
import { integrations } from '../data/integrationRepository.js'

const CHAT_DEPARTMENTS = ['content', 'design', 'marketing']

function initialDraft(connection) {
  const draft = {}
  for (const departmentId of CHAT_DEPARTMENTS) {
    const active = (connection.model_configurations || [])
      .filter(configuration => configuration.department_id === departmentId)
      .map(configuration => configuration.model_id)
    draft[departmentId] = active
  }
  draft.organization = (connection.context_model_configurations || []).map(configuration => configuration.model_id)
  return draft
}

export default function DepartmentChatModelAllowlist({ organizationId, connections, canManage, onSaved, requestSignal }) {
  const textConnections = connections.filter(connection => ['openai', 'anthropic', 'google_gemini'].includes(connection.provider))
  const [drafts, setDrafts] = useState({})
  const [savingId, setSavingId] = useState('')
  const [message, setMessage] = useState('')

  useEffect(() => {
    setDrafts(Object.fromEntries(textConnections.map(connection => [connection.id, initialDraft(connection)])))
  }, [connections])

  async function save(connection) {
    setSavingId(connection.id)
    setMessage('')
    try {
      const mapped = new Set(connection.department_ids || [])
      const draft = drafts[connection.id] || {}
      await integrations.configureModelAllowlist(organizationId, connection.id, Object.fromEntries(
        CHAT_DEPARTMENTS.filter(departmentId => mapped.has(departmentId))
          .map(departmentId => [departmentId, draft[departmentId] || []]),
      ), { signal: requestSignal })
      setMessage('Department text-model access saved. New requests use only the active selections.')
      await onSaved?.()
    } catch (error) {
      if (error?.name !== 'AbortError' && error?.cause?.name !== 'AbortError') setMessage(error.message || 'Model access could not be saved.')
    } finally {
      setSavingId('')
    }
  }

  async function saveOrganization(connection) {
    setSavingId(`${connection.id}:organization`)
    setMessage('')
    try {
      await integrations.configureContextOrganizationModels(organizationId, connection.id,
        drafts[connection.id]?.organization || [], { signal: requestSignal })
      setMessage('Private organization conversation model access saved. AI replies remain disabled until paid execution is separately gated.')
      await onSaved?.()
    } catch (error) {
      if (error?.name !== 'AbortError' && error?.cause?.name !== 'AbortError') setMessage(error.message || 'Private model access could not be saved.')
    } finally {
      setSavingId('')
    }
  }

  async function verifyOrganization(connection) {
    setSavingId(`${connection.id}:verify`)
    setMessage('')
    try {
      await integrations.testForOrganization(organizationId, connection.id, { signal: requestSignal })
      setMessage('Organization-only connector verified. Model approval remains a separate step.')
      await onSaved?.()
    } catch (error) {
      if (error?.name !== 'AbortError' && error?.cause?.name !== 'AbortError') setMessage(error.message || 'Connector verification failed.')
    } finally {
      setSavingId('')
    }
  }

  if (!textConnections.length) return null
  return <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
    <p className="text-xs font-semibold uppercase tracking-[0.14em] text-purple-400">Approved department text models</p>
    <h2 className="mt-2 text-lg font-semibold text-white">Administrator-approved access</h2>
    <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">Only models already verified through each connector can be approved. Disabling a choice blocks new pipeline dispatches without changing historical run records. Shared Chat currently uses OpenAI models.</p>
    {message && <p className="mt-3 text-sm text-slate-300">{message}</p>}
    <div className="mt-4 space-y-4">
      {textConnections.map(connection => {
        const verifiedModels = connection.status === 'verified' ? (connection.verified_model_ids || []) : []
        const mapped = new Set(connection.department_ids || [])
        const draft = drafts[connection.id] || {}
        return <article key={connection.id} className="rounded-xl border border-slate-800 bg-slate-950/50 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div><p className="font-medium text-white">{connection.display_name}</p><p className="mt-1 text-xs text-slate-500">{connection.status === 'verified' ? 'Verified connector facts only' : 'Verify this connector before approving models'}</p></div>
            {canManage && <button type="button" disabled={Boolean(savingId) || !verifiedModels.length} onClick={() => save(connection)} className="rounded-lg border border-purple-700 px-3 py-2 text-xs font-semibold text-purple-200 disabled:opacity-50">{savingId === connection.id ? 'Saving…' : 'Save model access'}</button>}
          </div>
          {connection.organization_level && <fieldset disabled={!canManage || !verifiedModels.length} className="mt-4 rounded-lg border border-purple-900/60 p-3 disabled:opacity-50">
            <legend className="px-1 text-xs font-semibold text-purple-200">Private organization conversations</legend>
            <p className="mb-2 text-xs text-slate-400">This connector has no engagement mapping. Approval here only selects models; it does not enable AI replies or spend.</p>
            <div className="flex flex-wrap gap-3">{verifiedModels.map(modelId => <label key={modelId} className="flex items-center gap-2 text-xs text-slate-300">
              <input type="checkbox" checked={(draft.organization || []).includes(modelId)} onChange={() => setDrafts(current => {
                const connectionDraft = current[connection.id] || {}
                const values = connectionDraft.organization || []
                return { ...current, [connection.id]: { ...connectionDraft, organization: values.includes(modelId) ? values.filter(value => value !== modelId) : [...values, modelId] } }
              })} />
              <span className="break-all">{modelId}</span>
            </label>)}</div>
            {canManage && connection.status !== 'verified' && <button type="button" disabled={Boolean(savingId)} onClick={() => verifyOrganization(connection)} className="mt-3 mr-2 rounded-lg border border-slate-700 px-3 py-2 text-xs font-semibold text-slate-200 disabled:opacity-50">{savingId === `${connection.id}:verify` ? 'Verifying…' : 'Verify connection'}</button>}
            {canManage && <button type="button" disabled={Boolean(savingId) || !verifiedModels.length} onClick={() => saveOrganization(connection)} className="mt-3 rounded-lg border border-purple-700 px-3 py-2 text-xs font-semibold text-purple-200 disabled:opacity-50">{savingId === `${connection.id}:organization` ? 'Saving…' : 'Save private model access'}</button>}
          </fieldset>}
          <div className="mt-4 grid gap-3 md:grid-cols-3">
            {CHAT_DEPARTMENTS.map(departmentId => <fieldset key={departmentId} disabled={!canManage || !mapped.has(departmentId) || !verifiedModels.length} className="rounded-lg border border-slate-800 p-3 disabled:opacity-50">
              <legend className="px-1 text-xs font-semibold text-slate-300">{DEPARTMENT_LABELS[departmentId]}</legend>
              {verifiedModels.map(modelId => <label key={modelId} className="mt-2 flex items-start gap-2 text-xs text-slate-300">
                <input type="checkbox" checked={(draft[departmentId] || []).includes(modelId)} onChange={() => setDrafts(current => {
                  const connectionDraft = current[connection.id] || {}
                  const values = connectionDraft[departmentId] || []
                  return { ...current, [connection.id]: { ...connectionDraft, [departmentId]: values.includes(modelId) ? values.filter(value => value !== modelId) : [...values, modelId] } }
                })} />
                <span className="break-all">{modelId}</span>
              </label>)}
              {!verifiedModels.length && <p className="mt-2 text-xs text-slate-500">No verified model.</p>}
              {!mapped.has(departmentId) && <p className="mt-2 text-xs text-slate-500">Connector not mapped here.</p>}
            </fieldset>)}
          </div>
        </article>
      })}
    </div>
  </section>
}
