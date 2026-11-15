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

## Web browsing

The model reads web pages in a headless Chrome. Pages are written by whoever runs the site, so
ROOK treats them as untrusted:

- The browser reaches the network only through a proxy inside ROOK (`ai-tools/egressProxy.js`).
  The proxy only makes HTTPS connections, on port 443, to public addresses. It resolves each host
  itself and connects to the address it checked, so a page can't reach ROOK, the Lemonade server,
  the machine it runs on, the local network, a tailnet or a cloud metadata address. That holds
  for links, redirects, the page's own scripts and names that resolve to private addresses (DNS
  rebinding included).
- A page is only read from the sites listed in Admin → Tools. Every navigation is checked against
  the list, redirects included, and only `http(s)` URLs are opened.
- Page text and search results reach the model inside markers, with a note that they're
  information and not instructions.
- A reply's image from another site is shown as a link, not loaded. A Content-Security-Policy
  also keeps pages from loading images from elsewhere or sending requests anywhere but ROOK.
  Either could otherwise carry a chat's contents away.

Instructions hidden in a page can still sway the model. What it does with them is limited to the
tools a chat has: the user's own memories, tasks and reminders, and task requests to people who
allow them.

## Known limits

ROOK is meant for a server shared by people who trust one another, such as a household or a small
team. Two things are on the roadmap and worth knowing until they're done:

- The notification test button has the server send a request to whatever ntfy URL a logged-in user
  has saved, so a user can make the server reach any address.
- Slack tokens, and the Lemonade server's API key, are stored in the database as entered, not
  encrypted. Anyone with the database file has them.
- Until the first account exists, the setup pages are open to anyone who can reach the server, so
  a new install should be set up right after it's started.
