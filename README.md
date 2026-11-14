<img src="static/rook-banner-dark.svg" alt="" align="center">

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
- **Discuss** any task, memory or notification in a chat that starts with it
- **Multiple users**, each with their own data, on one install, managed from the browser
- **Task requests** between those users: ask someone to do something, and their ROOK decides what to do with it, going by what they've told it about you

No subscription, no cloud account, no one else's servers. Clone it, point it at your models, and it's yours.

| A chat, with the tools it used | A scheduled briefing |
|---|---|
| ![A chat where the model searched the tasks and added one](assets/screenshots/chat.png) | ![The Briefing page with the morning's overview](assets/screenshots/briefing.png) |
| **Tasks** | **Memories** |
| ![The Tasks page with overdue and due-today tasks](assets/screenshots/tasks.png) | ![The Memories page with pinned and searchable memories](assets/screenshots/memories.png) |

## Requirements

- [Bun](https://bun.sh) 1.2 or newer. ROOK uses Bun's SQLite and password hashing, so Node won't run it.
- A Lemonade server with a chat model loaded; see [Models](#models) for which.
- For the web tools (reading pages, searching): a headless Chrome, installed once with

  ```sh
  bunx puppeteer browsers install chrome-headless-shell
  ```

## Install

```sh
git clone https://github.com/internalfx/rook.git
cd rook
bun install
bun run app
```

Open http://localhost:8005. The first visit is a four-step setup: it asks where your Lemonade server is (with a button to check it answers), lets you choose models from what that server has (see [Models](#models)), and makes your account, which is the admin's. Do it right away: until an account exists, anyone who can reach the server can make it. Everything chosen there can be changed later on the Admin pages.

The first start makes `data/rook.db` and builds the stylesheet. Nothing needs editing.

## Models

ROOK gives each job to a model of its own, all served by Lemonade: a chat model, and optionally an embedding model, an image model and a page reader. Only the chat model is required. The size given for each model is how much it downloads, and roughly how much memory it takes to run.

Each model below comes with the `lemonade pull` command that downloads it and registers it with the server; Lemonade's Model Manager does the same with a click. Once pulled, they appear in the lists on the setup wizard and Admin → Models. A set to start with, which all comes to about 31 GB when every model is loaded:

```sh
lemonade pull Qwen3.8-27B-GGUF                                    # chat, required
lemonade pull Qwen3-Embedding-4B-GGUF                             # memories and tasks by meaning
lemonade pull SDXL-Turbo                                          # pictures
lemonade pull jinzhenj/MinerU-HTML-v1.1-Hunyuan-0.5B-GGUF:Q8_0    # reading web pages
```

The set ROOK is developed against, on an AMD Ryzen AI Max+ machine with 188 GB of memory:

```sh
lemonade pull unsloth/Qwen3.8-Flash-Next-GGUF:UD-Q4_K_XL
lemonade pull Qwen3-Embedding-8B-GGUF
lemonade pull SDXL-Base-1.0
lemonade pull jinzhenj/MinerU-HTML-v1.1-Hunyuan-0.5B-GGUF:Q8_0
```

Names on their own, like `SDXL-Turbo`, are models in Lemonade's own list. The two given as `owner/repository:file` aren't in that list and are pulled straight from Hugging Face, which registers them under the repository's name.

### Chat

Chats, briefings and the checks on scheduled notifications all use it. It has to understand tool calls, since tasks, memories and the web tools are all tool calls (Lemonade labels these models `tool-calling`). One labelled `vision` lets people attach images in chats. Reasoning models think before they answer, which is slower but better for briefings.

| Model | Size | Pull | Notes |
|---|---|---|---|
| [Qwen3.8-27B](https://huggingface.co/unsloth/Qwen3.8-27B-GGUF) | 19 GB | `lemonade pull Qwen3.8-27B-GGUF` | Tool calling, vision, reasoning. Tried with ROOK; the pick for a card with 24 to 32 GB. |
| [Qwen3.8-Flash-Next](https://huggingface.co/unsloth/Qwen3.8-Flash-Next-GGUF) | 111 GB | `lemonade pull unsloth/Qwen3.8-Flash-Next-GGUF:UD-Q4_K_XL` | What ROOK is developed on. 125B parameters with 6B active, so it answers fast for its size; tool calling, vision, a 256K context. Needs 128 GB or more of unified memory. |
| [Qwen3.6-35B-A3B](https://huggingface.co/unsloth/Qwen3.6-35B-A3B-GGUF) | 23 GB | `lemonade pull Qwen3.6-35B-A3B-GGUF` | Mixture of experts, so fast for its size; tool calling and vision. Not tried with ROOK yet. |
| [gpt-oss-20b](https://huggingface.co/unsloth/gpt-oss-20b-GGUF) | 12 GB | `lemonade pull gpt-oss-20b-GGUF` | Reasoning and tool calling, for a 16 GB card. Not tried with ROOK yet. |
| [Qwen3.5-9B](https://huggingface.co/unsloth/Qwen3.5-9B-GGUF) | 7 GB | `lemonade pull Qwen3.5-9B-GGUF` | The small end: tool calling and vision in 8 GB. Not tried with ROOK yet. |

### Embedding

Finds memories and tasks by meaning; memories need one. Use a Qwen3-Embedding model: ROOK tells these what each search is for, which sharpens the results, and other embedding models don't take that. Changing the embedding model later is fine: memories and tasks are re-embedded at the next search.

| Model | Size | Pull | Notes |
|---|---|---|---|
| [Qwen3-Embedding-4B](https://huggingface.co/Qwen/Qwen3-Embedding-4B-GGUF) | 4 GB | `lemonade pull Qwen3-Embedding-4B-GGUF` | The middle pick. |
| [Qwen3-Embedding-8B](https://huggingface.co/Qwen/Qwen3-Embedding-8B-GGUF) | 8 GB | `lemonade pull Qwen3-Embedding-8B-GGUF` | What ROOK is developed on. |
| [Qwen3-Embedding-0.6B](https://huggingface.co/Qwen/Qwen3-Embedding-0.6B-GGUF) | 0.6 GB | `lemonade pull Qwen3-Embedding-0.6B-GGUF` | When memory is tight. |

### Image

Optional, for making pictures in chats. The picture size, 256 to 768 pixels, is set on Admin → Models.

| Model | Size | Pull | Notes |
|---|---|---|---|
| [SDXL-Turbo](https://huggingface.co/stabilityai/sdxl-turbo) | 7 GB | `lemonade pull SDXL-Turbo` | A picture in a few steps. Tried with ROOK. |
| [SDXL-Base-1.0](https://huggingface.co/stabilityai/stable-diffusion-xl-base-1.0) | 7 GB | `lemonade pull SDXL-Base-1.0` | Slower and better. What ROOK is developed on. |
| [SD-Turbo-GGUF](https://huggingface.co/Green-Sky/SD-Turbo-GGUF) | 2 GB | `lemonade pull SD-Turbo-GGUF` | For small cards. Not tried with ROOK yet. |

### Page reader

Optional. A MinerU-HTML model picks the main content out of web pages before the chat model reads them, so a long article costs a fraction of the tokens. It has to be MinerU-HTML v1.1: ROOK's page-reading code is a port of that version's method and uses its prompt word for word. Lemonade's list has none, so this one comes from Hugging Face; ROOK knows page readers by "MinerU-HTML" in their name, which a repository pull keeps.

| Model | Size | Pull | Notes |
|---|---|---|---|
| [MinerU-HTML-v1.1-Hunyuan-0.5B-GGUF](https://huggingface.co/jinzhenj/MinerU-HTML-v1.1-Hunyuan-0.5B-GGUF) | 0.5 GB | `lemonade pull jinzhenj/MinerU-HTML-v1.1-Hunyuan-0.5B-GGUF:Q8_0` | A GGUF of OpenDataLab's [MinerU-HTML-v1.1-hunyuan0.5B-compact](https://huggingface.co/opendatalab/MinerU-HTML-v1.1-hunyuan0.5B-compact). What ROOK is developed on. |

## Configuration

Two kinds of settings, in two places: the Admin pages for what may change while ROOK runs, and environment variables for what's decided when it's deployed. There's no config file.

### Admin

Admins have an **Admin** group in the sidebar. Changes made there take effect at once, without a restart; a reply already under way finishes as it started.

| Page | What's on it |
|---|---|
| Overview | How the Lemonade server is doing (loaded models, throughput, the machine) and ROOK itself (uptime, what's running, the database), refreshing every few seconds |
| Users | Everyone with an account and what ROOK holds for each; see [Users](#users) |
| Lemonade | The server's address, like `http://localhost:8000`, and an API key if it wants one. Check connection tries it before saving. |
| Models | Chat model (required; chats, briefings and the checks on scheduled notifications use it, and one that understands tool calls works best), embedding model (finds memories and tasks by meaning; memories need one), image model and size (or none), and a MinerU-HTML page reader that picks the main content out of web pages (or none). Everything the server has is listed underneath. Recommendations are under [Models](#models). |
| Tools | Tasks, task requests between users, memories, web search (through DuckDuckGo in a headless Chrome), and web pages on the sites you list |
| Briefings | Scheduled briefings for every user, and how many minutes apart |

These live in the database (`lib/serverSettings.js`), so they travel with a backup of `data/`.

### Environment variables

What's decided when ROOK is deployed. All are optional.

| Variable | Default | What it is |
|---|---|---|
| `ROOK_PORT` | `8005` | Where to listen |
| `ROOK_HOST` | `0.0.0.0` | The address to listen on; `127.0.0.1` for this machine only |
| `ROOK_ENV` | `development` | `production` sends the login cookie over HTTPS only, so it needs a TLS proxy in front |
| `ROOK_TRUST_PROXY` | `false` | `true` behind a reverse proxy, so the client address comes from `X-Forwarded-For` |
| `ROOK_DATA_DIR` | `data/` in the checkout | Where the database and images live |

A bad value stops the server at startup with a message saying what's wrong. A model that the Lemonade server doesn't have is only warned about, since the server may be down.

## Users

The setup wizard makes the first account, the admin's. There's no sign-up page: an admin adds the rest from Admin → Users, where each user has a page of their own. **Add user** asks for a name, email, password and whether they're an admin. A user's **Edit** page changes their name, email and admin status, and removes them along with everything that's theirs, after their email is typed in to confirm. **Password** sets a new one and logs them out everywhere. A password an admin picks for someone else, on either page, is only for getting in: after logging in with it they're asked to choose their own. Passwords need at least 10 characters, and an admin's own admin status and account are another admin's to change, so no one can lock themselves out.

When no admin can log in, such as after a lost admin password, the same things can be done on the server:

```sh
bun scripts/users.js
```

Each user sets their own things under Settings in the sidebar, a page for each: Time zone, Slack (a token and which conversations briefings should read), Notifications (an ntfy topic for the phone), People (who may send them task requests) and Password.

To see ROOK with something in it before you've used it, add the demo user:

```sh
bun scripts/demo.js
```

That adds an account (demo@rook.local, with a password it prints) belonging to Bill, who runs a small print shop: chats, memories, tasks, a briefing and notifications, all made up and dated around today. Run it again for a fresh set, or with `--remove` to take the account away along with everything in it.

### Task requests

Users on the same install can ask each other to do things, by telling ROOK in a chat: "ask Dana to order paper by Friday". The request goes to Dana's ROOK, not to Dana. Her chat model looks at it with her context (her note about the sender, her memories, her task list) and does one of three things:

- **accepts** it, which adds a task to her list, marked with who asked and why it was taken
- **declines** it, which she can see and overrule for a week
- **leaves** it for her to answer on the Tasks page, when her note and what it knows don't settle it

Nobody can send you anything until you allow them. Settings → People lists the other users, each blocked to start with, and a note for ROOK about each: who they are to you and how to treat what they ask, like "My business partner. Accept anything about the shop; leave personal favours for me." That note is the model's main instruction, and ROOK also uses it when you send that person something. Only you see it.

The sender's Tasks page and briefings show where each request stands: being looked at, waiting for an answer, on the other person's list, declined, or done, with the completion note. They never see the reasons the other person's ROOK gave, which are written with that person's memories to hand. A reason only travels when someone declines by hand and types one.

A few limits keep it civil: ten requests a day from one person to another, at most one phone push an hour from one sender, and only when the model judges it can't wait for the next briefing. An admin can turn the whole thing off in Admin → Tools.

### ntfy

Install the [ntfy](https://ntfy.sh) app, subscribe to a topic of your own (a hard-to-guess name), and paste the topic URL into Settings → Notifications, with an access token if your ntfy server needs one. The page has a test button.

### Slack

ROOK reads Slack with each user's own user token, so it only sees what that user can. Make a Slack app for your workspace, add these user token scopes, install it, and paste the `xoxp-` token into Settings → Slack:

`channels:history`, `channels:read`, `groups:history`, `groups:read`, `im:history`, `im:read`, `mpim:history`, `mpim:read`, `search:read`, `users:read`

The model then has `read_slack` and `search_slack`, which only read; it never posts. Briefings read the conversations picked there.

## Running as a service

`deploy/rook.service` is a systemd unit to copy to `/etc/systemd/system/rook.service`; change its user and paths, then `systemctl enable --now rook`. `deploy.sh` updates such an install to the latest commit, backing up the database first.

For production, set `ROOK_ENV=production` and `ROOK_TRUST_PROXY=true` (the unit file has them), and put a TLS proxy such as Caddy or nginx in front, forwarding to the port. The login cookie is marked secure, so plain HTTP won't log anyone in.

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

- `services/` — code that runs on its own: the cron jobs in `cron.js` and what they start (briefings, the checks on scheduled notifications, the reviews of task requests)
- `lib/` — code shared across the app: the database and models, the Lemonade client, the server settings, page helpers, prompts
- `routes/` — one file per URL; every `.js` here is a public route
- `middleware/` — the Koa middleware `substruct.js` loads
- `ai-tools/` — the tools the chat model can call
- `scripts/` — run by hand, e.g. `bun scripts/models.js`
- `migrations/` — numbered SQL files, applied in order on startup
- `templates/`, `static/`, `assets/` — Nunjucks pages, served files (including the sidebar's icons), Tailwind input

## Contributing

I am not currently accepting code from others. But please feel free to open an issue for any feature requests.

## Security

Security problems go through the Security tab, not the issue tracker: see SECURITY.md.

## License

MIT. See LICENSE. Code and assets from other projects are credited in THIRD_PARTY_NOTICES.md.
