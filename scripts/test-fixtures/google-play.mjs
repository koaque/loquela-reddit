import { PACKAGE_ID } from '../google-play-live.mjs';

// Minimal structural fixture from the public Play listing read November 19, 2026.
export function playFixture({ version = '1.6.5', packageId = PACKAGE_ID,
  structuredPackage = PACKAGE_ID, available = true, notes = 'New release notes displayed by Google Play.',
  key = 'ds:5', corrupt = false, duplicate = false } = {}) {
  const app = { '@type': 'SoftwareApplication', name: 'Loquela - Voice Keyboard', operatingSystem: 'ANDROID',
    url: `https://play.google.com/store/apps/details?id=${structuredPackage}`,
    offers: [{ availability: available ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock' }] };
  const details = [];
  details[0] = [app.name];
  details[112] = { '141': [[[version]]], '145': [null, [null, notes]] };
  const data = [[], [null, null, details, { '12': [[packageId, 7]] }]];
  const script = `<script>AF_initDataCallback({key: '${key}', hash: '9', data:${corrupt ? 'NOT_JSON' : JSON.stringify(data)}, sideChannel: {}});</script>`;
  return `<script type="application/ld+json">${JSON.stringify(app)}</script>${script}${duplicate ? script : ''}`;
}
