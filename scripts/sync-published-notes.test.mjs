import { describe, expect, it, vi } from 'vitest';

import { articleToMarkdown, parseFeed, planSync, syncPublishedNotes } from './sync-published-notes.mjs';

const url = 'https://www.getloquela.com/blog/android-v1-2-1-patch-notes';
const article = `<main><article><h1>Android v1.2.1: Enter sends</h1>
<div><time>Published October 13</time><span>2 min read</span></div>
<dl><dt>Status</dt><dd>Released on Google Play</dd></dl>
<div><p>Choose what Enter does in your message boxes.</p><h2>Added</h2>
<ul><li>Choose New line or Send &amp; hold Enter for the other action.</li></ul>
<p><a href="/download">Get Loquela</a></p><script>privateCode()</script></div>
<div><a href="/blog">Back to all posts</a></div></article></main>`;

function item(version, date, category = 'Patch Notes', link = url) {
  return `<item><title>Android ${version}: New features</title><category>${category}</category>
  <link>${link}</link><pubDate>${date}</pubDate></item>`;
}
function feed(...items) { return `<rss version="2.0"><channel>${items.join('')}</channel></rss>`; }
const rss = feed(item('v1.2.1', 'Tue, 13 Oct 2026 12:00:00 GMT'));

describe('published patch-note mirror', () => {
  it('filters research and future posts and sorts versions on matching dates', () => {
    const entries = parseFeed(feed(
      item('v1.2.0', 'Sat, 10 Oct 2026 12:00:00 GMT', 'Patch Notes', url.replace('1-2-1', '1-2-0')),
      item('v1.1.2', 'Sat, 10 Oct 2026 12:00:00 GMT', 'Patch Notes', url.replace('1-2-1', '1-1-2')),
      item('v1.2.1', 'Tue, 13 Oct 2026 12:00:00 GMT'),
      item('v2.0.0', 'Tue, 13 Oct 2027 12:00:00 GMT'),
      item('v1.3.0', 'Tue, 13 Oct 2026 12:00:00 GMT', 'Research'),
    ), Date.parse('2026-10-15'));
    expect(entries.map((entry) => entry.version)).toEqual(['v1.1.2', 'v1.2.0', 'v1.2.1']);
    expect(planSync(entries).pending.map((entry) => entry.version)).toEqual(['v1.2.1']);
    expect(planSync(entries).seen).toHaveLength(2);
  });

  it('extracts the article body and converts lists and relative links without site chrome', () => {
    const body = articleToMarkdown(article, { version: 'v1.2.1', id: url });
    expect(body).toContain('## Added');
    expect(body).toContain('-   Choose New line or Send & hold Enter');
    expect(body).toContain('[Get Loquela](https://www.getloquela.com/download)');
    expect(body).toContain(`[Full patch notes on the Loquela website](${url})`);
    expect(body).not.toMatch(/Published October|2 min read|privateCode|Back to all posts/);
  });

  it('fails closed on changed article structure, mismatched versions, and foreign feed links', () => {
    expect(() => articleToMarkdown('<main><article><h1>Android v1.2.1</h1></article></main>', { version: 'v1.2.1', id: url })).toThrow('No full patch notes');
    expect(() => articleToMarkdown(article, { version: 'v2.0.0', id: url })).toThrow('does not match');
    expect(() => parseFeed(feed(item('v1.2.1', 'Tue, 13 Oct 2026 12:00:00 GMT', 'Patch Notes', 'https://other.example/blog/notes')))).toThrow('Unexpected');
    expect(() => parseFeed('<rss>')).toThrow('valid RSS');
  });

  it('only queues unseen articles after initialization and refuses corrupt state', () => {
    const entries = parseFeed(rss);
    expect(planSync(entries, { version: 1, seen: [url] }).pending).toEqual([]);
    expect(() => planSync(entries, { version: 2, seen: [] })).toThrow('refusing to reset');
  });

  function harness({ existing, saveFails = false } = {}) {
    const notFound = () => Promise.reject(Object.assign(new Error('Not found'), { status: 404 }));
    const repos = {
      getContent: vi.fn(notFound),
      getReleaseByTag: vi.fn(existing ? async () => ({ data: existing }) : notFound),
      createRelease: vi.fn(async () => ({ data: { id: 1 } })),
      createOrUpdateFileContents: vi.fn(async () => { if (saveFails) throw new Error('Save failed'); }),
    };
    const summary = { addHeading: () => summary, addRaw: () => summary, write: async () => {} };
    return {
      repos,
      args: {
        github: { rest: { repos } },
        context: { repo: { owner: 'koaque', repo: 'loquela-reddit' }, sha: 'abc123' },
        core: { info: () => {}, summary },
        fetchImpl: vi.fn(async (requested) => new Response(requested.endsWith('/feed.xml') ? rss : article)),
      },
    };
  }

  it('publishes the actual full notes and saves the exact article identity', async () => {
    const { repos, args } = harness();
    expect(await syncPublishedNotes(args)).toEqual({ mirrored: 1, pending: 1 });
    const release = repos.createRelease.mock.calls[0][0];
    expect(release).toMatchObject({ tag_name: 'v1.2.1', draft: false, prerelease: false });
    expect(release.body).toContain('## Added');
    const state = JSON.parse(Buffer.from(repos.createOrUpdateFileContents.mock.calls[0][0].content, 'base64').toString());
    expect(state).toEqual({ version: 1, seen: [url] });
  });

  it('recovers a successful release after a state-save failure without publishing it twice', async () => {
    const first = harness({ saveFails: true });
    await expect(syncPublishedNotes(first.args)).rejects.toThrow('Save failed');
    expect(first.repos.createRelease).toHaveBeenCalledOnce();
    const retry = harness({ existing: { body: `Notes from ${url}`, draft: false, prerelease: false } });
    expect(await syncPublishedNotes(retry.args)).toEqual({ mirrored: 0, pending: 1 });
    expect(retry.repos.createRelease).not.toHaveBeenCalled();
    expect(retry.repos.createOrUpdateFileContents).toHaveBeenCalledOnce();
  });

  it('does not overwrite an unrelated release with the same tag', async () => {
    const { repos, args } = harness({ existing: { body: 'Unrelated release', draft: false, prerelease: false } });
    await expect(syncPublishedNotes(args)).rejects.toThrow('refusing to overwrite');
    expect(repos.createRelease).not.toHaveBeenCalled();
    expect(repos.createOrUpdateFileContents).not.toHaveBeenCalled();
  });
});
