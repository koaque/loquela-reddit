import { describe, expect, it, vi } from 'vitest';

import { createFacebookClient, formatFacebookPost, syncFacebookPosts } from './publish-facebook.mjs';

const pageId = '998141173385319';
const token = 'test-token-not-a-real-credential';
const articleUrl = 'https://www.getloquela.com/blog/android-v1-2-1-patch-notes';
const article = `<main><article><h1>Android v1.2.1: Enter sends</h1>
<p>Choose what Enter does in message boxes, and hold it for the other action.</p>
<div><p>Loquela v1.2.1 is on Google Play.</p><h2>Added</h2><ul><li>Choose New line or Send, and hold Enter for the other action.</li></ul></div></article></main>`;
const rss = `<rss><channel><item><title>Android v1.2.1: Enter sends</title><category>Patch Notes</category><link>${articleUrl}</link><pubDate>Tue, 13 Oct 2026 12:00:00 GMT</pubDate></item></channel></rss>`;
const entry = { version: 'v1.2.1', id: articleUrl };
const post = formatFacebookPost(article, entry);

function harness({ state, existing = [], saveFails = false, graphError = false, wrongPage = false } = {}) {
  const requests = [];
  const repos = {
    getContent: vi.fn(async () => {
      if (!state) throw Object.assign(new Error('Not found'), { status: 404 });
      return { data: { content: Buffer.from(JSON.stringify(state)).toString('base64'), sha: 'old-sha' } };
    }),
    createOrUpdateFileContents: vi.fn(async () => {
      if (saveFails) throw new Error('State save failed');
      return { data: { content: { sha: 'saved-sha' } } };
    }),
  };
  const fetchImpl = vi.fn(async (url, options = {}) => {
    requests.push({ url, options });
    if (url.endsWith('/feed.xml')) return new Response(rss);
    if (url === articleUrl) return new Response(article);
    if (graphError) return Response.json({ error: { code: 190, message: `Provider echoed ${token}` } }, { status: 400 });
    if (url.includes('/published_posts')) return Response.json({ data: existing });
    if (options.method === 'POST') return Response.json({ id: `${pageId}_123` });
    return Response.json({ id: wrongPage ? '123' : pageId, name: 'Loquela' });
  });
  const summary = { addHeading: () => summary, addRaw: () => summary, write: async () => {} };
  return {
    requests, repos,
    args: {
      github: { rest: { repos } },
      context: { repo: { owner: 'koaque', repo: 'loquela-reddit' } },
      core: { info: () => {}, summary },
      pageId, pageToken: token, fetchImpl,
    },
  };
}

describe('Facebook patch-note publisher', () => {
  it('uses the published summary verbatim and includes a stable source URL without Markdown', () => {
    expect(post).toEqual({
      message: `Loquela v1.2.1 - Patch Notes\n\nChoose what Enter does in message boxes, and hold it for the other action.\n\nFull patch notes: ${articleUrl}`,
      link: articleUrl,
    });
    expect(() => formatFacebookPost(article.replace('<p>Choose what Enter does in message boxes, and hold it for the other action.</p>', ''), entry)).toThrow('No published summary');
  });

  it('publishes the newest update and saves a receipt containing no token', async () => {
    const { args, requests, repos } = harness();
    expect(await syncFacebookPosts(args)).toEqual({ posted: 1, reconciled: 0 });
    const sent = requests.find((request) => request.options.method === 'POST');
    expect(sent.url).toBe(`https://graph.facebook.com/v26.0/${pageId}/feed`);
    expect(sent.options.headers.Authorization).toBe(`Bearer ${token}`);
    expect(JSON.parse(sent.options.body)).toEqual(post);
    expect(sent.url).not.toContain(token);
    const saved = Buffer.from(repos.createOrUpdateFileContents.mock.calls[0][0].content, 'base64').toString();
    expect(saved).not.toContain(token);
    expect(JSON.parse(saved)).toMatchObject({ pageId, seen: [articleUrl], receipts: { [articleUrl]: `${pageId}_123` } });
  });

  it('does not repost seen updates', async () => {
    const { args, requests, repos } = harness({ state: { version: 1, pageId, seen: [articleUrl], receipts: {} } });
    expect(await syncFacebookPosts(args)).toEqual({ posted: 0, reconciled: 0 });
    expect(requests.some((request) => request.options.method === 'POST')).toBe(false);
    expect(repos.createOrUpdateFileContents).not.toHaveBeenCalled();
  });

  it('reconciles a successful post after a state-save failure before attempting another publish', async () => {
    const first = harness({ saveFails: true });
    await expect(syncFacebookPosts(first.args)).rejects.toThrow('State save failed');
    expect(first.requests.filter((request) => request.options.method === 'POST')).toHaveLength(1);
    const retry = harness({ existing: [{ id: `${pageId}_123`, message: post.message }] });
    expect(await syncFacebookPosts(retry.args)).toEqual({ posted: 0, reconciled: 1 });
    expect(retry.requests.some((request) => request.options.method === 'POST')).toBe(false);
  });

  it('fails before posting when the Page identity or stored Page differs', async () => {
    const mismatch = harness({ wrongPage: true });
    await expect(syncFacebookPosts(mismatch.args)).rejects.toThrow('does not identify');
    expect(mismatch.requests.some((request) => request.options.method === 'POST')).toBe(false);
    const otherState = harness({ state: { version: 1, pageId: '123', seen: [] } });
    await expect(syncFacebookPosts(otherState.args)).rejects.toThrow('another Page');
    expect(otherState.requests).toEqual([]);
  });

  it('does not disclose token-bearing provider errors or publish after failed authorization', async () => {
    const { args, requests } = harness({ graphError: true });
    let error;
    try { await syncFacebookPosts(args); } catch (caught) { error = caught; }
    expect(error.message).toContain('HTTP 400, code 190');
    expect(error.message).not.toContain(token);
    expect(requests.some((request) => request.options.method === 'POST')).toBe(false);
  });

  it('requires a configured numeric Page ID and token', () => {
    expect(() => createFacebookClient({ pageId: '', pageToken: token })).toThrow('configured Page ID');
    expect(() => createFacebookClient({ pageId, pageToken: '' })).toThrow('encrypted Page token');
  });
});
