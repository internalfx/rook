# <img src="static/readme.png" alt="" height="38" align="center"> ROOK

*The rook defends the king.*

[![CI](https://github.com/internalfx/rook/actions/workflows/ci.yml/badge.svg)](https://github.com/internalfx/rook/actions/workflows/ci.yml)

**A personal assistant that lives on your hardware, runs on your models, and keeps your life in a file you own.**

ROOK remembers what you tell it, keeps your task list, reads your Slack, and checks in on you. Every few hours it looks over everything and writes you a briefing. It tidies up stale memories, marks off tasks your chats show are done, and adds the ones you mentioned in passing. When something matters later, like a deadline or a meeting, it schedules a push to your phone. Right before sending, it checks the reminder is still true.

All of it runs on a machine you control. The models run on your own [Lemonade](https://lemonade-server.ai) server, and each user's data sits in one SQLite file. **Nothing leaves your network** unless you've told ROOK it may search the web or read a site you've allowed.

- **Memories** it saves and finds by meaning, with the important ones pinned to every chat
- **Tasks** it adds, finds, updates and completes as you talk
- **Briefings** on a schedule, written from your memories, tasks, recent chats and Slack
- **Phone notifications** through [ntfy](https://ntfy.sh), checked by the model before they go out
- **Slack, read-only**, through each user's own token, so it only sees what they can
- **Web pages and search** on the sites you allow, plus arithmetic, dates and image generation
- **Multiple users**, each with their own data, on one install

No subscription, no cloud account, no one else's servers. Clone it, point it at your models, and it's yours.

| A chat, with the tools it used | A scheduled briefing |
|---|---|
| ![A chat where the model searched the tasks and added one](assets/screenshots/chat.png) | ![The Briefing page with the morning's overview](assets/screenshots/briefing.png) |
| **Tasks** | **Memories** |
| ![The Tasks page with overdue and due-today tasks](assets/screenshots/tasks.png) | ![The Memories page with pinned and searchable memories](assets/screenshots/memories.png) |

## Requirements

- [Bun](https://bun.sh) 1.2 or newer. ROOK uses Bun's SQLite and password hashing, so Node won't run it.
- A Lemonade server with a chat model loaded. Models that understand tool calls work best (Qwen 3 and the like). Optional models: an embedding model for memories and finding tasks by meaning, an image model for generating pictures, and a MinerU-HTML model for picking the main content out of web pages.
- For the web tools (reading pages, searching): a headless Chrome, installed once with

  ```sh
  bunx puppeteer browsers install chrome-headless-shell
  ```

## Install

```sh
git clone https://github.com/internalfx/rook.git
cd rook
bun install
cp config.example.js config.js
```

Open `config.js` and set `lemonade.host` to your Lemonade server. Then pick the models:

```sh
bun scripts/models.js
```

lists what the server has, by kind, with the names to paste into `models.chat` and the optional `models.embedding`, `models.image` and `models.pageReader`.

Make the first account and start:

```sh
bun scripts/users.js     # Add a user; the first one is the admin
bun run app
```

ROOK is now at http://localhost:8005. The first start makes `data/rook.db` and applies the migrations. Every start builds the stylesheet into `dist/`, so there is nothing to rebuild after an update.

## Configuration

Everything server-wide is in `config.js`, which is never committed. Changing it needs a restart.

| Key | What it is | Default |
|---|---|---|
| `env` | `development` or `production`. Production sends the login cookie over HTTPS only, so it needs a TLS proxy in front. | `development` |
| `port`, `host` | Where to listen | `8005`, `0.0.0.0` |
| `appName` | What the assistant calls itself | `ROOK` |
| `koa.proxy` | `true` behind a reverse proxy, so the client address comes from `X-Forwarded-For` | `false` |
| `koa.cors` | Options for `@koa/cors` | `{}` |
| `session.sessionCookieName` | The login cookie's name | `ROOK.token` |
| `session.sessionCookieMaxAge` | How long a login lasts, in milliseconds | one year |
| `lemonade.host` | The Lemonade server, like `http://localhost:8000` | required |
| `lemonade.apikey` | Its API key, if it wants one | empty |
| `models.chat` | The chat model's name on the server | required |
| `models.image` | An image model, or `null` for no image generation | `null` |
| `models.imageSize` | `256x256`, `512x512` or `768x768` | `512x512` |
| `models.embedding` | An embedding model; needed for memories | `null` |
| `models.pageReader` | A MinerU-HTML model that extracts a page's main content, or `null` to convert pages directly | `null` |
| `tools.webPages` | Whether the model may read web pages | `true` |
| `tools.webDomains` | The sites it may read, like `github.com` (subdomains included). Empty means none. | `[]` |
| `tools.webSearch` | Web searches through DuckDuckGo | `false` |
| `tools.memories` | Long-term memories; needs `models.embedding` | `false` |
| `tools.tasks` | The task list | `true` |
| `briefings.on` | Scheduled briefings for every user | `false` |
| `briefings.minutes` | How far apart, 1 to 1440 | `360` |

A mistake in `config.js` stops the server at startup with a message saying what's wrong. A model the Lemonade server doesn't have is only warned about, since the server may be down.

## Users

There's no sign-up page. Accounts are made on the server:

```sh
bun scripts/users.js
```

adds a user, resets a password, makes or unmakes an admin, removes a user with everything that's theirs, or lists them. The first user added is an admin. Admins see the Admin page, which shows the Lemonade server and what ROOK holds.

Each user sets their own things in Settings: time zone, an ntfy topic for phone notifications, a Slack token and which conversations briefings should read.

To see ROOK with something in it before you've used it, add the demo user:

```sh
bun scripts/demo.js
```

That adds an account (demo@rook.local, with a password it prints) belonging to Bill, who runs a small print shop: chats, memories, tasks, a briefing and notifications, all made up and dated around today. Run it again for a fresh set, or with `--remove` to take the account away along with everything in it.

### ntfy

Install the [ntfy](https://ntfy.sh) app, subscribe to a topic of your own (a hard-to-guess name), and paste the topic URL into Settings, with an access token if your ntfy server needs one. The Notifications page has a test button.

### Slack

ROOK reads Slack with each user's own user token, so it only sees what that user can. Make a Slack app for your workspace, add these user token scopes, install it, and paste the `xoxp-` token into Settings:

`channels:history`, `channels:read`, `groups:history`, `groups:read`, `im:history`, `im:read`, `mpim:history`, `mpim:read`, `search:read`, `users:read`

The model then has `read_slack` and `search_slack`, which only read; it never posts. Briefings read the conversations picked in Settings.

## Running as a service

`deploy/rook.service` is a systemd unit to copy to `/etc/systemd/system/rook.service`; change its user and paths, then `systemctl enable --now rook`. `deploy.sh` updates such an install to the latest commit, backing up the database first.

For `env: production`, put a TLS proxy such as Caddy or nginx in front, forward to the port in `config.js`, and set `koa.proxy: true`. The login cookie is marked secure, so plain HTTP won't log anyone in.

Back up by copying `data/`: it holds the database (`rook.db`, in WAL mode, so copy it with `sqlite3 data/rook.db "VACUUM INTO 'backup.db'"` while running) and the images.

## Development

```sh
bun run dev        # the server, restarting when a file changes
bun run devcss     # Tailwind, rebuilding when a template changes
bun run lint
bun scripts/test-server.js   # a copy on :8015 with a copy of the database, for trying things
bun scripts/demo.js          # add or replace the demo user, for screenshots and a look around
```

STYLEGUIDE.md has the code conventions.

## Layout

- `services/` — code that runs on its own: the cron jobs in `cron.js` and what they start
- `lib/` — code shared across the app: the database and models, the Lemonade client, page helpers, prompts
- `routes/` — one file per URL; every `.js` here is a public route
- `middleware/` — the Koa middleware `substruct.js` loads
- `ai-tools/` — the tools the chat model can call
- `scripts/` — run by hand, e.g. `bun scripts/models.js`
- `migrations/` — numbered SQL files, applied in order on startup
- `templates/`, `static/`, `assets/` — Nunjucks pages, served files, Tailwind input

## Contributing

Issues and pull requests are welcome. For anything bigger than a fix, open an issue first so we
can talk it over. Before sending a pull request, run `bun run lint` and read STYLEGUIDE.md; CI
checks the lint and that a fresh clone still starts.

Security problems go through the Security tab, not the issue tracker: see SECURITY.md.

## License

MIT. See LICENSE. Code and assets from other projects are credited in THIRD_PARTY_NOTICES.md.
