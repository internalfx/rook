# Changelog

Notable changes to ROOK. The format follows [Keep a Changelog](https://keepachangelog.com), and
versions follow [Semantic Versioning](https://semver.org).

## [Unreleased]

### Added

- Continuous integration on GitHub: lint, and a fresh install booted and asked for its login
  page
- Dependabot, grouped and monthly
- A bug report form, SECURITY.md, and THIRD_PARTY_NOTICES.md
- `bun scripts/demo.js`, which adds a demo user with made-up chats, memories, tasks, a briefing
  and notifications, or replaces or removes them
- Discuss buttons on memories and notifications, opening a chat about one as tasks already had
- Screenshots in the README
- The stylesheet is built on every start, so a fresh clone or a pulled update needs no
  `bun run css`

### Changed

- The 19 migrations are collapsed into one schema file; databases made before this stay at
  version 19 and need nothing
- Six Alpine plugin files that nothing loaded are removed from static/

### Fixed

- The test server kept its images in the real `data/images` instead of its own copy

## [0.1.0] - 2026-11-08

The first version that installs from a clone.

### Added

- Chats with a model on a Lemonade server, with tools: memories, tasks, reading web pages on
  allowed sites, web search, arithmetic and dates, image generation, and reading a user's Slack
- Scheduled briefings that look over a user's memories, tasks, recent chats and Slack and write
  an overview
- Notifications, pushed to a phone through ntfy, including ones the model schedules for later and
  checks before sending
- Multiple users, each with their own data and settings; admins see an Admin page
- A config.example.js, startup checks for every setting, scripts for models and users, an
  example systemd unit, and a README

[Unreleased]: https://github.com/internalfx/rook/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/internalfx/rook/releases/tag/v0.1.0
