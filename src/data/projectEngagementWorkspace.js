import { fetchProjectEngagementSnapshot } from './projectEngagementWorkspaceRepository'
import { buildProjectEngagementWorkspace } from './projectEngagementWorkspaceModel'

export const projectEngagementWorkspace = {
  async get(projectId, organizationId, options = {}) {
    return buildProjectEngagementWorkspace(await fetchProjectEngagementSnapshot(projectId, organizationId, { signal: options.signal }), options)
  },
}
