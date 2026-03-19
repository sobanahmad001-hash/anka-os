const GITHUB_API = 'https://api.github.com'
const token = import.meta.env.VITE_GITHUB_TOKEN
const org = import.meta.env.VITE_GITHUB_ORG
const repo = import.meta.env.VITE_GITHUB_REPO

const headers = {
  'Authorization': `Bearer ${token}`,
  'Accept': 'application/vnd.github.v3+json',
  'X-GitHub-Api-Version': '2022-11-28'
}

export async function fetchPullRequests() {
  try {
    const response = await fetch(
      `${GITHUB_API}/repos/${org}/${repo}/pulls?state=all&sort=updated&per_page=50`,
      { headers }
    )
    
    if (!response.ok) {
      throw new Error(`GitHub API error: ${response.status} ${response.statusText}`)
    }
    
    const data = await response.json()
    
    return data.map(pr => ({
      id: pr.id,
      number: pr.number,
      title: pr.title,
      state: pr.state,
      merged: pr.merged_at !== null,
      author: pr.user.login,
      avatar: pr.user.avatar_url,
      url: pr.html_url,
      created_at: pr.created_at,
      updated_at: pr.updated_at,
      merged_at: pr.merged_at,
      base_branch: pr.base.ref,
      head_branch: pr.head.ref,
      additions: pr.additions,
      deletions: pr.deletions,
      changed_files: pr.changed_files,
      comments: pr.comments
    }))
  } catch (error) {
    console.error('Error fetching PRs:', error)
    return []
  }
}

export async function fetchBranches() {
  try {
    const response = await fetch(
      `${GITHUB_API}/repos/${org}/${repo}/branches?per_page=100`,
      { headers }
    )
    
    if (!response.ok) {
      throw new Error(`GitHub API error: ${response.status}`)
    }
    
    const data = await response.json()
    
    return data.map(branch => ({
      name: branch.name,
      protected: branch.protected,
      commit_sha: branch.commit.sha
    }))
  } catch (error) {
    console.error('Error fetching branches:', error)
    return []
  }
}

export async function fetchCommits(branch = 'main', limit = 50) {
  try {
    const response = await fetch(
      `${GITHUB_API}/repos/${org}/${repo}/commits?sha=${branch}&per_page=${limit}`,
      { headers }
    )
    
    if (!response.ok) {
      throw new Error(`GitHub API error: ${response.status}`)
    }
    
    const data = await response.json()
    
    return data.map(commit => ({
      sha: commit.sha,
      message: commit.commit.message,
      author: commit.commit.author.name,
      date: commit.commit.author.date,
      url: commit.html_url
    }))
  } catch (error) {
    console.error('Error fetching commits:', error)
    return []
  }
}

export async function fetchRepoInfo() {
  try {
    const response = await fetch(
      `${GITHUB_API}/repos/${org}/${repo}`,
      { headers }
    )
    
    if (!response.ok) {
      throw new Error(`GitHub API error: ${response.status}`)
    }
    
    const data = await response.json()
    
    return {
      name: data.name,
      full_name: data.full_name,
      url: data.html_url,
      default_branch: data.default_branch,
      stars: data.stargazers_count,
      forks: data.forks_count,
      language: data.language
    }
  } catch (error) {
    console.error('Error fetching repo info:', error)
    return null
  }
}

export async function getRepoContents(path = '') {
  try {
    const response = await fetch(
      `${GITHUB_API}/repos/${org}/${repo}/contents/${path}`,
      { headers }
    )
    if (!response.ok) throw new Error(`GitHub API error: ${response.status}`)
    return await response.json()
  } catch (error) {
    console.error('Error fetching repo contents:', error)
    return null
  }
}

export async function getFileContent(path) {
  try {
    const response = await fetch(
      `${GITHUB_API}/repos/${org}/${repo}/contents/${path}`,
      { headers }
    )
    if (!response.ok) throw new Error(`GitHub API error: ${response.status}`)
    const data = await response.json()
    return {
      content: atob(data.content.replace(/\n/g, '')),
      sha: data.sha,
      path: data.path
    }
  } catch (error) {
    console.error('Error fetching file:', error)
    return null
  }
}

export async function createOrUpdateFile(path, content, message, sha = null) {
  try {
    const body = {
      message,
      content: btoa(unescape(encodeURIComponent(content))),
      branch: `agent/${Date.now()}`
    }
    if (sha) body.sha = sha

    // First create branch from main
    const repoInfo = await fetchRepoInfo()
    const defaultBranch = repoInfo?.default_branch || 'main'

    const refRes = await fetch(
      `${GITHUB_API}/repos/${org}/${repo}/git/refs/heads/${defaultBranch}`,
      { headers }
    )
    const refData = await refRes.json()
    const sha_ref = refData.object?.sha

    if (sha_ref) {
      await fetch(`${GITHUB_API}/repos/${org}/${repo}/git/refs`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ref: `refs/heads/${body.branch}`, sha: sha_ref })
      })
    }

    const response = await fetch(
      `${GITHUB_API}/repos/${org}/${repo}/contents/${path}`,
      {
        method: 'PUT',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      }
    )
    if (!response.ok) throw new Error(`GitHub API error: ${response.status}`)
    return { branch: body.branch, ...(await response.json()) }
  } catch (error) {
    console.error('Error creating/updating file:', error)
    return null
  }
}

export async function createPullRequest(title, body, headBranch, baseBranch = 'main') {
  try {
    const response = await fetch(
      `${GITHUB_API}/repos/${org}/${repo}/pulls`,
      {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, body, head: headBranch, base: baseBranch })
      }
    )
    if (!response.ok) throw new Error(`GitHub API error: ${response.status}`)
    return await response.json()
  } catch (error) {
    console.error('Error creating PR:', error)
    return null
  }
}

export async function searchCode(query) {
  try {
    const response = await fetch(
      `${GITHUB_API}/search/code?q=${encodeURIComponent(query)}+repo:${org}/${repo}`,
      { headers }
    )
    if (!response.ok) throw new Error(`GitHub API error: ${response.status}`)
    const data = await response.json()
    return data.items || []
  } catch (error) {
    console.error('Error searching code:', error)
    return []
  }
}
