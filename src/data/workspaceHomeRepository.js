import { supabase } from '../lib/supabase.js'

async function dataOrThrow(query, name, signal) {
  if (signal && typeof query.abortSignal === 'function') query = query.abortSignal(signal)
  const { data, error } = await query
  if (error) throw Object.assign(new Error(`Unable to load Workspace Home ${name}: ${error.message}`), {
    status: error.status || error.statusCode,
  })
  return data || []
}

export function createWorkspaceHomeScope(organizationId, { signal } = {}) {
  if (!organizationId) throw new TypeError('Active organization is required')
  const scoped = (table, columns) => supabase.from(table).select(columns).eq('organization_id', organizationId)

  return Object.freeze({
    organizationId,
    async getSnapshot() {
      const entries = [
        ['projects', scoped('projects', 'id, organization_id, client_id, name, engagement_type, status, health, owner_id, due_date, archived_at').is('archived_at', null)],
        ['engagements', scoped('engagements', 'id, organization_id, project_id, status')],
        ['tasks', scoped('tasks', 'id, organization_id, project_id, title, department_id, status, priority, assigned_to, due_date, archived_at').is('archived_at', null)],
        ['workItems', scoped('work_items', 'id, organization_id, project_id, engagement_id, title, department_id, status, priority, assignee_id, due_date, deleted_at').is('deleted_at', null)],
        ['versions', scoped('deliverable_versions', 'id, organization_id, project_id, deliverable_id, title, version_number, review_status, created_at, withdrawn_at').is('withdrawn_at', null).in('review_status', ['ready_for_internal_review', 'ready_for_client_review'])],
        ['activities', scoped('activity_events', 'id, organization_id, project_id, action, target_type, target_id, metadata, occurred_at').order('occurred_at', { ascending: false }).limit(40)],
      ]
      const values = await Promise.all(entries.map(([name, query]) => dataOrThrow(query, name, signal)))
      return Object.fromEntries(entries.map(([name], index) => [name, values[index]]))
    },
  })
}

export const workspaceHomeRepository = Object.freeze({ forOrganization: createWorkspaceHomeScope })
