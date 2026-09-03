function required(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new TypeError(`${label} is required`)
  return value
}

function withSignal(query, signal) {
  if (signal?.aborted) throw new DOMException('The request was aborted.', 'AbortError')
  return signal && typeof query?.abortSignal === 'function' ? query.abortSignal(signal) : query
}

async function dataOrThrow(query) {
  const { data, error, status } = await query
  if (!error) return data
  throw Object.assign(new Error(error.message || 'Reports and Records query failed'), {
    cause: error,
    status: status || error.status || error.statusCode || error.context?.status,
  })
}

function assertOrganizationRecords(organizationId, ...collections) {
  for (const collection of collections) {
    const records = Array.isArray(collection) ? collection : collection ? [collection] : []
    if (records.some((record) => record?.organization_id !== organizationId)) {
      throw Object.assign(new Error('The requested record is unavailable in the active organization.'), {
        status: 403,
        membershipMismatch: true,
      })
    }
  }
}

export function createReportsAndRecordsRepository(client) {
  if (!client?.from) throw new TypeError('A Supabase-compatible client is required')
  return Object.freeze({
    async listProjects(activeOrganizationId, { signal } = {}) {
      const organizationId = required(activeOrganizationId, 'organizationId')
      if (signal?.aborted) throw new DOMException('The request was aborted.', 'AbortError')
      const rows = await dataOrThrow(withSignal(client.from('projects')
        .select('id, organization_id, client_id, name, description, engagement_type, status, priority, health, owner_id, start_date, due_date, portal_visible, created_at, updated_at')
        .eq('organization_id', organizationId).is('archived_at', null)
        .order('updated_at', { ascending: false }), signal)) || []
      assertOrganizationRecords(organizationId, rows)
      return rows
    },

    async getProjectWorkspace(projectId, activeOrganizationId, { signal } = {}) {
      required(projectId, 'projectId')
      const organizationId = required(activeOrganizationId, 'organizationId')
      if (signal?.aborted) throw new DOMException('The request was aborted.', 'AbortError')
      const load = (query) => dataOrThrow(withSignal(query, signal))
      const scoped = (table) => client.from(table).select('*')
        .eq('organization_id', organizationId).eq('project_id', projectId)
      const [project, workstreams, milestones, tasks, dependencies, research, deliverables, requests, livingRecord, snapshots, activities, portalItems] = await Promise.all([
        load(client.from('projects').select('*').eq('organization_id', organizationId).eq('id', projectId).single()),
        load(scoped('workstreams').order('created_at')),
        load(scoped('milestones').is('archived_at', null).order('position')),
        load(scoped('tasks').is('archived_at', null).order('created_at')),
        load(scoped('task_dependencies').order('created_at')),
        load(scoped('research_records').is('archived_at', null).order('updated_at', { ascending: false })),
        load(client.from('deliverables').select('*, deliverable_versions(*)').eq('organization_id', organizationId).eq('project_id', projectId).is('archived_at', null).order('updated_at', { ascending: false })),
        load(scoped('requests').is('archived_at', null).order('updated_at', { ascending: false })),
        load(scoped('living_project_documents').single()),
        load(scoped('living_project_document_snapshots').order('generated_at', { ascending: false })),
        load(scoped('activity_events').order('occurred_at', { ascending: false }).limit(100)),
        load(scoped('client_portal_items').is('withdrawn_at', null).order('released_at', { ascending: false })),
      ])
      const versions = (deliverables || []).flatMap((item) => item.deliverable_versions || [])
      assertOrganizationRecords(organizationId, project, workstreams, milestones, tasks, dependencies, research, deliverables, versions, requests, livingRecord, snapshots, activities, portalItems)
      return { project, workstreams: workstreams || [], milestones: milestones || [], tasks: tasks || [], dependencies: dependencies || [], research: research || [], deliverables: deliverables || [], requests: requests || [], livingRecord, snapshots: snapshots || [], activities: activities || [], portalItems: portalItems || [] }
    },

    async createLivingRecordSnapshot(input, actorId, { signal } = {}) {
      const organizationId = required(input?.organizationId, 'organizationId')
      required(input?.projectId, 'projectId')
      required(input?.livingRecordId, 'livingRecordId')
      required(actorId, 'actorId')
      if (signal?.aborted) throw new DOMException('The request was aborted.', 'AbortError')
      if (!['internal', 'client'].includes(input.projectionKind)) throw new TypeError('Projection kind must be internal or client')
      if (!Number.isInteger(input.sourceVersion) || input.sourceVersion < 1) throw new TypeError('A positive source version is required')

      const existing = await dataOrThrow(withSignal(client.from('living_project_document_snapshots').select('*')
        .eq('organization_id', organizationId).eq('project_id', input.projectId)
        .eq('living_project_document_id', input.livingRecordId).eq('projection_kind', input.projectionKind)
        .eq('source_version', input.sourceVersion).limit(1), signal))
      if (existing?.[0]) {
        assertOrganizationRecords(organizationId, existing[0])
        return existing[0]
      }

      const projectionColumn = input.projectionKind === 'client' ? 'client_projection' : 'internal_projection'
      await dataOrThrow(withSignal(client.from('living_project_documents').update({
        [projectionColumn]: input.snapshot,
        generated_at: new Date().toISOString(),
      }).eq('organization_id', organizationId).eq('project_id', input.projectId).eq('id', input.livingRecordId), signal))

      const snapshot = await dataOrThrow(withSignal(client.from('living_project_document_snapshots').insert({
        organization_id: organizationId,
        living_project_document_id: input.livingRecordId,
        project_id: input.projectId,
        projection_kind: input.projectionKind,
        source_version: input.sourceVersion,
        snapshot: input.snapshot,
        reason: input.reason?.trim() || 'Manual reporting checkpoint',
        generated_by: actorId,
      }).select().single(), signal))
      assertOrganizationRecords(organizationId, snapshot)
      return snapshot
    },
  })
}
