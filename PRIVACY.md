# Privacy Policy

Effective: September 29, 2026

Loquela Reddit Patch Notes is an automated Reddit Devvit app operated by Praxis Dynamics LLC for publishing software release notes.

## Data the app processes

The app reads GitHub release metadata from the repository configured by the subreddit moderators. This includes release IDs, version tags, publication dates, release-note text, and release URLs. A private repository may be accessed with a fine-grained read-only GitHub token stored as an encrypted Devvit app secret.

The app stores the following installation-scoped operational data in Reddit Devvit Redis:

- GitHub release IDs already seen or posted;
- the Reddit post ID created for a release; and
- short-lived processing locks.

The app does not collect Reddit passwords, private messages, email addresses, payment information, browsing history, repository source code, or the content users type into Loquela.

## How data is used and shared

Release information is used only to create the requested patch-note posts and prevent duplicates. Operational data is not sold, used for advertising, or shared with third parties. GitHub release notes selected by the repository owner are posted publicly to the subreddit where the app is installed.

## Retention and deletion

Release IDs and Reddit post IDs are retained while the app remains installed so duplicate posts can be prevented. Uninstalling the app subjects installation data to Reddit's Devvit data-handling lifecycle. Subreddit moderators may contact the operator to request assistance with app data.

## Contact

Questions may be sent to info@getloquela.com.

