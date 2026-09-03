// Inject the caller's RLS client; no privileged RPC or mutation is used by this review.
export function createRetainerReviewRepository(client) {
  async function all(table, scope, filters = [], order = ['id']) {
    const rows = []
    for (let offset = 0; ;) {
      scope.signal?.throwIfAborted()
      let query = client.from(table).select('*', { count: 'exact' }).eq('organization_id', scope.organizationId)
      for (const [key, value] of filters) query = query.eq(key, value)
      for (const key of order) query = query.order(key)
      if (scope.signal) query = query.abortSignal(scope.signal)
      const { data, error, status, count } = await query.range(offset, offset + 499)
      if (error) throw Object.assign(new Error(error.message || 'Unable to load retainer review.'), { code: error.code, status: error.status || status })
      if (!Array.isArray(data)) throw new Error('Incomplete retainer review response. Retry loading.')
      rows.push(...data)
      offset += data.length
      if (typeof count !== 'number') throw new Error('Unable to verify complete review results. Retry loading.')
      if (offset >= count) return rows
      if (!data.length) throw new Error('Review changed while loading. Retry loading.')
    }
  }
  return {
    async get(scope) {
      if (!scope.organizationId || !scope.projectId || !scope.engagementId || !scope.actorId) throw new Error('Select an organization and retainer before loading review.')
      const projects = await all('projects', scope, [['id', scope.projectId]])
      const project = projects.find(row => row.id === scope.projectId && row.organization_id === scope.organizationId)
      if (!project) throw new Error('Project unavailable in selected organization.')
      const engagements = await all('engagements', scope, [['id', scope.engagementId], ['project_id', scope.projectId]])
      const engagement = engagements.find(row => row.id === scope.engagementId && row.project_id === scope.projectId && row.organization_id === scope.organizationId)
      if (!engagement || !(project.engagement_type === 'retainer' || engagement.engagement_type === 'retainer')) throw new Error('Retainer unavailable in selected organization.')
      const plans = (await all('recurring_work_plans', scope, [['project_id', scope.projectId], ['engagement_id', scope.engagementId]]))
        .filter(row => row.organization_id === scope.organizationId && row.project_id === scope.projectId && row.engagement_id === scope.engagementId)
      const versions = [], approvals = [], templateItems = [], occurrences = []
      for (const plan of plans) {
        const filters = [['plan_id', plan.id]]
        const result = await Promise.all([
          all('recurring_work_plan_versions', scope, filters), all('recurring_work_plan_version_approvals', scope, filters),
          all('recurring_work_plan_template_items', scope, filters), all('recurring_work_occurrences', scope, filters),
        ])
        versions.push(...result[0]); approvals.push(...result[1]); templateItems.push(...result[2]); occurrences.push(...result[3])
      }
      const workItems = await all('work_items', scope, [['project_id', scope.projectId], ['engagement_id', scope.engagementId]])
      const dependencies = []
      // Dependency table has no engagement key; bound every query by a visible source item.
      for (const item of workItems.filter(row => row.organization_id === scope.organizationId && row.project_id === scope.projectId && row.engagement_id === scope.engagementId && row.created_via === 'recurring_plan' && !row.deleted_at)) {
        dependencies.push(...await all('work_item_dependencies', scope, [['work_item_id', item.id]], ['work_item_id', 'depends_on_work_item_id']))
      }
      const services = await all('engagement_services', scope, [['engagement_id', scope.engagementId]])
      for (const service of services) {
        const catalog = await all('service_catalog', scope, [['id', service.service_id]])
        service.catalog_active = catalog.some(row => row.organization_id === scope.organizationId && row.id === service.service_id && row.is_active === true)
      }
      return { project, engagement, plans, versions, approvals, templateItems, occurrences, workItems, dependencies, services }
    },
  }
}
