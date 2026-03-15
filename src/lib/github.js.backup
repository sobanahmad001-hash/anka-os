import fetch from 'node-fetch';

const GITHUB_API_URL = 'https://api.github.com';

export async function fetchPullRequests(repo) {
  const response = await fetch(`${GITHUB_API_URL}/repos/${repo}/pulls`, {
    headers: {
      Authorization: `token ${process.env.GITHUB_API_TOKEN}`,
      Accept: 'application/vnd.github.v3+json',
    },
  });

  if (!response.ok) {
    throw new Error(`GitHub API error: ${response.statusText}`);
  }

  return response.json();
}

export async function fetchBranches(repo) {
  const response = await fetch(`${GITHUB_API_URL}/repos/${repo}/branches`, {
    headers: {
      Authorization: `token ${process.env.GITHUB_API_TOKEN}`,
      Accept: 'application/vnd.github.v3+json',
    },
  });

  if (!response.ok) {
    throw new Error(`GitHub API error: ${response.statusText}`);
  }

  return response.json();
}
