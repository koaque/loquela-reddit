import type { BotConfig, GitHubRelease, ReleasePost } from './types';

const MAX_TITLE_LENGTH = 300;
const MAX_BODY_LENGTH = 39_500;

function cleanMarkdown(markdown: string): string {
  return markdown
    .replace(/\r\n?/g, '\n')
    .replace(/<!--[^]*?-->/g, '')
    .replace(/\n{4,}/g, '\n\n\n')
    .trim();
}

function validHttpUrl(value: string | undefined): string | undefined {
  if (!value?.trim()) return undefined;

  try {
    const parsed = new URL(value.trim());
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.toString() : undefined;
  } catch {
    return undefined;
  }
}

function markdownLink(label: string, value: string | undefined): string | undefined {
  const url = validHttpUrl(value);
  if (!url) return undefined;
  return `[${label}](${url.replaceAll(')', '%29')})`;
}

function truncateAtBoundary(value: string, maximum: number): string {
  if (value.length <= maximum) return value;
  const candidate = value.slice(0, maximum - 1);
  const boundary = Math.max(candidate.lastIndexOf('\n'), candidate.lastIndexOf(' '));
  return `${candidate.slice(0, boundary > maximum * 0.75 ? boundary : undefined).trimEnd()}…`;
}

export function formatReleasePost(release: GitHubRelease, config: BotConfig): ReleasePost {
  const version = release.tag_name.trim() || release.name?.trim() || `release-${release.id}`;
  const title = truncateAtBoundary(
    `${config.titleProductName.trim() || 'Loquela'} ${version} - Patch Notes`,
    MAX_TITLE_LENGTH
  );

  const footerLinks = [
    markdownLink('Full release on GitHub', release.html_url),
    markdownLink('Download Loquela', config.downloadUrl),
    markdownLink('Loquela website', config.websiteUrl),
  ].filter((link): link is string => Boolean(link));

  const footer = footerLinks.length > 0 ? `\n\n---\n\n${footerLinks.join(' · ')}` : '';
  const releaseNotes = cleanMarkdown(release.body ?? '') || '_No release notes were provided._';
  const allowedNotesLength = Math.max(0, MAX_BODY_LENGTH - footer.length);
  const body = `${truncateAtBoundary(releaseNotes, allowedNotesLength)}${footer}`;

  return { title, body };
}

