import { useState, useEffect } from 'react'
import { fetchPullRequests, fetchBranches, fetchCommits, fetchRepoInfo } from '../lib/github'
import Card from '../components/Card'
import Badge from '../components/Badge'
import EmptyState from '../components/EmptyState'
import LoadingSkeleton from '../components/LoadingSkeleton'

export default function GitIntegration() {
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState('prs')
  const [data, setData] = useState({
    prs: [],
    branches: [],
    commits: [],
    repoInfo: null
  })
  
  useEffect(() => {
    loadGitHubData()
  }, [])
  
  async function loadGitHubData() {
    setLoading(true)
    const [prs, branches, commits, repoInfo] = await Promise.all([
      fetchPullRequests(),
      fetchBranches(),
      fetchCommits('main', 30),
      fetchRepoInfo()
    ])
    setData({ prs, branches, commits, repoInfo })
    setLoading(false)
  }
  
  if (loading) {
    return <LoadingSkeleton type="card" count={3} />
  }
  
  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Git Integration</h1>
          {data.repoInfo && (
            <div className="flex items-center gap-4 mt-2 text-sm text-gray-600 dark:text-gray-400">
              <a href={data.repoInfo.url} target="_blank" rel="noopener noreferrer" className="hover:text-blue-600">
                {data.repoInfo.full_name}
              </a>
              <span>⭐ {data.repoInfo.stars}</span>
              <Badge variant="default" size="sm">{data.repoInfo.language}</Badge>
            </div>
          )}
        </div>
        <button onClick={loadGitHubData} className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">
          🔄 Refresh
        </button>
      </div>
      
      <div className="flex gap-2 border-b border-gray-200 dark:border-gray-700">
        {[
          { id: 'prs', label: 'Pull Requests', count: data.prs.length },
          { id: 'branches', label: 'Branches', count: data.branches.length },
          { id: 'commits', label: 'Commits', count: data.commits.length }
        ].map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-2 font-medium ${
              activeTab === tab.id
                ? 'border-b-2 border-blue-600 text-blue-600'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            {tab.label} ({tab.count})
          </button>
        ))}
      </div>
      
      {activeTab === 'prs' && <PRsView prs={data.prs} />}
      {activeTab === 'branches' && <BranchesView branches={data.branches} />}
      {activeTab === 'commits' && <CommitsView commits={data.commits} />}
    </div>
  )
}

function PRsView({ prs }) {
  if (prs.length === 0) {
    return <EmptyState icon="🔀" title="No pull requests" />
  }
  
  return (
    <div className="space-y-3">
      {prs.map(pr => (
        <Card key={pr.id}>
          <div className="flex items-start gap-4">
            <img src={pr.avatar} alt={pr.author} className="w-10 h-10 rounded-full" />
            <div className="flex-1">
              <div className="flex items-start justify-between">
                <a href={pr.url} target="_blank" rel="noopener noreferrer" className="font-medium hover:text-blue-600">
                  {pr.title}
                </a>
                <Badge variant={pr.merged ? 'success' : pr.state === 'open' ? 'primary' : 'default'}>
                  {pr.merged ? 'Merged' : pr.state}
                </Badge>
              </div>
              <p className="text-sm text-gray-600 mt-1">
                #{pr.number} by {pr.author} • {pr.head_branch} → {pr.base_branch}
              </p>
            </div>
          </div>
        </Card>
      ))}
    </div>
  )
}

function BranchesView({ branches }) {
  return (
    <div className="space-y-3">
      {branches.map(branch => (
        <Card key={branch.name}>
          <div className="flex items-center justify-between">
            <div>
              <p className="font-medium">{branch.name}</p>
              <p className="text-xs text-gray-500 font-mono">{branch.commit_sha.slice(0, 7)}</p>
            </div>
            {branch.protected && <Badge variant="warning">Protected</Badge>}
          </div>
        </Card>
      ))}
    </div>
  )
}

function CommitsView({ commits }) {
  return (
    <div className="space-y-3">
      {commits.map(commit => (
        <Card key={commit.sha}>
          <a href={commit.url} target="_blank" rel="noopener noreferrer" className="block hover:text-blue-600">
            <p className="font-medium">{commit.message.split('\n')[0]}</p>
            <p className="text-sm text-gray-600 mt-1">
              {commit.author} • {commit.sha.slice(0, 7)} • {new Date(commit.date).toLocaleString()}
            </p>
          </a>
        </Card>
      ))}
    </div>
  )
}
