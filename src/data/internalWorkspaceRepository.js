import { supabase } from '../lib/supabase.js'

const DIRECTORY_PAGE_SIZE = 500
const MAX_DIRECTORY_PAGES = 10000
const directoryAbortError = () => Object.assign(new Error('Workspace directory request aborted'), { name: 'AbortError' })
async function collectDirectoryPages(fetchPage, { name, signal, validate = () => true, key = (row) => row?.id } = {}) {
  const byId = new Map()
  for (let page = 0; page < MAX_DIRECTORY_PAGES; page += 1) {
    if (signal?.aborted) throw directoryAbortError()
    const result = await fetchPage(page * DIRECTORY_PAGE_SIZE, (page + 1) * DIRECTORY_PAGE_SIZE - 1)
    if (result.error) throw Object.assign(new Error('Unable to load ' + name + ': ' + result.error.message), {
      cause: result.error, status: result.status || result.error.status || result.error.statusCode,
    })
    if (signal?.aborted) throw directoryAbortError()
    const rows = result.data || []
    for (const row of rows) {
      const rowKey = key(row)
      if (!rowKey || !validate(row)) throw Object.assign(new Error(name + ' returned a record outside the active organization scope.'), { status: 403, membershipMismatch: true })
      const previous = byId.get(rowKey)
      if (previous && JSON.stringify(previous) !== JSON.stringify(row)) throw Object.assign(new Error(name + ' changed while the directory was loading.'), { status: 409, membershipMismatch: true })
      if (!previous) byId.set(rowKey, row)
    }
    if (rows.length < DIRECTORY_PAGE_SIZE) return [...byId.values()]
  }
  throw Object.assign(new Error(name + ' exceeded the safe pagination limit.'), { status: 409 })
}

const ORDER = {
  projects: [['updated_at', { ascending: false }], ['id']],
  engagements: [['project_id'], ['id']],
  workstreams: [['created_at'], ['id']],
  tasks: [['due_date', { nullsFirst: false }], ['id']],
  workItems: [['due_date', { nullsFirst: false }], ['id']],
  milestones: [['target_date', { nullsFirst: false }], ['id']],
  requests: [['required_by', { nullsFirst: false }], ['id']],
  deliverables: [['due_date', { nullsFirst: false }], ['id']],
  activity: [['occurred_at', { ascending: false }], ['id']],
  livingRecords: [['project_id'], ['id']],
  memberships: [['user_id']],
  profiles: [['id']],
}

function ordered(query, order) {
  return order.reduce((current, [column, options]) => current.order(column, options), query)
}

export function createInternalWorkspaceRepository(client) {
  return {
    async getSnapshot(organizationId, { signal } = {}) {
      if (typeof organizationId !== 'string' || !organizationId.trim()) throw new TypeError('organizationId is required')
      if (signal?.aborted) throw directoryAbortError()
      const page = (table, columns, name, configure = (query) => query) => collectDirectoryPages((from, to) => {
        let query = client.from(table).select(columns).eq('organization_id', organizationId)
        query = configure(query)
        return ordered(query, ORDER[name]).range(from, to).abortSignal(signal)
      }, { name: 'Internal Work ' + name, signal, validate: (row) => row.organization_id === organizationId })

      const projects = await page('projects', 'id, organization_id, client_id, name, description, engagement_type, status, priority, health, owner_id, start_date, due_date, progress, scope_statement, exclusions, archived_at, updated_at', 'projects',
        (query) => query.eq('engagement_type', 'internal').is('archived_at', null))
      if (!projects.length) return { projects, engagements: [], workstreams: [], tasks: [], workItems: [], milestones: [], requests: [], deliverables: [], activity: [], livingRecords: [], memberships: [], profiles: [] }

      const memberships = await collectDirectoryPages((from, to) => ordered(
        client.from('organization_memberships').select('organization_id, user_id')
          .eq('organization_id', organizationId).eq('member_kind', 'team').eq('status', 'active'),
        ORDER.memberships
      ).range(from, to).abortSignal(signal), {
        name: 'Internal Work memberships', signal,
        validate: (row) => row.organization_id === organizationId,
        key: (row) => row.user_id,
      })
      const memberIds = [...new Set(memberships.map((row) => row.user_id).filter(Boolean))].sort()
      const profiles = memberIds.length ? await collectDirectoryPages((from, to) => ordered(
        client.from('profiles').select('id, full_name, email').in('id', memberIds), ORDER.profiles
      ).range(from, to).abortSignal(signal), {
        name: 'Internal Work profiles', signal, validate: (row) => memberIds.includes(row.id),
      }) : []

      const entries = await Promise.all([
        page('engagements', 'id, organization_id, project_id, status', 'engagements'),
        page('workstreams', 'id, organization_id, project_id, department_id, name, status, owner_id, client_visible, created_at', 'workstreams'),
        page('tasks', 'id, organization_id, project_id, workstream_id, department_id, title, description, status, priority, assigned_to, due_date, archived_at', 'tasks', (query) => query.is('archived_at', null)),
        page('work_items', 'id, organization_id, project_id, engagement_id, department_id, title, description, status, priority, assignee_id, due_date, deleted_at', 'workItems', (query) => query.is('deleted_at', null)),
        page('milestones', 'id, organization_id, project_id, name, description, status, owner_id, target_date, archived_at', 'milestones', (query) => query.is('archived_at', null)),
        page('requests', 'id, organization_id, project_id, title, request_type, request_origin, status, priority, owner_id, required_by, archived_at', 'requests', (query) => query.is('archived_at', null)),
        page('deliverables', 'id, organization_id, project_id, workstream_id, title, description, deliverable_type, status, owner_id, due_date, archived_at', 'deliverables', (query) => query.is('archived_at', null)),
        page('activity_events', 'id, organization_id, project_id, actor_id, action, target_type, target_id, metadata, occurred_at', 'activity'),
        page('living_project_documents', 'id, organization_id, project_id, source_version, generated_at, updated_at', 'livingRecords'),
      ])
      const names = ['engagements', 'workstreams', 'tasks', 'workItems', 'milestones', 'requests', 'deliverables', 'activity', 'livingRecords']
      return { projects, memberships, profiles, ...Object.fromEntries(names.map((name, index) => [name, entries[index]])) }
    },
  }
}

const repository = createInternalWorkspaceRepository(supabase)
export const fetchInternalWorkspaceSnapshot = (...args) => repository.getSnapshot(...args)
