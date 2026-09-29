import { settings } from '@devvit/web/server';

import type { BotConfig } from '../core/types';

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function asBoolean(value: unknown): boolean {
  return value === true;
}

function optionalUrl(value: unknown, settingName: string): string | undefined {
  const raw = asString(value);
  if (!raw) return undefined;

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(`${settingName} must be a valid URL or left blank.`);
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error(`${settingName} must use https:// or http://.`);
  }
  return parsed.toString();
}

function validateRepositoryPart(value: string, settingName: string): string {
  if (!value) throw new Error(`${settingName} must be configured in the app's install settings.`);
  if (!/^[A-Za-z0-9_.-]+$/.test(value)) {
    throw new Error(`${settingName} contains unsupported characters.`);
  }
  return value;
}

export async function loadConfig(): Promise<BotConfig> {
  const [
    githubOwner,
    githubRepository,
    githubToken,
    includePrereleases,
    postCurrentOnFirstRun,
    includeGitHubReleaseLink,
    titleProductName,
    flairText,
    websiteUrl,
    downloadUrl,
  ] = await Promise.all([
    settings.get('githubOwner'),
    settings.get('githubRepository'),
    settings.get('githubToken'),
    settings.get('includePrereleases'),
    settings.get('postCurrentOnFirstRun'),
    settings.get('includeGitHubReleaseLink'),
    settings.get('titleProductName'),
    settings.get('flairText'),
    settings.get('websiteUrl'),
    settings.get('downloadUrl'),
  ]);

  const config: BotConfig = {
    githubOwner: validateRepositoryPart(asString(githubOwner), 'GitHub repository owner'),
    githubRepository: validateRepositoryPart(
      asString(githubRepository),
      'GitHub repository name'
    ),
    includePrereleases: asBoolean(includePrereleases),
    postCurrentOnFirstRun: asBoolean(postCurrentOnFirstRun),
    includeGitHubReleaseLink: includeGitHubReleaseLink !== false,
    titleProductName: asString(titleProductName) || 'Loquela',
  };

  const token = asString(githubToken);
  const flair = asString(flairText);
  const website = optionalUrl(websiteUrl, 'Website URL');
  const download = optionalUrl(downloadUrl, 'Download URL');
  if (token) config.githubToken = token;
  if (flair) config.flairText = flair;
  if (website) config.websiteUrl = website;
  if (download) config.downloadUrl = download;

  return config;
}

