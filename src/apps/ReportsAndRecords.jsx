import { useEffect, useMemo, useRef, useState } from 'react'

import { useAuth } from '../context/AuthContext.jsx'
import { useOrganization } from '../context/OrganizationContext.jsx'
import {
  buildClientProjectProjection,
  buildInternalProjectProjection,
  projectProjectionToMarkdown,
} from '../data/livingProjectRecord.js'
import { createReportsAndRecordsRepository } from '../data/reportsAndRecordsRepository.js'
import { runReportsSnapshotOperation } from '../data/reportsAndRecordsOperation.js'
import { supabase } from '../lib/supabase.js'

const reportsAndRecords = createReportsAndRecordsRepository(supabase)

const BUTTON = 'rounded-xl border border-slate-700 px-3.5 py-2 text-sm font-medium text-slate-200 transition hover:border-purple-500 hover:text-white disabled:cursor-not-allowed disabled:opacity-50'

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
    <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
      <p className="text-xs font-medium uppercase tracking-[0.12em] text-slate-500">{label}</p>
      <p className="mt-2 text-2xl font-semibold text-white">{value}</p>
      <p className="mt-1 text-xs text-slate-500">{note}</p>
    </div>
  )
}

function RecordSection({ title, children }) {
  return (
    <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
      <h2 className="text-base font-semibold text-white">{title}</h2>
      <div className="mt-4">{children}</div>
    </section>
  )
}

function StatusRows({ items, empty, titleKey = 'title' }) {
  if (!items.length) return <p className="text-sm text-slate-500">{empty}</p>
  return (
    <div className="space-y-2">
      {items.map((item, index) => (
        <div key={item.id || `${item[titleKey]}-${index}`} className="flex items-center justify-between gap-4 rounded-xl border border-slate-800 bg-slate-950/50 px-4 py-3">
          <div>
            <p className="text-sm font-medium text-slate-100">{item[titleKey]}</p>
            {(item.due_date || item.target_date) && <p className="mt-1 text-xs text-slate-500">Target {item.due_date || item.target_date}</p>}
          </div>
          <span className="rounded-full bg-slate-800 px-2.5 py-1 text-xs text-slate-300">{labelize(item.status)}</span>
        </div>
      ))}
    </div>
  )
}

export default function ReportsAndRecords() {
  const { user } = useAuth()
  const { activeOrganizationId, scopeRevision, handleOrganizationAccessError } = useOrganization()
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

  async function createSnapshot() {
    if (!workspace?.livingRecord?.id || !projection || !user?.id || !activeOrganizationId) return
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
    return <div className="flex h-full items-center justify-center bg-slate-950 text-slate-400">Preparing project records…</div>
  }

  return (
    <div className="h-full overflow-y-auto bg-slate-950 text-white">
      <header className="border-b border-slate-800 bg-slate-950/95 px-6 py-5 print:border-0">
        <div className="mx-auto flex max-w-7xl flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-purple-400">Delivery intelligence</p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight">Reports & Living Records</h1>
            <p className="mt-2 max-w-3xl text-sm text-slate-400">Versioned project truth generated from canonical work. Client records contain released information only. Recent activity is a bounded feed, not a complete event record.</p>
          </div>
          <label className="min-w-64 text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">
            Project
            <select value={projectId} onChange={(event) => setProjectId(event.target.value)} className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-900 px-3.5 py-2.5 text-sm font-medium normal-case tracking-normal text-white outline-none focus:border-purple-500">
              {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
            </select>
          </label>
        </div>
      </header>

      <main className="mx-auto max-w-7xl space-y-5 px-6 py-6">
        {error && <div className="rounded-xl border border-red-900/60 bg-red-950/50 px-4 py-3 text-sm text-red-300">{error}</div>}
        {message && <div className="rounded-xl border border-emerald-900/60 bg-emerald-950/40 px-4 py-3 text-sm text-emerald-300">{message}</div>}
        {!workspace ? (
          <div className="rounded-2xl border border-dashed border-slate-700 px-6 py-16 text-center text-slate-500">Create a project to begin its automatic living record.</div>
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
              <div className="flex rounded-xl border border-slate-800 bg-slate-900 p-1">
                {['internal', 'client'].map((kind) => (
                  <button key={kind} type="button" onClick={() => setProjectionKind(kind)} className={`rounded-lg px-4 py-2 text-sm font-medium ${projectionKind === kind ? 'bg-purple-600 text-white' : 'text-slate-400 hover:text-white'}`}>
                    {labelize(kind)} record
                  </button>
                ))}
              </div>
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={createSnapshot} disabled={saving} className={BUTTON}>{saving ? 'Preserving…' : 'Preserve snapshot'}</button>
                <button type="button" onClick={() => exportProjection('markdown')} className={BUTTON}>Export Markdown</button>
                <button type="button" onClick={() => exportProjection('json')} className={BUTTON}>Export JSON</button>
                <button type="button" onClick={() => window.print()} className={BUTTON}>Print / Save PDF</button>
              </div>
            </div>

            {projectionKind === 'client' && (
              <div className="rounded-xl border border-blue-900/60 bg-blue-950/30 px-4 py-3 text-sm leading-6 text-blue-200 print:hidden">
                This preview includes only client-visible milestones, released deliverable versions, client requests, and client-visible activity. It does not publish or approve anything.
              </div>
            )}

            <section className="rounded-2xl border border-slate-800 bg-gradient-to-br from-slate-900 to-slate-950 p-6">
              <p className="text-xs uppercase tracking-[0.15em] text-slate-500">{labelize(projectionKind)} living record · source v{projection.source_version}</p>
              <h2 className="mt-2 text-3xl font-semibold">{projection.project.name}</h2>
              <p className="mt-3 max-w-4xl whitespace-pre-wrap text-sm leading-6 text-slate-400">{projection.project.summary || projection.project.description || 'No summary recorded.'}</p>
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
