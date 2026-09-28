import { useEffect, useMemo, useRef, useState } from 'react'

import { useAuth } from '../context/AuthContext.jsx'
import { useOrganization } from '../context/OrganizationContext.jsx'
import {
  buildClientProjectProjection,
  buildInternalProjectProjection,
  projectProjectionToMarkdown,
} from '../data/livingProjectRecord.js'
import { createReportsAndRecordsRepository } from '../data/reportsAndRecordsRepository.js'
import { canPreserveReportsSnapshot, runReportsSnapshotOperation } from '../data/reportsAndRecordsOperation.js'
import { supabase } from '../lib/supabase.js'

const reportsAndRecords = createReportsAndRecordsRepository(supabase)

const BUTTON = 'workspace-button outline-none focus-visible:ring-2 focus-visible:ring-[var(--anka-focus)] disabled:cursor-not-allowed disabled:opacity-50'

function labelize(value) {
  return String(value || 'unknown').replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function saveFile(fileName, content, type) {
  const url = URL.createObjectURL(new Blob([content], { type }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  anchor.click()
  URL.revokeObjectURL(url)
}

function Metric({ label, value, note }) {
  return (
    <div className="workspace-metric">
      <p className="text-xs font-medium uppercase tracking-[0.12em] text-[var(--anka-muted)]">{label}</p>
      <p className="mt-2 text-2xl font-semibold text-[var(--anka-ink)]">{value}</p>
      <p className="mt-1 text-xs text-[var(--anka-muted)]">{note}</p>
    </div>
  )
}

function RecordSection({ title, children }) {
  return (
    <section className="workspace-card p-5">
      <h2 className="text-base font-semibold text-[var(--anka-ink)]">{title}</h2>
      <div className="mt-4">{children}</div>
    </section>
  )
}

function StatusRows({ items, empty, titleKey = 'title' }) {
  if (!items.length) return <p className="text-sm text-[var(--anka-muted)]">{empty}</p>
  return (
    <div className="space-y-2">
      {items.map((item, index) => (
        <div key={item.id || `${item[titleKey]}-${index}`} className="flex items-center justify-between gap-4 rounded-xl border border-[var(--anka-line)] bg-[var(--anka-surface-raised)] px-4 py-3">
          <div>
            <p className="text-sm font-medium text-[var(--anka-ink)]">{item[titleKey]}</p>
            {(item.due_date || item.target_date) && <p className="mt-1 text-xs text-[var(--anka-muted)]">Target {item.due_date || item.target_date}</p>}
          </div>
          <span className="rounded-full border border-[var(--anka-line)] bg-[var(--anka-surface)] px-2.5 py-1 text-xs text-[var(--anka-muted)]">{labelize(item.status)}</span>
        </div>
      ))}
    </div>
  )
}

export default function ReportsAndRecords() {
  const { user } = useAuth()
  const { activeOrganizationId, activeMembership, scopeRevision, handleOrganizationAccessError } = useOrganization()
  const [projects, setProjects] = useState([])
  const [projectId, setProjectId] = useState('')
  const [workspace, setWorkspace] = useState(null)
  const [projectionKind, setProjectionKind] = useState('internal')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const currentScope = useRef({ organizationId: activeOrganizationId, revision: scopeRevision, projectId })
  const snapshotOperation = useRef({ id: 0, controller: null })
  currentScope.current = { organizationId: activeOrganizationId, revision: scopeRevision, projectId }

  useEffect(() => {
    snapshotOperation.current.controller?.abort()
    snapshotOperation.current = { id: snapshotOperation.current.id + 1, controller: null }
    setSaving(false)
    return () => {
      snapshotOperation.current.controller?.abort()
      snapshotOperation.current = { id: snapshotOperation.current.id + 1, controller: null }
    }
  }, [activeOrganizationId, projectId, scopeRevision])

  useEffect(() => {
    if (!activeOrganizationId) return undefined
    let active = true
    const controller = new AbortController()
    setProjects([])
    setProjectId('')
    setWorkspace(null)
    setMessage('')
    setError('')
    setLoading(true)
    reportsAndRecords.listProjects(activeOrganizationId, { signal: controller.signal })
      .then((rows) => {
        if (!active || controller.signal.aborted) return
        setProjects(rows || [])
        setProjectId(rows?.[0]?.id || '')
      })
      .catch((loadError) => {
        if (!active || controller.signal.aborted) return
        if (!handleOrganizationAccessError(loadError, { membershipMismatch: loadError.membershipMismatch })) setError(loadError.message)
      })
      .finally(() => active && !controller.signal.aborted && setLoading(false))
    return () => { active = false; controller.abort() }
  }, [activeOrganizationId, handleOrganizationAccessError, scopeRevision])

  useEffect(() => {
    if (!projectId || !activeOrganizationId) {
      setWorkspace(null)
      return undefined
    }
    let active = true
    const controller = new AbortController()
    setLoading(true)
    setWorkspace(null)
    setMessage('')
    setError('')
    reportsAndRecords.getProjectWorkspace(projectId, activeOrganizationId, { signal: controller.signal })
      .then((data) => active && !controller.signal.aborted && setWorkspace(data))
      .catch((loadError) => {
        if (!active || controller.signal.aborted) return
        if (!handleOrganizationAccessError(loadError, { membershipMismatch: loadError.membershipMismatch })) setError(loadError.message)
      })
      .finally(() => active && !controller.signal.aborted && setLoading(false))
    return () => { active = false; controller.abort() }
  }, [activeOrganizationId, handleOrganizationAccessError, projectId, scopeRevision])

  const projections = useMemo(() => {
    if (!workspace) return null
    const generatedAt = new Date().toISOString()
    return {
      internal: buildInternalProjectProjection(workspace, generatedAt),
      client: buildClientProjectProjection(workspace, generatedAt),
    }
  }, [workspace])
  const projection = projections?.[projectionKind]
  const canPreserveSnapshot = canPreserveReportsSnapshot({
    membership: activeMembership,
    userId: user?.id,
    projectOwnerId: workspace?.project?.owner_id,
  })

  async function createSnapshot() {
    if (!canPreserveSnapshot || !workspace?.livingRecord?.id || !projection || !user?.id || !activeOrganizationId) return
    snapshotOperation.current.controller?.abort()
    const controller = new AbortController()
    const operationId = snapshotOperation.current.id + 1
    snapshotOperation.current = { id: operationId, controller }
    const requestedScope = { organizationId: activeOrganizationId, revision: scopeRevision, projectId: workspace.project.id }
    const isCurrent = () => {
      const current = currentScope.current
      return !controller.signal.aborted
        && snapshotOperation.current.id === operationId
        && current.organizationId === requestedScope.organizationId
        && current.revision === requestedScope.revision
        && current.projectId === requestedScope.projectId
    }
    setSaving(true)
    setMessage('')
    setError('')
    await runReportsSnapshotOperation({
      signal: controller.signal,
      isCurrent,
      preserve: (signal) => reportsAndRecords.createLivingRecordSnapshot({
        organizationId: requestedScope.organizationId,
        projectId: requestedScope.projectId,
        livingRecordId: workspace.livingRecord.id,
        projectionKind,
        sourceVersion: workspace.livingRecord.source_version || 1,
        requestId: crypto.randomUUID(),
        reason: `${labelize(projectionKind)} reporting checkpoint`,
      }, { signal }),
      refresh: (signal) => reportsAndRecords.getProjectWorkspace(
        requestedScope.projectId,
        requestedScope.organizationId,
        { signal },
      ),
      onPreserved: (snapshot) => setMessage(
        `${labelize(snapshot.projection_kind)} snapshot v${snapshot.source_version} is preserved.`,
      ),
      onRefreshed: setWorkspace,
      onError: (saveError) => {
        if (!handleOrganizationAccessError(saveError, { membershipMismatch: saveError.membershipMismatch })) {
          setError(saveError.message)
        }
      },
      onFinished: () => {
        snapshotOperation.current = { id: operationId, controller: null }
        setSaving(false)
      },
    })

  }

  function exportProjection(format) {
    if (!projection) return
    const slug = (projection.project.name || 'project').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
    if (format === 'json') {
      saveFile(`${slug}-${projectionKind}-record.json`, JSON.stringify(projection, null, 2), 'application/json')
    } else {
      saveFile(`${slug}-${projectionKind}-record.md`, projectProjectionToMarkdown(projection), 'text/markdown')
    }
  }

  if (loading && !workspace) {
    return <div className="workspace-page flex h-full items-center justify-center text-[var(--anka-muted)]">Preparing project records…</div>
  }

  return (
    <div className="workspace-page h-full overflow-y-auto">
      <header className="mx-auto max-w-7xl pb-5 print:border-0">
        <div className="workspace-card flex flex-wrap items-end justify-between gap-4 p-5">
          <div>
            <p className="workspace-eyebrow">Delivery intelligence</p>
            <h1 className="workspace-title">Reports & Living Records</h1>
            <p className="workspace-description mt-2">Versioned project truth generated from canonical work. Client records contain released information only. Recent activity is a bounded feed, not a complete event record.</p>
          </div>
          <label className="min-w-64 text-xs font-semibold uppercase tracking-[0.12em] text-[var(--anka-muted)]">
            Project
            <select value={projectId} onChange={(event) => setProjectId(event.target.value)} className="mt-2 w-full rounded-xl border border-[var(--anka-line)] bg-[var(--anka-surface)] px-3.5 py-2.5 text-sm font-medium normal-case tracking-normal text-[var(--anka-ink)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--anka-focus)]">
              {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
            </select>
          </label>
        </div>
      </header>

      <main className="mx-auto max-w-7xl space-y-5">
        {error && <div className="rounded-xl border border-[var(--anka-danger)] bg-[var(--anka-danger-soft)] px-4 py-3 text-sm text-[var(--anka-danger)]">{error}</div>}
        {message && <div className="rounded-xl border border-[var(--anka-success)] bg-[var(--anka-success-soft)] px-4 py-3 text-sm text-[var(--anka-success)]">{message}</div>}
        {!workspace ? (
          <div className="workspace-card border-dashed px-6 py-16 text-center text-[var(--anka-muted)]">Create a project to begin its automatic living record.</div>
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
              <div className="flex flex-wrap gap-2">
                {['internal', 'client'].map((kind) => (
                  <button key={kind} type="button" onClick={() => setProjectionKind(kind)} aria-pressed={projectionKind === kind} className={`rounded-lg px-4 py-2 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-[var(--anka-focus)] ${projectionKind === kind ? 'bg-[var(--anka-violet)] text-[var(--anka-on-violet)]' : 'text-[var(--anka-muted)] hover:text-[var(--anka-ink)]'}`}>
                    {labelize(kind)} record
                  </button>
                ))}
              </div>
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={createSnapshot} disabled={saving || !canPreserveSnapshot} title={canPreserveSnapshot ? undefined : 'Snapshot preservation requires organization authority or assignment as project owner.'} className={BUTTON}>{saving ? 'Preserving…' : 'Preserve snapshot'}</button>
                <button type="button" onClick={() => exportProjection('markdown')} className={BUTTON}>Export Markdown</button>
                <button type="button" onClick={() => exportProjection('json')} className={BUTTON}>Export JSON</button>
                <button type="button" onClick={() => window.print()} className={BUTTON}>Print / Save PDF</button>
              </div>
            </div>

            {projectionKind === 'client' && (
              <div className="rounded-xl border border-[var(--anka-info)] bg-[var(--anka-surface-raised)] px-4 py-3 text-sm leading-6 text-[var(--anka-info)] print:hidden">
                This preview includes only client-visible milestones, released deliverable versions, client requests, and client-visible activity. It does not publish or approve anything.
              </div>
            )}

            <section className="workspace-card p-6">
              <p className="text-xs uppercase tracking-[0.15em] text-[var(--anka-muted)]">{labelize(projectionKind)} living record · source v{projection.source_version}</p>
              <h2 className="mt-2 text-3xl font-semibold text-[var(--anka-ink)]">{projection.project.name}</h2>
              <p className="mt-3 max-w-4xl whitespace-pre-wrap text-sm leading-6 text-[var(--anka-muted)]">{projection.project.summary || projection.project.description || 'No summary recorded.'}</p>
              <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <Metric label="Status" value={labelize(projection.project.status)} note={`Health: ${labelize(projection.project.health)}`} />
                <Metric label="Due" value={projection.project.due_date || 'Not set'} note="Engagement target" />
                <Metric label="Milestones" value={(projection.milestones || []).length} note={projectionKind === 'client' ? 'Client-visible' : 'All active'} />
                <Metric label="Deliverables" value={(projection.deliverables || []).length} note={projectionKind === 'client' ? 'Released only' : 'All active'} />
              </div>
            </section>

            <div className="grid gap-5 lg:grid-cols-2">
              <RecordSection title="Milestones"><StatusRows items={projection.milestones || []} empty="No milestones are available in this projection." titleKey="name" /></RecordSection>
              <RecordSection title="Deliverables"><StatusRows items={projection.deliverables || []} empty="No deliverables are available in this projection." /></RecordSection>
              <RecordSection title="Requests"><StatusRows items={projection.requests || []} empty="No requests are available in this projection." /></RecordSection>
              <RecordSection title="Snapshot history">
                <StatusRows
                  items={workspace.snapshots.map((snapshot) => ({
                    ...snapshot,
                    title: `${labelize(snapshot.projection_kind)} snapshot v${snapshot.source_version}`,
                    status: new Date(snapshot.generated_at).toLocaleDateString(),
                  }))}
                  empty="No immutable checkpoints have been preserved yet."
                />
              </RecordSection>
            </div>

            {projectionKind === 'internal' && (
              <div className="grid gap-5 lg:grid-cols-2">
                <RecordSection title="Research"><StatusRows items={projection.research || []} empty="No research records yet." /></RecordSection>
                <RecordSection title="Task ledger"><StatusRows items={projection.tasks || []} empty="No tasks yet." /></RecordSection>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  )
}
