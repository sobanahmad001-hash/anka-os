import { fetchProjectEngagementSnapshot } from './projectEngagementWorkspaceRepository'
import { buildProjectEngagementWorkspace } from './projectEngagementWorkspaceModel'

export const projectEngagementWorkspace = {
  async get(projectId, options = {}) {
    return buildProjectEngagementWorkspace(await fetchProjectEngagementSnapshot(projectId), options)
  },
}
