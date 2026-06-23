'use strict';

// Thin wrapper around the GitHub REST API. Uses the global fetch available in
// Node 18+. All calls are made with the signed-in user's OAuth access token.

const API_BASE = 'https://api.github.com';

async function ghRequest(accessToken, pathname) {
  const res = await fetch(`${API_BASE}${pathname}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'express-github-oauth-demo',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`GitHub API ${pathname} failed: ${res.status} ${res.statusText} ${body}`);
  }
  return res.json();
}

/**
 * Fetch live account data for the signed-in user: their authenticated profile
 * and their most recently updated repositories.
 */
async function getAccountData(accessToken) {
  const [me, repos] = await Promise.all([
    ghRequest(accessToken, '/user'),
    ghRequest(accessToken, '/user/repos?per_page=5&sort=updated&affiliation=owner'),
  ]);

  return {
    login: me.login,
    name: me.name,
    company: me.company,
    location: me.location,
    publicRepos: me.public_repos,
    followers: me.followers,
    following: me.following,
    createdAt: me.created_at,
    repos: (repos || []).map((r) => ({
      name: r.name,
      url: r.html_url,
      description: r.description,
      stars: r.stargazers_count,
      language: r.language,
      updatedAt: r.updated_at,
    })),
  };
}

module.exports = { getAccountData };
