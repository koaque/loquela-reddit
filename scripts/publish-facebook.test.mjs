import { describe, expect, it, vi } from 'vitest';
import { afterBaseline, createFacebookClient, formatFacebookPost, PAGE_ID, payloadHash, runFacebook, validateApproval } from './publish-facebook.mjs';

const now = Date.parse('2026-11-17T20:00:00Z');
const version = 'v1.6.5';
const url = 'https://www.getloquela.com/blog/android-v1-6-5-patch-notes';
const article = `<main><article><h1>Android v1.6.5: example</h1><p>A useful published summary that is long enough for an update.</p><div><h2>Fixed</h2><ul><li>A sufficiently detailed published example fix for testing purposes only.</li></ul></div></article></main>`;
const rss = `<rss><channel><item><title>Android v1.6.5: example</title><category>Patch Notes</category><link>${url}</link><pubDate>Tue, 17 Nov 2026 18:00:00 GMT</pubDate></item></channel></rss>`;
const post = formatFacebookPost(article, { version, id: url });
const token = 'fake-test-token';
const approval = { payloadSha256: payloadHash(post), liveOnPlay: true,
  liveEvidenceUrl: 'https://play.google.com/store/apps/details?id=com.praxisdynamics.loquela',
  liveCheckedAt: '2026-11-17T19:00:00Z', ownerApprovalReference: 'test-owner-approval', reviewReleaseReference: 'test-review-release' };

function harness({ stateMissing = false, attempts = {}, existing = [], saveFails = false, timeout = false, wrongPage = false, readbackMismatch = false, providerError = false } = {}) {
  const requests = [], events = [], saved = [];
  const state = { version: 2, pageId: PAGE_ID, baselineVersion: 'v1.6.4', attempts };
  const repos = {
    getContent: vi.fn(async () => {
      if (stateMissing) throw new Error('404');
      return { data: { sha: 'initial', content: Buffer.from(JSON.stringify(state)).toString('base64') } };
    }),
    createOrUpdateFileContents: vi.fn(async args => {
      if (saveFails) throw new Error('State save failed');
      const snapshot = JSON.parse(Buffer.from(args.content, 'base64').toString());
      saved.push(snapshot); events.push(snapshot.attempts[version]?.status);
      return { data: { content: { sha: `save-${saved.length}` } } };
    }),
  };
  const fetchImpl = vi.fn(async (requestUrl, options = {}) => {
    requests.push({ url: requestUrl, options });
    if (requestUrl.endsWith('/feed.xml')) return new Response(rss);
    if (requestUrl === url) return new Response(article);
    if (providerError) return Response.json({ error: { code: 190, message: token } }, { status: 400 });
    if (options.method === 'POST') {
      events.push('POST');
      if (timeout) throw new Error(`timeout with ${token}`);
      return Response.json({ id: `${PAGE_ID}_123` });
    }
    if (requestUrl.includes('/published_posts')) return Response.json({ data: existing });
    if (requestUrl.includes(`${PAGE_ID}_123`)) return Response.json({ id: `${PAGE_ID}_123`, message: readbackMismatch ? 'different' : post.message, is_published: true, permalink_url: `https://www.facebook.com/${PAGE_ID}_123` });
    return Response.json({ id: wrongPage ? '1' : PAGE_ID, name: 'Loquela' });
  });
  const summary = { addHeading: () => summary, addRaw: vi.fn(() => summary), write: async () => {} };
  return { requests, events, saved, repos, fetchImpl, args: { github: { rest: { repos } },
    context: { repo: { owner: 'koaque', repo: 'loquela-reddit' }, eventName: 'workflow_dispatch', runId: 1, actor: 'test-owner' },
    core: { summary }, mode: 'publish', version, pageId: PAGE_ID, pageToken: token, publishingEnabled: true,
    approval: { ...approval }, fetchImpl, now } };
}

describe('Facebook release controls', () => {
  it('excludes 1.6.4 and all older releases without fetching the feed or using a token', async () => {
    for (const old of ['v0.9.0', 'v1.6.3', 'v1.6.4']) {
      expect(afterBaseline(old)).toBe(false);
      const h = harness();
      await expect(runFacebook({ ...h.args, version: old })).rejects.toThrow('permanently excluded');
      expect(h.fetchImpl).not.toHaveBeenCalled();
    }
    expect(afterBaseline('v1.6.10')).toBe(true);
    expect(() => afterBaseline('v1.6.5-beta')).toThrow();
  });
  it('prepares an exact preview without a Page token, Graph calls or state writes', async () => {
    const h = harness();
    expect(await runFacebook({ ...h.args, mode: 'preview', pageToken: undefined })).toMatchObject({ mode: 'preview', post, hash: approval.payloadSha256 });
    expect(h.requests.some(r => r.url.includes('graph.facebook.com'))).toBe(false);
    expect(h.saved).toEqual([]);
  });
  it('never initializes a missing state file or replays history', async () => {
    const h = harness({ stateMissing: true });
    await expect(runFacebook(h.args)).rejects.toThrow('refusing to initialize');
    expect(h.fetchImpl).not.toHaveBeenCalled();
  });
  it('rejects disabled publishing, unapproved or changed text, unverified or stale Play evidence and missing review', async () => {
    const cases = [
      { publishingEnabled: false },
      { approval: { ...approval, payloadSha256: 'a'.repeat(64) } },
      { approval: { ...approval, liveOnPlay: false } },
      { approval: { ...approval, liveEvidenceUrl: url } },
      { approval: { ...approval, liveCheckedAt: '2026-11-15T19:00:00Z' } },
      { approval: { ...approval, liveCheckedAt: '2026-11-18T19:00:00Z' } },
      { approval: { ...approval, reviewReleaseReference: '' } },
    ];
    for (const change of cases) {
      const h = harness();
      await expect(runFacebook({ ...h.args, ...change })).rejects.toThrow();
      expect(h.requests.some(r => r.url.includes('graph.facebook.com'))).toBe(false);
    }
    expect(() => validateApproval({ approval, hash: payloadHash({ ...post, message: post.message + ' changed' }), publishingEnabled: true, now })).toThrow();
  });
  it('rejects publish from a scheduled event or an implicit latest version', async () => {
    for (const change of [{ context: { ...harness().args.context, eventName: 'schedule' } }, { version: '' }]) {
      const h = harness(); await expect(runFacebook({ ...h.args, ...change })).rejects.toThrow('manual workflow');
      expect(h.events).toEqual([]);
    }
  });
  it('verifies the connection using GET only without mutating state', async () => {
    const h = harness();
    expect(await runFacebook({ ...h.args, mode: 'verify', publishingEnabled: false })).toMatchObject({ mode: 'verify', pageId: PAGE_ID });
    expect(h.requests.every(r => r.options.method === 'GET')).toBe(true);
    expect(h.saved).toEqual([]);
  });
  it('writes durable intent before exactly one POST, then verifies the real payload', async () => {
    const h = harness();
    expect(await runFacebook(h.args)).toMatchObject({ status: 'verified' });
    expect(h.events).toEqual(['pending', 'POST', 'verified']);
    const request = h.requests.find(r => r.options.method === 'POST');
    expect(request.url).not.toContain(token);
    expect(JSON.parse(request.options.body)).toEqual({ ...post, published: true });
    expect(JSON.stringify(h.saved)).not.toContain(token);
  });
  it('does not POST if persisting intent fails', async () => {
    const h = harness({ saveFails: true });
    await expect(runFacebook(h.args)).rejects.toThrow('State save failed');
    expect(h.events).toEqual([]);
  });
  it('records an ambiguous POST and blocks any later attempt without a matching existing post', async () => {
    const h = harness({ timeout: true });
    await expect(runFacebook(h.args)).rejects.toThrow('outcome unavailable');
    expect(h.events).toEqual(['pending', 'POST', 'uncertain']);
    const next = harness({ attempts: h.saved.at(-1).attempts });
    await expect(runFacebook(next.args)).rejects.toThrow('no retry');
    expect(next.events).toEqual([]);
  });
  it('holds mismatched readback instead of claiming delivery', async () => {
    const h = harness({ readbackMismatch: true });
    await expect(runFacebook(h.args)).rejects.toThrow('Readback');
    expect(h.saved.at(-1).attempts[version].status).toBe('uncertain');
  });
  it('recognizes differently worded manual announcements with a matching attached source link', async () => {
    const h = harness({ existing: [{ id: `${PAGE_ID}_789`, message: 'Version 1.6.5 is available!', attachments: { data: [{ target: { url } }] } }] });
    expect(await runFacebook(h.args)).toMatchObject({ status: 'existing', postId: `${PAGE_ID}_789` });
    expect(h.events).toEqual(['existing']);
  });
  it('does not mistake a neighboring version for the requested release', async () => {
    const h = harness({ existing: [{ id: `${PAGE_ID}_789`, message: `Version 1.6.50: ${url}` }] });
    expect(await runFacebook(h.args)).toMatchObject({ status: 'verified' });
  });
  it('holds a manual version announcement without a source link instead of duplicating it', async () => {
    const h = harness({ existing: [{ id: `${PAGE_ID}_789`, message: 'Update 1.6.5 is out, check our blog!' }] });
    await expect(runFacebook(h.args)).rejects.toThrow('possible manual announcement');
    expect(h.events).toEqual([]);
  });
  it('does not repeat a previously recorded release', async () => {
    const h = harness({ attempts: { [version]: { status: 'verified', postId: `${PAGE_ID}_123` } } });
    expect(await runFacebook(h.args)).toMatchObject({ status: 'already-recorded' });
    expect(h.events).toEqual([]);
  });
  it('fails on wrong identity and redacts token-bearing provider errors', async () => {
    const wrong = harness({ wrongPage: true });
    await expect(runFacebook(wrong.args)).rejects.toThrow('Wrong Facebook Page');
    const h = harness({ providerError: true });
    try { await runFacebook(h.args); throw new Error('unexpected success'); }
    catch (error) { expect(error.message).toContain('code 190'); expect(error.message).not.toContain(token); }
    expect(h.events).toEqual([]);
  });
  it('paginates Page history through a fresh Graph URL and refuses incomplete history', async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(Response.json({ data: [], paging: { next: 'https://untrusted.invalid/?access_token=secret', cursors: { after: 'cursor2' } } }))
      .mockResolvedValueOnce(Response.json({ data: [{ id: `${PAGE_ID}_5` }] }));
    const client = createFacebookClient({ pageId: PAGE_ID, pageToken: token, fetchImpl });
    expect(await client.recentPosts()).toHaveLength(1);
    expect(fetchImpl.mock.calls[1][0]).toContain('https://graph.facebook.com/v27.0/');
    expect(fetchImpl.mock.calls[1][0]).toContain('after=cursor2');
    const broken = createFacebookClient({ pageId: PAGE_ID, pageToken: token, fetchImpl: async () => Response.json({ data: [], paging: { next: 'anything' } }) });
    await expect(broken.recentPosts()).rejects.toThrow('Incomplete');
  });
});
