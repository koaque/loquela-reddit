# Loquela Reddit Patch Notes

A small Reddit Devvit app that checks GitHub Releases every ten minutes and posts new release notes to the subreddit where the app is installed. For `r/Loquela`, a free GitHub Actions workflow mirrors the patch notes already published on the Loquela website into this public repository's Releases. No separate server or manually authored GitHub Release is needed.

## Published patch-note pipeline

`getloquela.com/feed.xml` → scheduled GitHub Actions sync → this repository's Releases → Devvit → `r/Loquela`.

The workflow runs every fifteen minutes and can also be run from GitHub Actions. It selects only published, versioned **Patch Notes** articles, copies their full article body as Reddit-compatible Markdown, and includes the public website article link. Research articles and future-dated entries are excluded. It does not read private Android source code or invent release copy.

On its first run, the sync mirrors only the newest article and records the rest as a baseline to avoid posting the entire archive. Later runs mirror each unseen article. State is kept in `.github/patch-note-sync-state.json`; release tags provide recovery if a run creates a release but fails before saving its state. Do not remove that state file to retry a failed run. Failed Actions runs remain visible in GitHub's normal workflow history and notification system.

The workflow uses GitHub's built-in, repository-scoped Actions token with Contents write permission. It needs no added secrets. This repository is public, so normal GitHub-hosted Actions usage is free. Allow about 25 minutes from website publication under normal scheduling, with additional delays possible from GitHub's scheduler.

The Releases in this repository contain Loquela **Android** patch notes. Devvit app versions are managed separately in the Reddit developer portal.

## Facebook Page publishing

Facebook uses the same published Android article feed as the Reddit mirror. On November 19, 2026, the owner authorized **automatic Facebook patch-note posts after the exact release is confirmed live on Google Play, without per-post approval**. This replaces the earlier manual-only Facebook gate. It does not change Reddit, X, advertising or other outreach authority.

The existing sync workflow checks every 15 minutes (GitHub scheduling can be delayed). After the Reddit mirror job, Facebook reads the public, logged-out [US Google Play listing](https://play.google.com/store/apps/details?id=com.praxisdynamics.loquela&hl=en_US&gl=US). It verifies the package identity, availability, exact stable version and release notes, then selects only the matching published website article. A newer website article alone never triggers a post. There is no historical catch-up; only the currently observed live version can be posted.

The public Play page has an undocumented data format. Missing or ambiguous identity/version, changed markup, consent pages and network failures **hold publication** and surface in Actions. The evidence confirms availability on that public listing, not a completed rollout to every country or device. No Play account, API credential or paid service is required. Every recorded attempt includes the Play version, source, checked time and listing SHA-256.

The separate **Facebook patch notes - manual** Actions workflow also supports:

- **preview**: select a version or leave it blank for the newest candidate; prepare the exact plain-text summary, source link and SHA-256. No Graph calls or publication.
- **verify**: GET-only checks of the Loquela Page identity and published posts. This does not prove the token has working publishing permission and creates no test post.
- **check**: read the real public Play listing and show the exact matching candidate, without Facebook credentials, state writes or publication. Code-change pushes use this mode.
- **auto**: run the same live-Play-gated automatic publisher immediately from `main`; no per-post approval JSON is needed. Scheduled and manually dispatched sync runs use this mode.
- **publish**: retained legacy path for one exact, separately approved manual release. Its original approval JSON requirements remain; normal automatic operation does not use this path.

### Connect once

Use a dedicated Meta app for the existing [GetLoquela Page](https://www.facebook.com/GetLoquela). Confirm the Page ID `998141173385319` through the authenticated account and API. Request only `pages_show_list`, `pages_read_engagement` and `pages_manage_posts`; verify any additional provider requirement before expanding access. Meta app creation, applicable terms and access grants must be completed by the authorized owner. Standard Access may cover an app-role user managing their own Page; confirm the actual dashboard requirements.

In this public repository's Actions settings, add:

- Encrypted secret `FACEBOOK_PAGE_TOKEN`: the Page access token. Never put the token, App Secret, login credentials or raw token responses in source, logs, workflow inputs or chat.
- Variable `FACEBOOK_PAGE_ID`: `998141173385319`.
- Variable `FACEBOOK_PUBLISH_ENABLED`: `true` for the owner's authorized automatic operation. Set `false` to stop all new Facebook publication.

Connecting the ID and token does **not** enable public posting. Run the manual workflow in **verify** mode first. A token can expire or be revoked; reconnect when required. Do not promise permanent credentials. The publishing process needs only the Page token, not the App Secret. GitHub's built-in token stores non-secret delivery receipts; no additional GitHub PAT is needed.

### Optional legacy manual release

1. Confirm the exact Android release is live on the public Google Play listing (not merely uploaded, committed, in review, present on the website, or mirrored to GitHub). Record the version, observer and checked time in the marketing review packet.
2. Run **preview** for that exact version. Review the complete message and source link. Obtain Jack's exact authorization plus the current applicable review release. No draft or placeholder reference is approval.
3. Supply the following `approval_json` structure using genuine references and the SHA-256 from the unchanged preview. References and receipts are public, so use non-secret identifiers rather than private review text. The SHA-256 is computed over UTF-8 `JSON.stringify({message, link})` plus one LF.

```json
{
  "payloadSha256": "REPLACE_WITH_APPROVED_64_CHARACTER_SHA256",
  "liveOnPlay": true,
  "liveEvidenceUrl": "https://play.google.com/store/apps/details?id=com.praxisdynamics.loquela",
  "liveCheckedAt": "REPLACE_WITH_ACTUAL_UTC_ISO_TIMESTAMP",
  "ownerApprovalReference": "REPLACE_WITH_EXACT_OWNER_AUTHORIZATION_REFERENCE",
  "reviewReleaseReference": "REPLACE_WITH_CURRENT_REVIEW_RELEASE_REFERENCE"
}
```

4. With `FACEBOOK_PUBLISH_ENABLED=true`, manually dispatch **publish** on `main` with the exact version. Play verification must be no older than 24 hours. Any material change requires fresh review and a matching hash. Setting the flag false also disables the authorized automatic publisher.

This legacy JSON records human verification; it is not used as proof by automatic mode. Automatic mode fetches the public Play evidence itself and records the standing November 19 authorization.

### Baseline and recovery

`v1.6.4` and **all earlier versions are permanently excluded**. Jack confirmed the 1.6.4 announcement already exists; this baseline does not claim every older version was posted. Missing or invalid `.github/facebook-post-state.json` fails closed instead of initializing and replaying the archive. Do not delete/reset it.

Before publishing, the job checks Page history for the version and source link, including attached links and pagination. It writes a durable `pending` attempt before exactly one POST and reads the resulting post back before reporting `verified`. A failed/ambiguous response or interrupted run stays held. A later run may reconcile an existing matching post, but will never automatically retry an unresolved attempt. This cannot guarantee exactly-once delivery after external edits or deletions; unresolved cases require owner review.

All public operations use the existing shared Actions concurrency group. The Facebook job waits for the Reddit mirror before writing its state. The owner's November 19 automatic-release instruction authorizes this specific scheduled publisher; earlier per-post owner/reviewer approvals do not apply to it. Uncertain outcomes and possible manual announcements still require reconciliation. Connection status is recorded in the marketing workspace, not inferred from this README.

### Validation

Run `npm run test:unit` with Node 24. Tests cover historical exclusion, token-free preview/check, automatic main-branch/event restrictions, exact public Play version matching, malformed/unavailable Play responses, legacy approvals, Page identity, pagination, durable intent, uncertain outcomes, duplicate reconciliation and readback. Tests use mocks and do not contact Facebook. Use **check** for real Play validation and **verify** for GET-only Page access. Never publish test posts.

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

The app still has the original fine-grained token restricted to `koaque/loquela-android` with read-only Contents and Metadata access. The production release source is now the public `koaque/loquela-reddit` repository; private Android repository access is not needed for the mirror. The token is stored as an encrypted Devvit app secret and is never committed to this repository.

## Deploy

```sh
npm run upload
npm run publish
```

Complete the app details in the Reddit developer portal, including the Privacy Policy and Terms URLs, then install the uploaded version in a test community or publish it for broader installation. `api.github.com` is on Devvit's global fetch allowlist, so it does not appear as a domain-exception request.

## Production deployment

Version `0.0.4` is published as an unlisted Devvit app and installed in `r/Loquela` with these settings:

- GitHub owner: `koaque`
- GitHub repository: `loquela-reddit`
- Prereleases: disabled
- Post current release on first run: enabled (newest release only)
- GitHub release link: enabled (the mirrored notes are public)
- Title product name: `Loquela`
- Flair text: `Patch Notes`
- Check interval: every ten minutes

On October 15, 2026, investigation found that `koaque/loquela-android` still had no GitHub Releases, despite multiple updates being published on the website. The new workflow connects the already published website notes to the bot's GitHub release input. Version `0.0.4` includes expiring claims and recent-post reconciliation for retries; `Patch Notes` flair is already configured.

The first workflow run passed all 16 tests and mirrored v1.2.1. The installed app then created [Loquela v1.2.1 - Patch Notes](https://www.reddit.com/r/Loquela/comments/1x74jkh/loquela_v121_patch_notes/) as `u/loquela-patchnotes`, with the full notes and public source links. Post flair was disabled at the subreddit level; it is now enabled so the app's already assigned `Patch Notes` flair is displayed.

A second live sync also passed and created zero additional GitHub releases. Repeating the Reddit release check left the same single v1.2.1 post in place.

## Duplicate prevention

The app takes an installation-wide lock and atomically claims each GitHub release in Redis before creating its Reddit post. A successfully posted release is permanently associated with its Reddit post ID. Abandoned claims expire after fifteen minutes. Before retrying, the app checks the 100 newest subreddit posts for an exact title match to reconcile an earlier successful submission.

