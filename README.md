# Loquela Reddit Patch Notes

A small Reddit Devvit app that checks GitHub Releases every ten minutes and posts new release notes to the subreddit where the app is installed. It is designed for `r/Loquela`, uses Devvit-hosted infrastructure, and does not require a separate server.

## What it does

- Uses GitHub Releases as the source of truth.
- Ignores drafts and ignores prereleases by default.
- Posts as the Devvit app account with the title `Loquela {tag} - Patch Notes`.
- Preserves the GitHub release Markdown and adds release, download, and website links.
- Records each release in installation-scoped Redis before posting so scheduled or manual checks do not create duplicates.
- Reconciles exact-title matches against recent subreddit posts and lets abandoned claims expire, so transient failures can retry without normally duplicating a successful post.
- Creates a moderator-only `Patch Notes` flair when needed and applies it to release posts.
- Adds a moderator-only **Check Loquela releases now** subreddit menu action.

The default first run records existing releases without posting them. Enable **Post the current release on first run** in the installation settings if the current GitHub release should be posted immediately.

## Fetch Domains

The app requests one external hostname:

- `api.github.com` — reads the configured repository's release metadata and release notes. The app does not write to GitHub.

Reddit requires apps using HTTP Fetch to provide public Privacy Policy and Terms links. The live app uses the public [Privacy Policy](https://github.com/koaque/loquela-reddit/blob/main/PRIVACY.md) and [Terms](https://github.com/koaque/loquela-reddit/blob/main/TERMS.md) from this repository.

## Local setup

Use Node.js 24 or newer.

```sh
npm install
npm test
npm run login
npm run dev
```

`npm run dev` playtests against `r/Loquela` by default. If the app slug `loquela-patchnotes` is unavailable, change `name` in `devvit.json` to another lowercase, 3–20 character slug.

## Installation settings

After installing the app in `r/Loquela`, open its installation settings and configure:

1. **GitHub repository owner** — the account or organization that owns the Loquela repository.
2. **GitHub repository name** — the repository containing GitHub Releases.
3. **Post prereleases** — off by default.
4. **Post the current release on first run** — off by default to prevent surprise posts.
5. **Include the GitHub release link** — disable this for private repositories.
6. **Post flair text** — defaults to `Patch Notes`; the app creates a moderator-only matching template when needed.
7. Website/download links — prefilled with Loquela's public pages and removable.

For a public repository, no GitHub token is normally needed. Private repositories require the optional global `githubToken` secret:

```sh
npx devvit settings set githubToken
```

Use a fine-grained, read-only token with access only to the required repository.

The production installation uses a non-expiring fine-grained token restricted to `koaque/loquela-android` with read-only Contents and Metadata access. The token is stored as an encrypted Devvit app secret and is never committed to this repository.

## Deploy

```sh
npm run upload
npm run publish
```

Complete the app details in the Reddit developer portal, including the Privacy Policy and Terms URLs, then install the uploaded version in a test community or publish it for broader installation. `api.github.com` is on Devvit's global fetch allowlist, so it does not appear as a domain-exception request.

## Production deployment

Version `0.0.4` is published as an unlisted Devvit app and installed in `r/Loquela` with these settings:

- GitHub owner: `koaque`
- GitHub repository: `loquela-android`
- Prereleases: disabled
- Post current release on first run: disabled
- GitHub release link: disabled because the source repository is private
- Title product name: `Loquela`
- Flair text: `Patch Notes`
- Check interval: every ten minutes

The production checks completed successfully on September 29, 2026. No GitHub Releases existed at initialization, so no Reddit post was created. Version `0.0.2` created and verified the moderator-only `Patch Notes` flair; version `0.0.4` adds expiring claims and recent-post reconciliation for retry-safe delivery. The first future published release will be posted automatically.

## Duplicate prevention

The app takes an installation-wide lock and atomically claims each GitHub release in Redis before creating its Reddit post. A successfully posted release is permanently associated with its Reddit post ID. An extremely rare platform interruption after a claim but before confirmation deliberately leaves the release claimed; this favors preventing duplicates over an automatic retry with an ambiguous outcome.

