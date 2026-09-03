import { buildClientWorkDirectory } from './clientWorkDirectoryModel'
import { fetchClientWorkDirectorySnapshot } from './clientWorkDirectoryRepository'

export const clientWorkDirectory = {
  async get(organizationId, options = {}) {
    return buildClientWorkDirectory(await fetchClientWorkDirectorySnapshot(organizationId, { signal: options.signal }), options)
  },
}
