import type { BotConfig, GitHubRelease } from './types';

export function eligibleReleases(
  releases: readonly GitHubRelease[],
  includePrereleases: boolean
): GitHubRelease[] {
  return releases
    .filter(
      (release) =>
        !release.draft &&
        release.published_at !== null &&
        (includePrereleases || !release.prerelease)
    )
    .sort((left, right) => {
      const byDate = Date.parse(left.published_at ?? '') - Date.parse(right.published_at ?? '');
      return byDate || left.id - right.id;
    });
}

export function repositoryKey(config: Pick<BotConfig, 'githubOwner' | 'githubRepository'>): string {
  return `${config.githubOwner.toLowerCase()}/${config.githubRepository.toLowerCase()}`;
}

