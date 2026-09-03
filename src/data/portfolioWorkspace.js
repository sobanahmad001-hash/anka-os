import { fetchPortfolioWorkspaceSnapshot } from './portfolioWorkspaceRepository'
import { buildPortfolioWorkspace } from './portfolioWorkspaceModel'

export const portfolioWorkspace = {
  async getSnapshot(options = {}) {
    return buildPortfolioWorkspace(await fetchPortfolioWorkspaceSnapshot(), options)
  },
}
