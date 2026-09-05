import { buildInternalWorkspace } from './internalWorkspaceModel'
import { fetchInternalWorkspaceSnapshot } from './internalWorkspaceRepository'

export const internalWorkspace = {
  async get(organizationId, options = {}) {
    return buildInternalWorkspace(await fetchInternalWorkspaceSnapshot(organizationId, { signal: options.signal }), options)
  },
}
