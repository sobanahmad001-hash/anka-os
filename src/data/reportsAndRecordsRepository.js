const PAGE_SIZE = 500
const MAX_PAGES = 10000

function required(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new TypeError(`${label} is required`)
  return value
}
function aborted() { return Object.assign(new Error('Reports and Records request aborted'), { name: 'AbortError' }) }
function scoped(message = 'The requested record is unavailable in the active organization.') {
  return Object.assign(new Error(message), { status: 403, membershipMismatch: true })
}
function withSignal(query, signal) {
  if (signal?.aborted) throw aborted()
  return signal && typeof query?.abortSignal === 'function' ? query.abortSignal(signal) : query
}
async function dataOrThrow(query) {
  const { data, error, status } = await query
  if (!error) return data
  throw Object.assign(new Error(error.message || 'Reports and Records query failed'), {
    cause: error, status: status || error.status || error.statusCode || error.context?.status,
  })
}
function assertOrg(organizationId, ...collections) {
  for (const collection of collections) {
    const rows = Array.isArray(collection) ? collection : collection ? [collection] : []
    if (rows.some((row) => row?.organization_id !== organizationId)) throw scoped()
  }
}
function sortRows(rows, ...orders) {
  return [...rows].sort((a, b) => {
    for (const [field, ascending] of orders) {
      const compared = String(a[field] ?? '').localeCompare(String(b[field] ?? ''))
      if (compared) return ascending ? compared : -compared
    }
    return String(a.id).localeCompare(String(b.id))
  })
}
async function collectPages(fetchPage, { name, organizationId, projectId, signal }) {
  const byId = new Map()
  let cursor = null
  for (let page = 0; page < MAX_PAGES; page += 1) {
    if (signal?.aborted) throw aborted()
    const rows = await dataOrThrow(withSignal(fetchPage(cursor), signal)) || []
    if (signal?.aborted) throw aborted()
    let next = cursor
    for (const row of rows) {
      if (!row?.id || row.organization_id !== organizationId || (projectId && row.project_id !== projectId)) {
        throw scoped(`${name} returned a record outside the active project scope.`)
      }
      if (next && row.id < next) throw scoped(`${name} did not preserve stable ID order.`)
      const prior = byId.get(row.id)
      if (prior && JSON.stringify(prior) !== JSON.stringify(row)) {
        throw Object.assign(new Error(`${name} changed while the report was loading.`), { status: 409 })
      }
      if (!prior) byId.set(row.id, row)
      next = row.id
    }
    if (rows.length < PAGE_SIZE) return [...byId.values()]
    if (!next || next === cursor) throw Object.assign(new Error(`${name} pagination did not advance.`), { status: 409 })
    cursor = next
  }
  throw Object.assign(new Error(`${name} exceeded the safe pagination limit.`), { status: 409 })
}

export function createReportsAndRecordsRepository(client) {
  if (!client?.from || !client?.rpc) throw new TypeError('A Supabase-compatible client is required')
  const page = (table, columns, organizationId, projectId, { signal, filter } = {}) =>
    collectPages((cursor) => {
      let query = client.from(table).select(columns).eq('organization_id', organizationId)
      if (projectId) query = query.eq('project_id', projectId)
      if (filter) query = filter(query)
      if (cursor) query = query.gt('id', cursor)
      return query.order('id', { ascending: true }).limit(PAGE_SIZE)
    }, { name: table, organizationId, projectId, signal })

  return Object.freeze({
    async listProjects(activeOrganizationId, { signal } = {}) {
      const org = required(activeOrganizationId, 'organizationId')
      const rows = await page('projects', 'id, organization_id, client_id, name, description, engagement_type, status, priority, health, owner_id, start_date, due_date, portal_visible, created_at, updated_at', org, null, {
        signal, filter: (query) => query.is('archived_at', null),
      })
      return sortRows(rows, ['updated_at', false])
    },
    async getProjectWorkspace(projectId, activeOrganizationId, { signal } = {}) {
      required(projectId, 'projectId')
      const org = required(activeOrganizationId, 'organizationId')
      if (signal?.aborted) throw aborted()
      const load = (query) => dataOrThrow(withSignal(query, signal))
      const singleton = (table) => client.from(table).select('*').eq('organization_id', org).eq('project_id', projectId).single()
      const [project, workstreams, milestones, tasks, dependencies, research, deliverables, versions, requests, livingRecord, snapshots, activities, portalItems] = await Promise.all([
        load(client.from('projects').select('*').eq('organization_id', org).eq('id', projectId).single()),
        page('workstreams', '*', org, projectId, { signal }),
        page('milestones', '*', org, projectId, { signal, filter: (q) => q.is('archived_at', null) }),
        page('tasks', '*', org, projectId, { signal, filter: (q) => q.is('archived_at', null) }),
        page('task_dependencies', '*', org, null, { signal }),
        page('research_records', '*', org, projectId, { signal, filter: (q) => q.is('archived_at', null) }),
        page('deliverables', '*', org, projectId, { signal, filter: (q) => q.is('archived_at', null) }),
        page('deliverable_versions', '*', org, projectId, { signal }),
        page('requests', '*', org, projectId, { signal, filter: (q) => q.is('archived_at', null) }),
        load(singleton('living_project_documents')),
        page('living_project_document_snapshots', '*', org, projectId, { signal }),
        load(client.from('activity_events').select('*').eq('organization_id', org).eq('project_id', projectId)
          .order('occurred_at', { ascending: false }).order('id', { ascending: false }).limit(100)),
        page('client_portal_items', '*', org, projectId, { signal, filter: (q) => q.is('withdrawn_at', null) }),
      ])
      assertOrg(org, project, livingRecord, activities)
      if (project?.id !== projectId || livingRecord?.project_id !== projectId) throw scoped()
      const taskIds = new Set(tasks.map((row) => row.id))
      const projectDependencies = dependencies.filter((row) => taskIds.has(row.task_id) && taskIds.has(row.depends_on_task_id))
      const deliverableById = new Map(deliverables.map((row) => [row.id, { ...row, deliverable_versions: [] }]))
      for (const version of versions) {
        const parent = deliverableById.get(version.deliverable_id)
        if (!parent) throw scoped('A deliverable version does not belong to an active deliverable in this project.')
        parent.deliverable_versions.push(version)
      }
      for (const snapshot of snapshots) {
        if (snapshot.living_project_document_id !== livingRecord.id) throw scoped('Snapshot history does not belong to this living project document.')
      }
      const grouped = [...deliverableById.values()].map((row) => ({
        ...row, deliverable_versions: sortRows(row.deliverable_versions, ['version_number', true]),
      }))
      return {
        project,
        workstreams: sortRows(workstreams, ['created_at', true]),
        milestones: sortRows(milestones, ['position', true]),
        tasks: sortRows(tasks, ['created_at', true]),
        dependencies: sortRows(projectDependencies, ['created_at', true]),
        research: sortRows(research, ['updated_at', false]),
        deliverables: sortRows(grouped, ['updated_at', false]),
        requests: sortRows(requests, ['updated_at', false]),
        livingRecord,
        snapshots: sortRows(snapshots, ['generated_at', false]),
        activities: activities || [],
        portalItems: sortRows(portalItems, ['released_at', false]),
      }
    },
    async createLivingRecordSnapshot(input, { signal } = {}) {
      const org = required(input?.organizationId, 'organizationId')
      const projectId = required(input?.projectId, 'projectId')
      const documentId = required(input?.livingRecordId, 'livingRecordId')
      const requestId = required(input?.requestId, 'requestId')
      if (!['internal', 'client'].includes(input.projectionKind)) throw new TypeError('Projection kind must be internal or client')
      if (!Number.isInteger(input.sourceVersion) || input.sourceVersion < 1) throw new TypeError('A positive source version is required')
      if (signal?.aborted) throw aborted()
      const data = await dataOrThrow(withSignal(client.rpc('preserve_living_project_snapshot', {
        p_organization_id: org, p_project_id: projectId, p_living_project_document_id: documentId,
        p_projection_kind: input.projectionKind, p_expected_source_version: input.sourceVersion,
        p_request_id: requestId, p_reason: input.reason?.trim() || 'Manual reporting checkpoint',
      }), signal))
      if (signal?.aborted) throw aborted()
      const snapshot = data?.snapshot || data
      assertOrg(org, snapshot)
      if (snapshot?.project_id !== projectId || snapshot?.living_project_document_id !== documentId) throw scoped()
      return snapshot
    },
  })
}
