import { eligibleReleases, repositoryKey } from './releases';
import type { BotConfig, CheckResult, GitHubRelease, ReleasePost } from './types';

const MAX_POSTS_PER_RUN = 5;

export interface ReleaseState {
  isInitialized(repository: string): Promise<boolean>;
  markInitialized(repository: string): Promise<void>;
  getReleaseStatus(repository: string, releaseId: number): Promise<string | undefined>;
  markBaseline(repository: string, releaseId: number): Promise<void>;
  claimRelease(repository: string, releaseId: number): Promise<boolean>;
  markPosted(repository: string, releaseId: number, postId: string): Promise<void>;
}

export interface ReleaseServiceDependencies {
  fetchReleases(config: BotConfig): Promise<GitHubRelease[]>;
  state: ReleaseState;
  createPost(release: GitHubRelease, post: ReleasePost, config: BotConfig): Promise<string>;
  findExistingPost?(
    release: GitHubRelease,
    post: ReleasePost,
    config: BotConfig
  ): Promise<string | undefined>;
  formatPost(release: GitHubRelease, config: BotConfig): ReleasePost;
  afterPost?(postId: string, config: BotConfig): Promise<void>;
}

export async function checkReleases(
  config: BotConfig,
  dependencies: ReleaseServiceDependencies
): Promise<CheckResult> {
  const repository = repositoryKey(config);
  const releases = eligibleReleases(
    await dependencies.fetchReleases(config),
    config.includePrereleases
  );
  const initialized = await dependencies.state.isInitialized(repository);

  let candidates: GitHubRelease[];
  if (!initialized) {
    const current = config.postCurrentOnFirstRun ? releases.at(-1) : undefined;
    const baseline = current ? releases.filter((release) => release.id !== current.id) : releases;

    for (const release of baseline) {
      await dependencies.state.markBaseline(repository, release.id);
    }
    await dependencies.state.markInitialized(repository);
    candidates = current ? [current] : [];
  } else {
    const statuses = await Promise.all(
      releases.map((release) => dependencies.state.getReleaseStatus(repository, release.id))
    );
    candidates = releases.filter((_, index) => statuses[index] === undefined);
  }

  const selected = candidates.slice(0, MAX_POSTS_PER_RUN);
  const postIds: string[] = [];
  let skipped = candidates.length - selected.length;

  for (const release of selected) {
    const claimed = await dependencies.state.claimRelease(repository, release.id);
    if (!claimed) {
      skipped += 1;
      continue;
    }

    const post = dependencies.formatPost(release, config);
    const existingPostId = await dependencies.findExistingPost?.(release, post, config);
    if (existingPostId) {
      await dependencies.state.markPosted(repository, release.id, existingPostId);
      skipped += 1;
      continue;
    }

    const postId = await dependencies.createPost(release, post, config);
    await dependencies.state.markPosted(repository, release.id, postId);
    postIds.push(postId);

    if (dependencies.afterPost) {
      try {
        await dependencies.afterPost(postId, config);
      } catch (error) {
        console.error(`Post ${postId} was created, but optional finishing work failed`, error);
      }
    }
  }

  return {
    status: 'ok',
    initialized: !initialized,
    discovered: candidates.length,
    posted: postIds.length,
    skipped,
    postIds,
  };
}

