import { describe, expect, it, vi } from 'vitest';
import { PACKAGE_ID, PLAY_URL, parsePlayListing, readLivePlayRelease } from './google-play-live.mjs';
import { playFixture } from './test-fixtures/google-play.mjs';

describe('public Play release confirmation', () => {
  it('reads only the version associated with the exact app identity', () => {
    expect(parsePlayListing(playFixture())).toMatchObject({ packageId: PACKAGE_ID, version: 'v1.6.5' });
    const decoy = '<p>Upcoming v9.9.9 and recommended app v8.8.8</p>';
    expect(parsePlayListing(decoy + playFixture()).version).toBe('v1.6.5');
  });
  it.each([
    { packageId: 'some.other.app' }, { structuredPackage: 'some.other.app' },
    { available: false }, { version: 'Varies with device' }, { version: '1.6.5-beta' },
    { notes: '' }, { key: 'ds:99' }, { corrupt: true }, { duplicate: true },
  ])('fails closed for missing, changed or conflicting evidence: %j', options => {
    expect(() => parsePlayListing(playFixture(options))).toThrow();
  });
  it('fails closed on a consent, error or anti-bot page', () => {
    expect(() => parsePlayListing('<html>Please sign in or consent</html>')).toThrow();
  });
  it('fetches without credentials or redirects and records the observed source/hash/time', async () => {
    const fetchImpl = vi.fn(async () => new Response(playFixture(), { headers: { 'content-type': 'text/html; charset=utf-8' } }));
    expect(await readLivePlayRelease({ fetchImpl, now: Date.parse('2026-11-19T21:30:00Z') })).toMatchObject({
      version: 'v1.6.5', source: PLAY_URL, checkedAt: '2026-11-19T21:30:00.000Z', listingSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(fetchImpl).toHaveBeenCalledWith(PLAY_URL, expect.objectContaining({ redirect: 'error' }));
    expect(fetchImpl.mock.calls[0][1].headers.Authorization).toBeUndefined();
  });
  it.each([new Response('unavailable', { status: 503 }), new Response('{}', { headers: { 'content-type': 'application/json' } })])('rejects unavailable listings', async response => {
    await expect(readLivePlayRelease({ fetchImpl: async () => response })).rejects.toThrow('unavailable');
  });
});
