import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { parse } from 'node-html-parser';
import TurndownService from 'turndown';

export const FEED_URL = 'https://www.getloquela.com/feed.xml';
const SITE_ORIGIN = new URL(FEED_URL).origin;
const STATE_PATH = '.github/patch-note-sync-state.json';
const MAX_DOCUMENT_BYTES = 2_000_000;

function articleUrl(value) {
  const url = new URL(value);
  if (url.origin !== SITE_ORIGIN || !/^\/blog\/[a-z0-9-]+$/.test(url.pathname) || url.search || url.hash) {
    throw new Error(`Unexpected patch-note article URL: ${url}`);
  }
  return url.href;
}

export function parseFeed(xml, now = Date.now()) {
  if (XMLValidator.validate(xml) !== true || /<!DOCTYPE|<!ENTITY/i.test(xml)) {
    throw new Error('The published patch-note feed is not valid RSS XML.');
  }
  const data = new XMLParser({ ignoreAttributes: false, parseTagValue: false }).parse(xml);
  const items = data.rss?.channel?.item;
  if (!items) throw new Error('The published feed contains no items.');
  const entries = (Array.isArray(items) ? items : [items]).flatMap((item) => {
    const categories = Array.isArray(item.category) ? item.category : [item.category];
    if (!categories.includes('Patch Notes')) return [];
    const version = /^Android (v\d+\.\d+\.\d+(?:[-.][A-Za-z0-9.-]+)?)(?::|\s|$)/.exec(item.title)?.[1];
    // Legacy multi-version roundups are not individual releases.
    if (!version) return [];
    const publishedAt = Date.parse(item.pubDate);
    if (!Number.isFinite(publishedAt)) throw new Error(`Invalid publication date for ${version}.`);
    if (publishedAt > now) return [];
    return [{
      id: articleUrl(item.link),
      version,
      title: item.title,
      publishedAt,
    }];
  });
  if (!entries.length) throw new Error('The feed has no published, versioned patch notes.');
  if (new Set(entries.map((entry) => entry.version)).size !== entries.length) {
    throw new Error('The feed contains conflicting patch-note versions.');
  }
  return entries.sort((a, b) => a.publishedAt - b.publishedAt || a.version.localeCompare(b.version, 'en', { numeric: true }));
}

export function articleToMarkdown(html, entry) {
  const document = parse(html);
  const article = document.querySelector('main article');
  if (!article?.querySelector('h1')?.text.includes(entry.version)) {
    throw new Error(`The published article does not match ${entry.version}.`);
  }
  // The published article keeps its Markdown body in a direct child div.
  // Exclude the title, dates, status cards, navigation, and framework scripts.
  const body = article.childNodes.find((node) => node.tagName === 'DIV' && node.querySelector('h2'));
  if (!body?.querySelector('p, li')) throw new Error(`No full patch notes found for ${entry.version}.`);
  for (const node of body.querySelectorAll('script, style, iframe, form, nav, button')) node.remove();
  for (const link of body.querySelectorAll('a')) {
    const href = link.getAttribute('href');
    const url = href ? new URL(href, entry.id) : undefined;
    if (!url || !['https:', 'http:'].includes(url.protocol)) link.removeAttribute('href');
    else link.setAttribute('href', url.href);
  }
  const markdown = new TurndownService({ headingStyle: 'atx', bulletListMarker: '-' }).turndown(body.innerHTML).trim();
  if (markdown.length < 50) throw new Error(`Patch notes for ${entry.version} are unexpectedly short.`);
  return `${markdown}\n\n[Full patch notes on the Loquela website](${entry.id})`;
}

export function planSync(entries, state) {
  if (!state) return { pending: entries.slice(-1), seen: entries.slice(0, -1).map((entry) => entry.id) };
  if (state.version !== 1 || !Array.isArray(state.seen) || !state.seen.every((id) => typeof id === 'string')) {
    throw new Error('Invalid patch-note sync state; refusing to reset it and repost history.');
  }
  const seen = new Set(state.seen);
  return { pending: entries.filter((entry) => !seen.has(entry.id)), seen: [...seen] };
}

export async function fetchText(url, fetchImpl) {
  const response = await fetchImpl(url, { redirect: 'error', signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`Published content request failed with HTTP ${response.status}: ${url}`);
  // Bound even chunked responses before parsing HTML or XML.
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_DOCUMENT_BYTES) {
      await reader.cancel();
      throw new Error(`Published content is too large: ${url}`);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

export async function syncPublishedNotes({ github, context, core, fetchImpl = fetch }) {
  const repo = { owner: context.repo.owner, repo: context.repo.repo };
  let stored;
  try {
    stored = (await github.rest.repos.getContent({ ...repo, path: STATE_PATH, ref: 'main' })).data;
  } catch (error) {
    if (error.status !== 404) throw error;
  }
  const state = stored ? JSON.parse(Buffer.from(stored.content, 'base64').toString('utf8')) : undefined;
  const entries = parseFeed(await fetchText(FEED_URL, fetchImpl));
  const { pending, seen } = planSync(entries, state);
  let mirrored = 0;
  for (const entry of pending) {
    let existing;
    try {
      existing = (await github.rest.repos.getReleaseByTag({ ...repo, tag: entry.version })).data;
    } catch (error) {
      if (error.status !== 404) throw error;
    }
    if (existing && (existing.draft || existing.prerelease || !existing.body?.includes(entry.id))) {
      throw new Error(`Release ${entry.version} already exists with different content; refusing to overwrite it.`);
    }
    if (!existing) {
      const body = articleToMarkdown(await fetchText(entry.id, fetchImpl), entry);
      await github.rest.repos.createRelease({
        ...repo,
        tag_name: entry.version,
        target_commitish: context.sha,
        name: entry.title.replace(/^Android /, 'Loquela Android '),
        body,
        draft: false,
        prerelease: false,
        make_latest: 'true',
      });
      mirrored += 1;
      core.info(`Mirrored published patch notes: ${entry.version}`);
    }
    seen.push(entry.id);
  }
  if (!stored || pending.length) {
    await github.rest.repos.createOrUpdateFileContents({
      ...repo,
      path: STATE_PATH,
      branch: 'main',
      message: 'Record published patch-note sync state',
      content: Buffer.from(`${JSON.stringify({ version: 1, seen }, null, 2)}\n`).toString('base64'),
      ...(stored ? { sha: stored.sha } : {}),
    });
  }
  await core.summary.addHeading('Loquela patch-note sync')
    .addRaw(`Found ${entries.length} published patch-note articles. Created ${mirrored} GitHub release(s). The Reddit app checks these releases every ten minutes.`)
    .write();
  return { mirrored, pending: pending.length };
}
