import { randomUUID } from 'node:crypto';

import { redis } from '@devvit/redis';

import type { ReleaseState } from '../core/service';

const RELEASE_CLAIM_TTL_MS = 15 * 60 * 1000;

function prefix(repository: string): string {
  return `loquela-patch-notes:${repository}`;
}

function initializedKey(repository: string): string {
  return `${prefix(repository)}:initialized`;
}

function releaseKey(repository: string, releaseId: number): string {
  return `${prefix(repository)}:release:${releaseId}`;
}

export class RedisReleaseState implements ReleaseState {
  async isInitialized(repository: string): Promise<boolean> {
    return (await redis.get(initializedKey(repository))) === '1';
  }

  async markInitialized(repository: string): Promise<void> {
    await redis.set(initializedKey(repository), '1');
  }

  async getReleaseStatus(repository: string, releaseId: number): Promise<string | undefined> {
    return (await redis.get(releaseKey(repository, releaseId))) ?? undefined;
  }

  async markBaseline(repository: string, releaseId: number): Promise<void> {
    await redis.set(releaseKey(repository, releaseId), 'baseline', { nx: true });
  }

  async claimRelease(repository: string, releaseId: number): Promise<boolean> {
    const key = releaseKey(repository, releaseId);
    const claim = `claimed:${randomUUID()}:${new Date().toISOString()}`;
    await redis.set(key, claim, {
      nx: true,
      expiration: new Date(Date.now() + RELEASE_CLAIM_TTL_MS),
    });
    return (await redis.get(key)) === claim;
  }

  async markPosted(repository: string, releaseId: number, postId: string): Promise<void> {
    await redis.set(releaseKey(repository, releaseId), `posted:${postId}`);
  }
}

