import { collectDirectoryPages, directoryAbortError } from './workspaceDirectoryPagination.js'

async function dataOrThrow(query, name, signal) {
  if (signal && typeof query.abortSignal === 'function') query = query.abortSignal(signal)
  const { data, error, status } = await query
  if (error) throw Object.assign(new Error(`Unable to load Workspace Home ${name}: ${error.message}`), {
    status: status || error.status || error.statusCode,
  })
  return data || []
}

export function createWorkspaceHomeRepository(client) {
  if (!client?.from) throw new TypeError('A Supabase-compatible client is required')
  return Object.freeze({
    forOrganization(organizationId, { signal } = {}) {
      if (!organizationId || typeof organizationId !== 'string' || !organizationId.trim()) throw new TypeError('Active organization is required')
      const scoped = (table, columns) => client.from(table).select(columns).eq('organization_id', organizationId)
      const all = (table, columns, configure = query => query) => collectDirectoryPages((from, to) => {
        let query = configure(scoped(table, columns)).order('id').range(from, to)
        if (signal && typeof query.abortSignal === 'function') query = query.abortSignal(signal)
        return query
      }, {
        name: `Workspace Home ${table}`,
        signal,
        validate: row => row.organization_id === organizationId,
      })

      return Object.freeze({
        organizationId,
        async getSnapshot() {
          if (signal?.aborted) throw directoryAbortError()
          const entries = [
            ['projects', all('projects', 'id, organization_id, client_id, name, engagement_type, status, health, owner_id, due_date, archived_at', query => query.is('archived_at', null))],
            ['engagements', all('engagements', 'id, organization_id, project_id, status')],
            ['tasks', all('tasks', 'id, organization_id, project_id, title, department_id, status, priority, assigned_to, due_date, archived_at', query => query.is('archived_at', null))],
            ['workItems', all('work_items', 'id, organization_id, project_id, engagement_id, title, department_id, status, priority, assignee_id, due_date, deleted_at', query => query.is('deleted_at', null))],
            ['versions', all('deliverable_versions', 'id, organization_id, project_id, deliverable_id, title, version_number, review_status, created_at, withdrawn_at', query => query.is('withdrawn_at', null).in('review_status', ['ready_for_internal_review', 'ready_for_client_review']))],
            ['activities', scoped('activity_events', 'id, organization_id, project_id, action, target_type, target_id, metadata, occurred_at').order('occurred_at', { ascending: false }).order('id').limit(40)],
          ]
          const values = await Promise.all(entries.map(([name, query]) => name === 'activities' ? dataOrThrow(query, name, signal) : query))
          if (signal?.aborted) throw directoryAbortError()
          return Object.fromEntries(entries.map(([name], index) => [name, values[index]]))
        },
      })
    },
  })
}
