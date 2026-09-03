import { buildInternalWorkspace } from './internalWorkspaceModel'
import { fetchInternalWorkspaceSnapshot } from './internalWorkspaceRepository'

export const internalWorkspace = {
  async get(options = {}) {
    return buildInternalWorkspace(await fetchInternalWorkspaceSnapshot(), options)
  },
}
