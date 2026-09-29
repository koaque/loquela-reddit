export interface GitHubRelease {
  id: number;
  tag_name: string;
  name: string | null;
  body: string | null;
  html_url: string;
  draft: boolean;
  prerelease: boolean;
  published_at: string | null;
}

export interface BotConfig {
  githubOwner: string;
  githubRepository: string;
  githubToken?: string;
  includePrereleases: boolean;
  postCurrentOnFirstRun: boolean;
  titleProductName: string;
  flairText?: string;
  websiteUrl?: string;
  downloadUrl?: string;
}

export interface ReleasePost {
  title: string;
  body: string;
}

export interface CheckResult {
  status: 'ok' | 'locked';
  initialized: boolean;
  discovered: number;
  posted: number;
  skipped: number;
  postIds: string[];
}

