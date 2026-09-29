import type { BotConfig, GitHubRelease } from '../core/types';

const GITHUB_API_VERSION = '2022-11-28';

function isRelease(value: unknown): value is GitHubRelease {
  if (typeof value !== 'object' || value === null) return false;
  const release = value as Record<string, unknown>;
  return (
    typeof release.id === 'number' &&
    typeof release.tag_name === 'string' &&
    (typeof release.name === 'string' || release.name === null) &&
    (typeof release.body === 'string' || release.body === null) &&
    typeof release.html_url === 'string' &&
    typeof release.draft === 'boolean' &&
    typeof release.prerelease === 'boolean' &&
    (typeof release.published_at === 'string' || release.published_at === null)
  );
}

export async function fetchGitHubReleases(config: BotConfig): Promise<GitHubRelease[]> {
  const owner = encodeURIComponent(config.githubOwner);
  const repository = encodeURIComponent(config.githubRepository);
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'loquela-reddit-patch-notes',
    'X-GitHub-Api-Version': GITHUB_API_VERSION,
  };
  if (config.githubToken) headers.Authorization = `Bearer ${config.githubToken}`;

  const response = await fetch(
    `https://api.github.com/repos/${owner}/${repository}/releases?per_page=100`,
    { headers }
  );

  if (!response.ok) {
    const remaining = response.headers.get('x-ratelimit-remaining');
    const suffix = remaining === '0' ? ' GitHub API rate limit exhausted.' : '';
    throw new Error(`GitHub Releases request failed with HTTP ${response.status}.${suffix}`);
  }

  const payload: unknown = await response.json();
  if (!Array.isArray(payload) || !payload.every(isRelease)) {
    throw new Error('GitHub returned an unexpected Releases response.');
  }
  return payload;
}

