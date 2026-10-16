import { parse } from 'node-html-parser';

import { articleToMarkdown, FEED_URL, fetchText, parseFeed, planSync } from './sync-published-notes.mjs';

const STATE_PATH = '.github/facebook-post-state.json';
const GRAPH_VERSION = 'v26.0';
const MAX_POSTS_PER_RUN = 5;

export function formatFacebookPost(html, entry) {
  // Validate the same full, published article used by the Reddit release mirror.
  articleToMarkdown(html, entry);
  const article = parse(html).querySelector('main article');
  const summary = article.querySelector('h1 + p')?.text.replace(/\s+/g, ' ').trim();
  if (!summary || summary.length < 20) throw new Error(`No published summary found for ${entry.version}.`);
  // Reuse the owner's published summary verbatim; Facebook does not render Markdown.
  return {
    message: `Loquela ${entry.version} - Patch Notes\n\n${summary}\n\nFull patch notes: ${entry.id}`,
    link: entry.id,
  };
}

export function createFacebookClient({ pageId, pageToken, fetchImpl = fetch }) {
  if (!/^\d+$/.test(pageId ?? '') || !pageToken?.trim()) {
    throw new Error('Facebook requires the configured Page ID and encrypted Page token.');
  }

  async function request(path, { method = 'GET', params = {} } = {}) {
    const url = new URL(`https://graph.facebook.com/${GRAPH_VERSION}/${path}`);
    if (method === 'GET') url.search = new URLSearchParams(params).toString();
    const response = await fetchImpl(url.href, {
      method,
      headers: {
        Authorization: `Bearer ${pageToken}`,
        ...(method === 'POST' ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(method === 'POST' ? { body: JSON.stringify(params) } : {}),
      redirect: 'error',
      signal: AbortSignal.timeout(30_000),
    });
    const data = await response.json();
    if (!response.ok || data.error) {
      // Provider messages can echo request data. Never log a response or token.
      const code = Number.isInteger(data.error?.code) ? data.error.code : 'unknown';
      throw new Error(`Facebook API request failed: HTTP ${response.status}, code ${code}. Check the Page token and publishing permissions.`);
    }
    return data;
  }

  return {
    async verifyPage() {
      const page = await request(pageId, { params: { fields: 'id,name' } });
      if (page.id !== pageId || page.name !== 'Loquela') {
        throw new Error('The Facebook token does not identify the configured Loquela Page.');
      }
      return page;
    },
    async recentPosts() {
      const result = await request(`${pageId}/published_posts`, {
        params: { fields: 'id,message,permalink_url', limit: '100' },
      });
      if (!Array.isArray(result.data)) throw new Error('Facebook returned an unexpected published-post list.');
      return result.data;
    },
    async publish(post) {
      // Do not automatically retry POST. A later run reconciles uncertain outcomes.
      const result = await request(`${pageId}/feed`, { method: 'POST', params: post });
      if (typeof result.id !== 'string' || !result.id.startsWith(`${pageId}_`)) {
        throw new Error('Facebook did not return the expected Page post ID. The next run will reconcile before retrying.');
      }
      return result.id;
    },
  };
}

export async function syncFacebookPosts({ github, context, core, pageId, pageToken, fetchImpl = fetch }) {
  const facebook = createFacebookClient({ pageId, pageToken, fetchImpl });
  const repo = { owner: context.repo.owner, repo: context.repo.repo };
  let stored;
  try {
    stored = (await github.rest.repos.getContent({ ...repo, path: STATE_PATH, ref: 'main' })).data;
  } catch (error) {
    if (error.status !== 404) throw error;
  }
  const state = stored ? JSON.parse(Buffer.from(stored.content, 'base64').toString('utf8')) : undefined;
  if (state && state.pageId !== pageId) throw new Error('Facebook sync state belongs to another Page; refusing to reuse it.');
  const entries = parseFeed(await fetchText(FEED_URL, fetchImpl));
  const { pending, seen } = planSync(entries, state);
  await facebook.verifyPage();
  const recentPosts = pending.length ? await facebook.recentPosts() : [];
  const receipts = { ...(state?.receipts ?? {}) };
  let sha = stored?.sha;
  let posted = 0;
  let reconciled = 0;

  for (const entry of pending.slice(0, MAX_POSTS_PER_RUN)) {
    const existing = recentPosts.find((post) =>
      typeof post.id === 'string' && post.id.startsWith(`${pageId}_`) &&
      post.message?.includes(`Loquela ${entry.version} - Patch Notes`) &&
      post.message?.includes(entry.id)
    );
    let postId;
    if (existing) {
      postId = existing.id;
      reconciled += 1;
    } else {
      const post = formatFacebookPost(await fetchText(entry.id, fetchImpl), entry);
      postId = await facebook.publish(post);
      posted += 1;
    }
    receipts[entry.id] = postId;
    seen.push(entry.id);
    // Save each receipt immediately. If this fails, the Page post itself is the
    // recovery record and the next run reconciles it before attempting a POST.
    const saved = await github.rest.repos.createOrUpdateFileContents({
      ...repo,
      path: STATE_PATH,
      branch: 'main',
      message: `Record Facebook patch-note delivery for ${entry.version}`,
      content: Buffer.from(`${JSON.stringify({ version: 1, pageId, seen, receipts }, null, 2)}\n`).toString('base64'),
      ...(sha ? { sha } : {}),
    });
    sha = saved.data.content.sha;
    core.info(`Facebook patch notes delivered: ${entry.version}, post ${postId}`);
  }

  await core.summary.addHeading('Loquela Facebook patch notes')
    .addRaw(`Published ${posted} update(s), reconciled ${reconciled} existing post(s). Only new published website patch notes are considered.`)
    .write();
  return { posted, reconciled };
}
