import { describe, expect, it } from 'vitest';

import { formatReleasePost } from './format';
import { checkReleases, type ReleaseState } from './service';
import type { BotConfig, GitHubRelease } from './types';

class MemoryState implements ReleaseState {
  readonly values = new Map<string, string>();

  async isInitialized(repository: string): Promise<boolean> {
    return this.values.get(`${repository}:initialized`) === '1';
  }
  async markInitialized(repository: string): Promise<void> {
    this.values.set(`${repository}:initialized`, '1');
  }
  async getReleaseStatus(repository: string, releaseId: number): Promise<string | undefined> {
    return this.values.get(`${repository}:${releaseId}`);
  }
  async markBaseline(repository: string, releaseId: number): Promise<void> {
    if (!this.values.has(`${repository}:${releaseId}`)) {
      this.values.set(`${repository}:${releaseId}`, 'baseline');
    }
  }
  async claimRelease(repository: string, releaseId: number): Promise<boolean> {
    const key = `${repository}:${releaseId}`;
    if (this.values.has(key)) return false;
    this.values.set(key, 'claimed');
    return true;
  }
  async markPosted(repository: string, releaseId: number, postId: string): Promise<void> {
    this.values.set(`${repository}:${releaseId}`, `posted:${postId}`);
  }
}

const config: BotConfig = {
  githubOwner: 'Example',
  githubRepository: 'Loquela',
  includePrereleases: false,
  postCurrentOnFirstRun: false,
  includeGitHubReleaseLink: true,
  titleProductName: 'Loquela',
};

function release(id: number, options: Partial<GitHubRelease> = {}): GitHubRelease {
  return {
    id,
    tag_name: `v1.0.${id}`,
    name: null,
    body: `Notes ${id}`,
    html_url: `https://github.com/example/loquela/releases/tag/v1.0.${id}`,
    draft: false,
    prerelease: false,
    published_at: `2026-09-${String(id).padStart(2, '0')}T12:00:00Z`,
    ...options,
  };
}

function dependencies(state: MemoryState, releases: GitHubRelease[], posted: number[]) {
  return {
    fetchReleases: async () => releases,
    state,
    formatPost: formatReleasePost,
    createPost: async (item: GitHubRelease) => {
      posted.push(item.id);
      return `t3_${item.id}`;
    },
  };
}

describe('checkReleases', () => {
  it('records existing releases without posting on its first run by default', async () => {
    const state = new MemoryState();
    const posted: number[] = [];
    const result = await checkReleases(config, dependencies(state, [release(1), release(2)], posted));

    expect(result.initialized).toBe(true);
    expect(posted).toEqual([]);
    expect(await state.getReleaseStatus('example/loquela', 2)).toBe('baseline');
  });

  it('can post only the newest current release on its first run', async () => {
    const state = new MemoryState();
    const posted: number[] = [];
    await checkReleases(
      { ...config, postCurrentOnFirstRun: true },
      dependencies(state, [release(2), release(1)], posted)
    );

    expect(posted).toEqual([2]);
    expect(await state.getReleaseStatus('example/loquela', 1)).toBe('baseline');
  });

  it('posts unseen releases oldest-first and never reposts them', async () => {
    const state = new MemoryState();
    const posted: number[] = [];
    await checkReleases(config, dependencies(state, [release(1)], posted));
    await checkReleases(config, dependencies(state, [release(3), release(2), release(1)], posted));
    await checkReleases(config, dependencies(state, [release(3), release(2), release(1)], posted));

    expect(posted).toEqual([2, 3]);
  });

  it('ignores drafts and prereleases unless prereleases are enabled', async () => {
    const state = new MemoryState();
    const posted: number[] = [];
    await checkReleases(config, dependencies(state, [], posted));
    await checkReleases(
      config,
      dependencies(
        state,
        [release(1, { draft: true }), release(2, { prerelease: true }), release(3)],
        posted
      )
    );
    expect(posted).toEqual([3]);
  });

  it('reconciles an existing Reddit post instead of creating a duplicate', async () => {
    const state = new MemoryState();
    const posted: number[] = [];
    await checkReleases(config, dependencies(state, [], posted));

    const deps = dependencies(state, [release(4)], posted);
    const result = await checkReleases(config, {
      ...deps,
      findExistingPost: async () => 't3_existing',
    });

    expect(posted).toEqual([]);
    expect(result.skipped).toBe(1);
    expect(await state.getReleaseStatus('example/loquela', 4)).toBe('posted:t3_existing');
  });
});

