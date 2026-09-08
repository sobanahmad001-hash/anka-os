import { workspaceHomeRepository } from './workspaceHomeRepository.js'
import { buildWorkspaceHome } from './workspaceHomeModel.js'

export const workspaceHome = Object.freeze({
  forOrganization(organizationId, options = {}) {
    const repository = workspaceHomeRepository.forOrganization(organizationId, options)
    return Object.freeze({
      async getSnapshot(modelOptions = {}) {
        return buildWorkspaceHome(await repository.getSnapshot(), { organizationId, ...modelOptions })
      },
    })
  },
})
