# ROOK

An internal planner and personal assistant

## Layout

- `services/` — code that runs on its own: the cron jobs in `cron.js` and what they start
- `lib/` — code shared across the app: the database and models, the Lemonade client, page helpers, prompts
- `routes/` — one file per URL; every `.js` here is a public route
- `middleware/` — the Koa middleware `substruct.js` loads
- `ai-tools/` — the tools the chat model can call
- `scripts/` — run by hand, e.g. `bun scripts/models.js`
- `templates/`, `static/`, `assets/` — Nunjucks pages, served files, Tailwind input
