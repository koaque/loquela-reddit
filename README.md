# Loquela Reddit Patch Notes

A small Reddit Devvit app that checks GitHub Releases every ten minutes and posts new release notes to the subreddit where the app is installed. It is designed for `r/Loquela`, uses Devvit-hosted infrastructure, and does not require a separate server.

## What it does

- Uses GitHub Releases as the source of truth.
- Ignores drafts and ignores prereleases by default.
- Posts as the Devvit app account with the title `Loquela {tag} - Patch Notes`.
- Preserves the GitHub release Markdown and adds release, download, and website links.
- Records each release in installation-scoped Redis before posting so scheduled or manual checks do not create duplicates.
- Applies a `Patch Notes` flair when a matching post-flair template exists.
- Adds a moderator-only **Check Loquela releases now** subreddit menu action.

The default first run records existing releases without posting them. Enable **Post the current release on first run** in the installation settings if the current GitHub release should be posted immediately.

## Fetch Domains

The app requests one external hostname:

- `api.github.com` — reads the configured repository's public release metadata and release notes. The app does not write to GitHub.

Reddit requires apps using HTTP Fetch to provide public Privacy Policy and Terms links. This repository includes [PRIVACY.md](PRIVACY.md) and [TERMS.md](TERMS.md); publish the repository and use the public URLs to those files in the Devvit app details.

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
5. **Post flair text** — defaults to `Patch Notes`; create a matching post-flair template in the subreddit first.
6. Website/download links — prefilled with Loquela's public pages and removable.

For a public repository, no GitHub token is normally needed. If GitHub rate limiting becomes a problem, set the optional global `githubToken` secret with:

```sh
npx devvit settings set githubToken
```

Use a fine-grained, read-only token with access only to the required repository.

## Deploy

```sh
npm run upload
npm run publish
```

Uploading submits the requested `api.github.com` fetch domain for Reddit review. Most domain requests require review before fetch works outside development. Complete the app details in the Reddit developer portal, including the Privacy Policy and Terms URLs, then install the approved version in `r/Loquela`.

## Duplicate prevention

The app takes an installation-wide lock and atomically claims each GitHub release in Redis before creating its Reddit post. A successfully posted release is permanently associated with its Reddit post ID. An extremely rare platform interruption after a claim but before confirmation deliberately leaves the release claimed; this favors preventing duplicates over an automatic retry with an ambiguous outcome.

