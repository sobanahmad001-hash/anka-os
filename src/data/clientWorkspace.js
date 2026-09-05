import { buildClientWorkspace } from './clientWorkspaceModel'
import { fetchClientWorkspaceSnapshot } from './clientWorkspaceRepository'

export const clientWorkspace = {
  async get(clientId, organizationId, options = {}) {
    return buildClientWorkspace(await fetchClientWorkspaceSnapshot(clientId, organizationId, { signal: options.signal }), options)
  },
}
