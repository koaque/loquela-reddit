import { createHash } from 'node:crypto';
import { parse } from 'node-html-parser';

export const PACKAGE_ID = 'com.praxisdynamics.loquela';
export const PLAY_URL = `https://play.google.com/store/apps/details?id=${PACKAGE_ID}&hl=en_US&gl=US`;

// This is Google's public, logged-out US listing, not a submitted release or
// website version. Its undocumented page format may change: fail closed then.
// Parse embedded JSON as data only; never evaluate Google's JavaScript.
export function parsePlayListing(html) {
  const root = parse(html);
  const apps = root.querySelectorAll('script[type="application/ld+json"]')
    .map(script => JSON.parse(script.text))
    .filter(value => value?.['@type'] === 'SoftwareApplication');
  if (apps.length !== 1) throw new Error('Play listing identity is unavailable.');
  const app = apps[0];
  const identity = new URL(app.url);
  if (identity.origin !== 'https://play.google.com' || !identity.pathname.startsWith('/store/apps/details') ||
      identity.searchParams.get('id') !== PACKAGE_ID || app.operatingSystem !== 'ANDROID' ||
      app.name !== 'Loquela - Voice Keyboard' ||
      !Array.isArray(app.offers) || !app.offers.some(offer => offer.availability === 'https://schema.org/InStock')) {
    throw new Error('The intended publicly available Loquela Play listing was not confirmed.');
  }
  const scripts = root.querySelectorAll('script').map(script => script.text)
    .filter(text => /^AF_initDataCallback\(\{key:\s*['"]ds:5['"],/.test(text));
  if (scripts.length !== 1) throw new Error('Play version data format is unavailable.');
  const start = scripts[0].indexOf('data:');
  const end = scripts[0].lastIndexOf(', sideChannel:');
  if (start < 0 || end <= start) throw new Error('Play version data format changed.');
  const data = JSON.parse(scripts[0].slice(start + 5, end));
  const details = data?.[1]?.[2];
  const packageId = data?.[1]?.[3]?.['12']?.[0]?.[0];
  const version = details?.[112]?.['141']?.[0]?.[0]?.[0];
  const notes = details?.[112]?.['145']?.[1]?.[1];
  if (packageId !== PACKAGE_ID || details?.[0]?.[0] !== app.name ||
      typeof version !== 'string' || !/^\d+\.\d+\.\d+$/.test(version) ||
      typeof notes !== 'string' || notes.trim().length < 20) {
    throw new Error('Exact live Play version and release notes were not confirmed.');
  }
  return { packageId, version: `v${version}`, releaseNotes: parse(notes).text.trim() };
}

export async function readLivePlayRelease({ fetchImpl = fetch, now = Date.now() } = {}) {
  const response = await fetchImpl(PLAY_URL, {
    redirect: 'error', signal: AbortSignal.timeout(30000),
    headers: { Accept: 'text/html', 'Accept-Language': 'en-US', 'Cache-Control': 'no-cache' },
  });
  if (!response.ok || !response.headers.get('content-type')?.includes('text/html')) {
    throw new Error('Public Play listing unavailable; Facebook publication held.');
  }
  const html = await response.text();
  if (html.length > 5_000_000) throw new Error('Unexpected Play listing size; publication held.');
  const live = parsePlayListing(html);
  return { ...live, source: PLAY_URL, checkedAt: new Date(now).toISOString(),
    listingSha256: createHash('sha256').update(html).digest('hex') };
}
