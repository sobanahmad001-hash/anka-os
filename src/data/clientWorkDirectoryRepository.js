import { supabase } from '../lib/supabase.js'
import { collectDirectoryPages, directoryAbortError } from './workspaceDirectoryPagination.js'

const ORDER = {
  clients: [['company'], ['id']],
  agencyClients: [['canonical_client_id'], ['id']],
  brands: [['name'], ['id']],
  projects: [['updated_at', { ascending: false }], ['id']],
  engagements: [['project_id'], ['id']],
  tasks: [['project_id'], ['id']],
  workItems: [['project_id'], ['id']],
  memberships: [['user_id']],
  profiles: [['id']],
}

function ordered(query, order) {
  return order.reduce((current, [column, options]) => current.order(column, options), query)
}

export function createClientWorkDirectoryRepository(client) {
  return {
    async getSnapshot(organizationId, { signal } = {}) {
      if (typeof organizationId !== 'string' || !organizationId.trim()) throw new TypeError('organizationId is required')
      if (signal?.aborted) throw directoryAbortError()
      const page = (table, columns, name, configure = (query) => query) => collectDirectoryPages((from, to) => {
        let query = client.from(table).select(columns).eq('organization_id', organizationId)
        query = configure(query)
        return ordered(query, ORDER[name]).range(from, to).abortSignal(signal)
      }, { name: 'Client Work ' + name, signal, validate: (row) => row.organization_id === organizationId })

      const memberships = await collectDirectoryPages((from, to) => ordered(
        client.from('organization_memberships').select('organization_id, user_id')
          .eq('organization_id', organizationId).eq('member_kind', 'team').eq('status', 'active'),
        ORDER.memberships
      ).range(from, to).abortSignal(signal), {
        name: 'Client Work memberships', signal,
        validate: (row) => row.organization_id === organizationId,
        key: (row) => row.user_id,
      })
      const memberIds = [...new Set(memberships.map((row) => row.user_id).filter(Boolean))].sort()
      const profiles = memberIds.length ? await collectDirectoryPages((from, to) => ordered(
        client.from('profiles').select('id, full_name, email').in('id', memberIds), ORDER.profiles
      ).range(from, to).abortSignal(signal), {
        name: 'Client Work profiles', signal, validate: (row) => memberIds.includes(row.id),
      }) : []

      const entries = await Promise.all([
        page('clients', 'id, organization_id, name, company, industry, status, owner_id, updated_at', 'clients'),
        page('agency_clients', 'id, organization_id, canonical_client_id, name, legal_name, status, owner_id', 'agencyClients'),
        page('brands', 'id, organization_id, client_id, name, status, is_default', 'brands'),
        page('projects', 'id, organization_id, client_id, name, engagement_type, status, health, owner_id, due_date, archived_at, updated_at', 'projects', (query) => query.is('archived_at', null)),
        page('engagements', 'id, organization_id, client_id, brand_id, project_id, status', 'engagements'),
        page('tasks', 'id, organization_id, project_id, status, archived_at', 'tasks', (query) => query.is('archived_at', null)),
        page('work_items', 'id, organization_id, project_id, engagement_id, status, deleted_at', 'workItems', (query) => query.is('deleted_at', null)),
      ])
      const names = ['clients', 'agencyClients', 'brands', 'projects', 'engagements', 'tasks', 'workItems']
      return { organizationId, memberships, profiles, ...Object.fromEntries(names.map((name, index) => [name, entries[index]])) }
    },
  }
}

const repository = createClientWorkDirectoryRepository(supabase)
export const fetchClientWorkDirectorySnapshot = (...args) => repository.getSnapshot(...args)
