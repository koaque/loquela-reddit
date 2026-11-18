import { createHash } from 'node:crypto';
import { parse } from 'node-html-parser';
import { articleToMarkdown, FEED_URL, fetchText, parseFeed } from './sync-published-notes.mjs';

export const PAGE_ID = '998141173385319';
export const STATE_PATH = '.github/facebook-post-state.json';
export const BASELINE = 'v1.6.4';
const GRAPH_VERSION = 'v27.0';

export function afterBaseline(version) {
  if (!/^v\d+\.\d+\.\d+$/.test(version ?? '')) throw new Error('An exact stable Android version is required.');
  const parts = version.slice(1).split('.').map(Number);
  if (!parts.every(Number.isSafeInteger)) throw new Error('Invalid version.');
  const base = [1, 6, 4];
  for (let i = 0; i < 3; i++) if (parts[i] !== base[i]) return parts[i] > base[i];
  return false;
}

export function formatFacebookPost(html, entry) {
  articleToMarkdown(html, entry);
  const summary = parse(html).querySelector('main article h1 + p')?.text.replace(/\s+/g, ' ').trim();
  if (!summary || summary.length < 20) throw new Error('No published article summary.');
  return { message: `Loquela ${entry.version} - Patch Notes\n\n${summary}\n\nFull patch notes: ${entry.id}`, link: entry.id };
}

export function payloadHash(post) {
  return createHash('sha256').update(JSON.stringify({ message: post.message, link: post.link }) + '\n').digest('hex');
}

export function validateApproval({ approval, hash, publishingEnabled, now = Date.now() }) {
  if (publishingEnabled !== true) throw new Error('Facebook publishing is disabled.');
  if (!approval || approval.payloadSha256 !== hash || !/^[a-f0-9]{64}$/.test(hash)) throw new Error('Exact payload approval is required.');
  if (approval.liveOnPlay !== true) throw new Error('Confirmed live Play availability is required.');
  let url;
  try { url = new URL(approval.liveEvidenceUrl); } catch { throw new Error('Play listing evidence is required.'); }
  if (url.origin !== 'https://play.google.com' || url.pathname !== '/store/apps/details' || url.searchParams.get('id') !== 'com.praxisdynamics.loquela') throw new Error('Evidence must identify the Loquela Play listing.');
  const checked = Date.parse(approval.liveCheckedAt);
  if (!Number.isFinite(checked) || checked > now || now - checked > 86400000) throw new Error('Play verification must be from the last 24 hours.');
  for (const key of ['ownerApprovalReference', 'reviewReleaseReference']) {
    if (typeof approval[key] !== 'string' || approval[key].trim().length < 8 || approval[key].length > 500) throw new Error('Owner approval and review-release references are required.');
  }
}

export function createFacebookClient({ pageId, pageToken, fetchImpl = fetch }) {
  if (pageId !== PAGE_ID || !pageToken?.trim()) throw new Error('The intended Loquela Page ID and encrypted token are required.');
  async function request(path, { method = 'GET', params = {} } = {}) {
    const url = new URL(`https://graph.facebook.com/${GRAPH_VERSION}/${path}`);
    if (method === 'GET') url.search = new URLSearchParams(params).toString();
    let response, data;
    try {
      response = await fetchImpl(url.href, {
        method, headers: { Authorization: `Bearer ${pageToken}`, ...(method === 'POST' ? { 'Content-Type': 'application/json' } : {}) },
        ...(method === 'POST' ? { body: JSON.stringify(params) } : {}), redirect: 'error', signal: AbortSignal.timeout(30000),
      });
      data = await response.json();
    } catch { throw new Error(`Facebook ${method} outcome unavailable; no automatic publish retry.`); }
    if (!response.ok || data.error) {
      const code = Number.isInteger(data.error?.code) ? data.error.code : 'unknown';
      throw new Error(`Facebook HTTP ${response.status}, code ${code}; check access. No automatic publish retry.`);
    }
    return data;
  }
  return {
    async verifyPage() {
      const page = await request(pageId, { params: { fields: 'id,name,link' } });
      if (page.id !== PAGE_ID || page.name !== 'Loquela') throw new Error('Wrong Facebook Page identity.');
      return page;
    },
    async recentPosts() {
      const posts = [], cursors = new Set();
      let after;
      for (let i = 0; i < 10; i++) {
        const result = await request(`${pageId}/published_posts`, { params: {
          fields: 'id,message,permalink_url,attachments{url,target}', limit: '100', ...(after ? { after } : {}),
        } });
        if (!Array.isArray(result.data)) throw new Error('Unexpected Page history response.');
        posts.push(...result.data);
        if (!result.paging?.next) return posts;
        after = result.paging.cursors?.after;
        if (!after || cursors.has(after)) throw new Error('Incomplete Page history; publishing held.');
        cursors.add(after);
      }
      throw new Error('Page history exceeds bounded check; publishing held.');
    },
    async publish(post) {
      const data = await request(`${pageId}/feed`, { method: 'POST', params: { ...post, published: true } });
      if (typeof data.id !== 'string' || !new RegExp(`^${PAGE_ID}_[0-9]+$`).test(data.id)) throw new Error('Uncertain publish receipt; reconciliation required.');
      return data.id;
    },
    async readPost(id) {
      if (!new RegExp(`^${PAGE_ID}_[0-9]+$`).test(id)) throw new Error('Unexpected post ID.');
      return request(id, { params: { fields: 'id,message,permalink_url,is_published' } });
    },
  };
}

function mentionsVersion(post, entry) {
  if (!post.id?.startsWith(`${PAGE_ID}_`)) return false;
  const version = entry.version.slice(1).replaceAll('.', '\\.');
  return new RegExp(`(?:^|[^0-9.])v?${version}(?![0-9.])`).test(post.message ?? '');
}

function matches(post, entry) {
  const links = post.attachments?.data?.flatMap(a => [a.url, a.target?.url]) ?? [];
  return mentionsVersion(post, entry) && ((post.message ?? '').includes(entry.id) || links.includes(entry.id));
}

export async function runFacebook({ github, context, core, mode = 'preview', version = '', pageId, pageToken,
  publishingEnabled = false, approval, fetchImpl = fetch, now = Date.now() }) {
  if (!['preview', 'verify', 'publish'].includes(mode)) throw new Error('Unknown operation.');
  const repo = { owner: context.repo.owner, repo: context.repo.repo };
  let stored;
  try { stored = (await github.rest.repos.getContent({ ...repo, path: STATE_PATH, ref: 'main' })).data; }
  catch { throw new Error('Facebook state unavailable; refusing to initialize or replay history.'); }
  const state = JSON.parse(Buffer.from(stored.content, 'base64').toString('utf8'));
  if (state.version !== 2 || state.pageId !== PAGE_ID || state.baselineVersion !== BASELINE || !state.attempts || typeof state.attempts !== 'object' || Array.isArray(state.attempts)) throw new Error('Invalid Facebook baseline/state.');
  let sha = stored.sha;
  const save = async () => {
    const saved = await github.rest.repos.createOrUpdateFileContents({ ...repo, path: STATE_PATH, branch: 'main', sha,
      message: 'Record Facebook patch-note transaction', content: Buffer.from(JSON.stringify(state, null, 2) + '\n').toString('base64') });
    sha = saved.data.content.sha;
  };
  const report = async text => { await core.summary.addHeading('Loquela Facebook patch notes').addRaw(text).write(); };
  if (mode === 'verify') {
    const facebook = createFacebookClient({ pageId, pageToken, fetchImpl });
    const page = await facebook.verifyPage(), posts = await facebook.recentPosts();
    const baselinePosts = posts.filter(p => /\b1\.6\.4\b/.test(p.message ?? '')).map(p => ({ id: p.id, permalink: p.permalink_url }));
    await report(`Read-only connection verified for ${page.name} (${page.id}). Read ${posts.length} posts. No publishing permission was exercised and no post was created. v1.6.4 and earlier remain excluded.`);
    return { mode, pageId: page.id, postsRead: posts.length, baselinePosts };
  }
  if (version && !afterBaseline(version)) throw new Error('v1.6.4 and earlier releases are permanently excluded.');
  const entries = parseFeed(await fetchText(FEED_URL, fetchImpl), now).filter(e => /^v\d+\.\d+\.\d+$/.test(e.version) && afterBaseline(e.version));
  const entry = version ? entries.find(e => e.version === version) : entries.at(-1);
  if (!entry) {
    if (version) throw new Error('Requested version is absent from the published feed.');
    await report('No Android release newer than v1.6.4 is available for preview. No post created.');
    return { mode: 'preview', status: 'no-candidate' };
  }
  const post = formatFacebookPost(await fetchText(entry.id, fetchImpl), entry), hash = payloadHash(post);
  if (mode === 'preview') {
    const escaped = post.message.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
    await report(`PREVIEW ONLY. Play availability is unverified.\n\n<pre>${escaped}</pre>\n\nLink: ${post.link}\n\nPayload SHA-256: \`${hash}\`\n\nTransaction: ${state.attempts[entry.version]?.status ?? 'none'}. No public post created.`);
    return { mode, version: entry.version, post, hash };
  }
  if (context.eventName !== 'workflow_dispatch' || !version) throw new Error('Publish requires a manual workflow and exact version.');
  validateApproval({ approval, hash, publishingEnabled, now });
  const facebook = createFacebookClient({ pageId, pageToken, fetchImpl });
  await facebook.verifyPage();
  const prior = state.attempts[entry.version];
  if (['verified', 'existing'].includes(prior?.status)) {
    await report(`${entry.version} is already recorded. No new post created.`);
    return { mode, status: 'already-recorded', postId: prior.postId };
  }
  const history = await facebook.recentPosts();
  const existing = history.filter(p => matches(p, entry));
  if (existing.length > 1) throw new Error('Multiple matching posts need review.');
  if (existing.length === 1) {
    state.attempts[entry.version] = { ...prior, status: 'existing', postId: existing[0].id, articleUrl: entry.id, reconciledAt: new Date(now).toISOString() };
    await save();
    await report(`Reconciled existing ${entry.version}. No new post created.`);
    return { mode, status: 'existing', postId: existing[0].id };
  }
  if (prior) throw new Error('Unresolved prior attempt; no retry permitted.');
  if (history.some(p => mentionsVersion(p, entry))) throw new Error('A possible manual announcement needs review; no duplicate risk will be taken.');
  const attempt = { status: 'pending', articleUrl: entry.id, payloadSha256: hash, attemptedAt: new Date(now).toISOString(),
    runId: String(context.runId), actor: context.actor, approval: { ...approval } };
  state.attempts[entry.version] = attempt;
  await save(); // Durable intent must precede the single POST.
  try {
    attempt.postId = await facebook.publish(post);
    const observed = await facebook.readPost(attempt.postId);
    if (observed.id !== attempt.postId || observed.message !== post.message || observed.is_published !== true) throw new Error('Readback does not confirm the exact published payload.');
    attempt.status = 'verified'; attempt.permalink = observed.permalink_url;
    await save();
    await report(`Published and read back ${entry.version}: ${observed.permalink_url ?? attempt.postId}`);
    return { mode, status: 'verified', postId: attempt.postId };
  } catch (error) {
    attempt.status = 'uncertain';
    try { await save(); } catch { /* Durable pending intent remains held. */ }
    throw error;
  }
}
