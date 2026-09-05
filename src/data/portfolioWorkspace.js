import { fetchPortfolioWorkspaceSnapshot } from './portfolioWorkspaceRepository'
import { buildPortfolioWorkspace } from './portfolioWorkspaceModel'

export const portfolioWorkspace = {
  async getSnapshot(organizationId, options = {}) {
    return buildPortfolioWorkspace(await fetchPortfolioWorkspaceSnapshot(organizationId, { signal: options.signal }), options)
  },
}
