import { randomUUID } from 'node:crypto';

import { redis } from '@devvit/redis';
import { context, reddit } from '@devvit/web/server';

import { formatReleasePost } from '../core/format';
import { checkReleases } from '../core/service';
import type { BotConfig, CheckResult, GitHubRelease, ReleasePost } from '../core/types';
import { loadConfig } from './config';
import { fetchGitHubReleases } from './github';
import { RedisReleaseState } from './state';

const CHECK_LOCK = 'loquela-patch-notes:check-lock';

async function createRedditPost(
  _release: GitHubRelease,
  post: ReleasePost
): Promise<string> {
  const subredditName = context.subredditName;
  if (!subredditName) throw new Error('The Devvit installation has no subreddit context.');

  const created = await reddit.submitPost({
    subredditName,
    title: post.title,
    text: post.body,
    runAs: 'APP',
  });
  return created.id;
}

async function applyFlair(postId: string, config: BotConfig): Promise<void> {
  if (!config.flairText) return;
  const subredditName = context.subredditName;
  if (!subredditName) return;
  if (!postId.startsWith('t3_')) throw new Error(`Unexpected Reddit post ID: ${postId}`);

  const templates = await reddit.getPostFlairTemplates(subredditName);
  const template = templates.find(
    (candidate) => candidate.text.trim().toLowerCase() === config.flairText?.toLowerCase()
  );
  if (!template) {
    console.warn(`No post flair named "${config.flairText}" exists in r/${subredditName}.`);
    return;
  }

  await reddit.setPostFlair({
    subredditName,
    postId: postId as `t3_${string}`,
    flairTemplateId: template.id,
  });
}

export async function runReleaseCheck(): Promise<CheckResult> {
  const lockToken = randomUUID();
  await redis.set(CHECK_LOCK, lockToken, {
    nx: true,
    expiration: new Date(Date.now() + 5 * 60 * 1000),
  });
  if ((await redis.get(CHECK_LOCK)) !== lockToken) {
    return {
      status: 'locked',
      initialized: false,
      discovered: 0,
      posted: 0,
      skipped: 0,
      postIds: [],
    };
  }

  try {
    const config = await loadConfig();
    return await checkReleases(config, {
      fetchReleases: fetchGitHubReleases,
      state: new RedisReleaseState(),
      createPost: createRedditPost,
      formatPost: formatReleasePost,
      afterPost: applyFlair,
    });
  } finally {
    if ((await redis.get(CHECK_LOCK)) === lockToken) {
      await redis.del(CHECK_LOCK);
    }
  }
}

