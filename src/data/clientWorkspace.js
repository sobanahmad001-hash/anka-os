import { buildClientWorkspace } from './clientWorkspaceModel'
import { fetchClientWorkspaceSnapshot } from './clientWorkspaceRepository'

export const clientWorkspace = {
  async get(clientId, options = {}) {
    return buildClientWorkspace(await fetchClientWorkspaceSnapshot(clientId), options)
  },
}
