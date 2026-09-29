import { describe, expect, it } from 'vitest';

import { formatReleasePost } from './format';
import type { BotConfig, GitHubRelease } from './types';

const config: BotConfig = {
  githubOwner: 'example',
  githubRepository: 'loquela',
  includePrereleases: false,
  postCurrentOnFirstRun: false,
  includeGitHubReleaseLink: true,
  titleProductName: 'Loquela',
  websiteUrl: 'https://www.getloquela.com',
  downloadUrl: 'https://www.getloquela.com/download',
};

const release: GitHubRelease = {
  id: 42,
  tag_name: 'v1.2.3',
  name: 'Version 1.2.3',
  body: '## Fixes\r\n\r\n- Fixed one thing.\r\n<!-- internal -->',
  html_url: 'https://github.com/example/loquela/releases/tag/v1.2.3',
  draft: false,
  prerelease: false,
  published_at: '2026-09-29T12:00:00Z',
};

describe('formatReleasePost', () => {
  it('builds a Reddit title, normalizes Markdown, and adds useful links', () => {
    const post = formatReleasePost(release, config);

    expect(post.title).toBe('Loquela v1.2.3 - Patch Notes');
    expect(post.body).toContain('## Fixes\n\n- Fixed one thing.');
    expect(post.body).not.toContain('internal');
    expect(post.body).toContain('[Full release on GitHub]');
    expect(post.body).toContain('[Download Loquela]');
  });

  it('uses a stable placeholder when a release has no notes', () => {
    expect(formatReleasePost({ ...release, body: null }, config).body).toContain(
      '_No release notes were provided._'
    );
  });

  it('can omit the private GitHub release link', () => {
    const post = formatReleasePost(release, { ...config, includeGitHubReleaseLink: false });
    expect(post.body).not.toContain('Full release on GitHub');
    expect(post.body).toContain('[Download Loquela]');
  });

  it('keeps the body within Reddit text-post limits', () => {
    const post = formatReleasePost({ ...release, body: 'x'.repeat(50_000) }, config);
    expect(post.body.length).toBeLessThanOrEqual(39_500);
    expect(post.body).toContain('Full release on GitHub');
  });
});

