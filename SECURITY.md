# Security

## Reporting a problem

Please report security problems privately, through GitHub: open the Security tab on
https://github.com/internalfx/rook and choose "Report a vulnerability". Don't open a public issue
for them.

You'll get an acknowledgement within a week. Fixes land on `main` and are noted in CHANGELOG.md,
and you'll be credited there unless you'd rather not be.

## What's covered

ROOK itself: the server, its pages and the tools the model can call. Problems in the Lemonade
server, Slack, ntfy or the models themselves belong with their makers.

There are no releases yet; the latest commit on `main` is what gets fixes.

## Known limits

ROOK is meant for a server shared by people who trust one another, such as a household or a small
team. Two things are on the roadmap and worth knowing until they're done:

- The notification test button has the server send a request to whatever ntfy URL a logged-in user
  has saved, so a user can make the server reach any address.
- Slack tokens, and the Lemonade server's API key, are stored in the database as entered, not
  encrypted. Anyone with the database file has them.
- Until the first account exists, the setup pages are open to anyone who can reach the server, so
  a new install should be set up right after it's started.
