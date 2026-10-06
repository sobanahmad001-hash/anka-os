import { openAiModelLabel } from '../data/openaiModelPolicy.js'
import { useEffect, useMemo, useRef, useState } from 'react'

import { DEPARTMENT_LABELS } from '../config/connectorCatalog.js'
import { integrations } from '../data/integrationRepository.js'

const CHAT_DEPARTMENTS = ['content', 'design', 'marketing']

function initialDraft(connection) {
  const draft = {}
  for (const departmentId of CHAT_DEPARTMENTS) {
    const active = (connection.model_configurations || [])
      .filter(configuration => configuration.department_id === departmentId && !configuration.revoked_at)
      .map(configuration => configuration.model_id)
    draft[departmentId] = active
  }
  draft.organization = (connection.context_model_configurations || []).filter(configuration => !configuration.revoked_at).map(configuration => configuration.model_id)
  return draft
}

export default function DepartmentChatModelAllowlist({ organizationId, connections, canManage, onSaved, requestSignal }) {
  const textConnections = useMemo(() => connections.filter(connection => ['openai', 'anthropic', 'google_gemini'].includes(connection.provider)), [connections])
  const [drafts, setDrafts] = useState({})
  const [savingId, setSavingId] = useState('')
  const [feedback, setFeedback] = useState({})
  const pending = useRef(false)
  const alive = useRef(true)
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])

  useEffect(() => {
    setDrafts(current => Object.fromEntries(textConnections.map(connection => [connection.id, current[connection.id] || initialDraft(connection)])))
  }, [textConnections])

  function report(id, text, kind = 'status') {
    if (alive.current && !requestSignal?.aborted) setFeedback(current => ({ ...current, [id]: { text, kind } }))
  }

  async function saveApproval(connection, privateScope = false) {
    if (pending.current || requestSignal?.aborted) return
    pending.current = true
    const key = privateScope ? connection.id + ':organization' : connection.id
    const mapped = CHAT_DEPARTMENTS.filter(id => (connection.department_ids || []).includes(id))
    const draft = drafts[connection.id] || {}
    const expected = privateScope ? { organization: [...(draft.organization || [])] }
      : Object.fromEntries(mapped.map(id => [id, [...(draft[id] || [])]]))
    setSavingId(key)
    report(connection.id, 'Saving approval and checking stored selections...')
    let acknowledged = false
    try {
      try {
        const result = privateScope
          ? await integrations.configureContextOrganizationModels(organizationId, connection.id, expected.organization, { signal: requestSignal })
          : await integrations.configureModelAllowlist(organizationId, connection.id, expected, { signal: requestSignal })
        acknowledged = result?.success === true
      } catch { /* Read current state once: a lost acknowledgement does not prove failure. */ }
      if (requestSignal?.aborted || !alive.current) return
      const result = await integrations.listModelAllowlist(organizationId, { signal: requestSignal })
      if (result?.organization_id !== organizationId || !Array.isArray(result.connections)) throw new Error('Unconfirmed')
      const stored = result.connections.find(row => row.id === connection.id)
      if (!stored) throw new Error('Unconfirmed')
      const actual = initialDraft(stored)
      const same = Object.entries(expected).every(([scope, models]) =>
        JSON.stringify([...models].sort()) === JSON.stringify([...(actual[scope] || [])].sort()))
      if (!same) {
        report(connection.id, 'Stored approvals do not match these selections. Your draft is retained; review current access before saving again.', 'alert')
        return
      }
      const summary = Object.entries(expected).map(([scope, models]) =>
        (scope === 'organization' ? 'Private conversations' : DEPARTMENT_LABELS[scope]) + ': ' + (models.map(openAiModelLabel).join(', ') || 'none')).join('; ')
      report(connection.id, (acknowledged ? 'Approval saved and confirmed. ' : 'Current stored approvals confirmed; the save acknowledgement was unavailable. ')
        + summary + '. ' + (privateScope ? 'Provider and spend checks still apply.' : 'Workshop project connections are a separate step; this save does not map an engagement.'))
      try { await onSaved?.() } catch { /* Verified readback remains valid even if parent refresh fails. */ }
    } catch {
      report(connection.id, 'Approval outcome could not be confirmed. Your selections are retained. Reload current access before retrying; no reply was sent.', 'alert')
    } finally {
      pending.current = false
      if (alive.current && !requestSignal?.aborted) setSavingId('')
    }
  }

  async function verifyOrganization(connection) {
    if (pending.current || requestSignal?.aborted) return
    pending.current = true
    setSavingId(connection.id + ':verify')
    report(connection.id, 'Verifying connection...')
    try {
      await integrations.testForOrganization(organizationId, connection.id, { signal: requestSignal })
      report(connection.id, 'Connection check completed. Refresh current connector facts before approving models.')
      await onSaved?.()
    } catch {
      report(connection.id, 'Connection verification could not be confirmed. No model approval was changed by this control.', 'alert')
    } finally {
      pending.current = false
      if (alive.current && !requestSignal?.aborted) setSavingId('')
    }
  }

  if (!textConnections.length) return null
  return <section className="rounded-2xl border border-[var(--anka-line)] bg-[var(--anka-surface)] p-5">
    <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--anka-violet)]">Approved department text models</p>
    <h2 className="mt-2 text-lg font-semibold text-[var(--anka-ink)]">Administrator-approved access</h2>
    <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--anka-muted)]">Only models already verified through each connector can be approved. Disabling a choice blocks new pipeline dispatches without changing historical run records. Among eligible models, Luna is preferred for routine general chat; Sol for project chat and Content, Marketing and Design work. Astra is a premium explicit choice. Approval alone does not enable spend.</p>
    <div className="mt-4 space-y-4">
      {textConnections.map(connection => {
        const verifiedModels = connection.status === 'verified' ? (connection.verified_model_ids || []) : []
        const mapped = new Set(connection.department_ids || [])
        const draft = drafts[connection.id] || {}
        return <article key={connection.id} className="rounded-xl border border-[var(--anka-line)] bg-[var(--anka-canvas)] p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div><p className="font-medium text-[var(--anka-ink)]">{connection.display_name}</p><p className="mt-1 text-xs text-[var(--anka-muted)]">{connection.status === 'verified' ? 'Verified connector facts only' : 'Verify this connector before approving models'}</p></div>
            {canManage && !connection.organization_level && CHAT_DEPARTMENTS.some(id => mapped.has(id)) && <button type="button" disabled={Boolean(savingId) || !verifiedModels.length} onClick={() => saveApproval(connection)} className="rounded-lg border border-[var(--anka-violet)] bg-[var(--anka-violet)] px-3 py-2 text-xs font-semibold text-[var(--anka-on-violet)] disabled:opacity-50">{savingId === connection.id ? 'Saving...' : 'Save department model approval'}</button>}
          </div>
          {feedback[connection.id] && <p role={feedback[connection.id].kind} aria-live="polite" className="mt-3 text-sm text-[var(--anka-ink)]">{feedback[connection.id].text}</p>}
          {!connection.organization_level && <p className="mt-2 text-xs text-[var(--anka-muted)]">Department approval permits eligible model choices. To connect a Workshop, open the intended project in <a href="/sphere/engagements" className="underline">Engagements</a> and use Workshop model connections. Pipeline routes below are separate.</p>}
          {connection.organization_level && <fieldset disabled={!canManage || Boolean(savingId)} className="mt-4 rounded-lg border border-[var(--anka-violet)] p-3 disabled:opacity-50">
            <legend className="px-1 text-xs font-semibold text-[var(--anka-violet)]">Private organization conversations</legend>
            <p className="mb-2 text-xs text-[var(--anka-muted)]">This connector has no engagement mapping. Approval here only selects models; it does not enable AI replies or spend.</p>
            <div className="flex flex-wrap gap-3">{verifiedModels.map(modelId => <label key={modelId} className="flex items-center gap-2 text-xs text-[var(--anka-ink)]">
              <input type="checkbox" checked={(draft.organization || []).includes(modelId)} onChange={() => setDrafts(current => {
                const connectionDraft = current[connection.id] || {}
                const values = connectionDraft.organization || []
                return { ...current, [connection.id]: { ...connectionDraft, organization: values.includes(modelId) ? values.filter(value => value !== modelId) : [...values, modelId] } }
              })} />
              <span className="break-all">{openAiModelLabel(modelId)}</span>
            </label>)}</div>
            {canManage && connection.status !== 'verified' && <button type="button" disabled={Boolean(savingId)} onClick={() => verifyOrganization(connection)} className="mt-3 mr-2 rounded-lg border border-[var(--anka-line)] px-3 py-2 text-xs font-semibold text-[var(--anka-ink)] disabled:opacity-50">{savingId === `${connection.id}:verify` ? 'Verifying...' : 'Verify connection'}</button>}
            {canManage && <button type="button" disabled={Boolean(savingId) || !verifiedModels.length} onClick={() => saveApproval(connection, true)} className="mt-3 rounded-lg border border-[var(--anka-violet)] bg-[var(--anka-violet)] px-3 py-2 text-xs font-semibold text-[var(--anka-on-violet)] disabled:opacity-50">{savingId === `${connection.id}:organization` ? 'Saving...' : 'Save private model access'}</button>}
          </fieldset>}
          {!connection.organization_level && <div className="mt-4 grid gap-3 md:grid-cols-3">
            {CHAT_DEPARTMENTS.map(departmentId => <fieldset key={departmentId} disabled={!canManage || Boolean(savingId) || !mapped.has(departmentId) || !verifiedModels.length} className="rounded-lg border border-[var(--anka-line)] p-3 disabled:opacity-50">
              <legend className="px-1 text-xs font-semibold text-[var(--anka-ink)]">{DEPARTMENT_LABELS[departmentId]}</legend>
              {verifiedModels.map(modelId => <label key={modelId} className="mt-2 flex items-start gap-2 text-xs text-[var(--anka-ink)]">
                <input type="checkbox" checked={(draft[departmentId] || []).includes(modelId)} onChange={() => setDrafts(current => {
                  const connectionDraft = current[connection.id] || {}
                  const values = connectionDraft[departmentId] || []
                  return { ...current, [connection.id]: { ...connectionDraft, [departmentId]: values.includes(modelId) ? values.filter(value => value !== modelId) : [...values, modelId] } }
                })} />
                <span className="break-all">{openAiModelLabel(modelId)}</span>
              </label>)}
              {!verifiedModels.length && <p className="mt-2 text-xs text-[var(--anka-muted)]">No verified model.</p>}
              {!mapped.has(departmentId) && <p className="mt-2 text-xs text-[var(--anka-muted)]">Connector not mapped here.</p>}
            </fieldset>)}
          </div>}
        </article>
      })}
    </div>
  </section>
}
