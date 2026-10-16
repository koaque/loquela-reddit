# Privacy Policy

Effective: September 29, 2026

Updated: October 15, 2026

Loquela Reddit Patch Notes is an automated Reddit Devvit app operated by Praxis Dynamics LLC for publishing software release notes.

The same repository also contains a GitHub Actions workflow that copies already public Loquela website patch notes to GitHub Releases, and an optional Facebook Page publisher called Loquela Page Updates. Facebook publishing remains disabled until the Page is connected by its operator.

## Data the app processes

The app reads GitHub release metadata from the repository configured by the subreddit moderators. This includes release IDs, version tags, publication dates, release-note text, and release URLs. A private repository may be accessed with a fine-grained read-only GitHub token stored as an encrypted Devvit app secret.

The app stores the following installation-scoped operational data in Reddit Devvit Redis:

- GitHub release IDs already seen or posted;
- the Reddit post ID created for a release; and
- short-lived processing locks.

For the website sync and optional Facebook publisher, the workflow reads public patch-note articles from `www.getloquela.com`. It records the article URLs already seen and public delivery IDs in this public GitHub repository. For Facebook it reads only the configured Page's identity and recent Page-published posts to verify the destination and prevent duplicates, and publishes the approved website summary and article link to that Page. It does not read visitor messages or comments or manage advertising.

If Facebook is connected, its Page access token is held as an encrypted GitHub Actions repository secret. It is passed only to the publishing step and used in authorization headers sent to `graph.facebook.com`. The token is not committed, included in public delivery state, or intentionally written to logs. GitHub and Meta provide the infrastructure for this processing under their respective policies.

The app does not collect Reddit passwords, private messages, email addresses, payment information, browsing history, repository source code, or the content users type into Loquela.

## How data is used and shared

Release information is used only to create the requested patch-note posts and prevent duplicates. Operational data is not sold, used for advertising, or shared with third parties. GitHub release notes selected by the repository owner are posted publicly to the subreddit where the app is installed.

## Retention and deletion

Release IDs and Reddit post IDs are retained while the app remains installed so duplicate posts can be prevented. Uninstalling the app subjects installation data to Reddit's Devvit data-handling lifecycle. Subreddit moderators may contact the operator to request assistance with app data.

Public website and Facebook delivery receipts remain in GitHub repository history to prevent duplicates. The operator can disable Facebook publishing by removing its `FACEBOOK_PAGE_ID` Actions variable, revoke the integration in Meta, and remove the encrypted token from GitHub. Removing a workflow does not delete posts already published on Reddit or Facebook.

## Contact

Questions may be sent to info@getloquela.com.

