#!/bin/sh
set -e

sudo systemctl stop rook.service

sqlite3 -readonly data/rook.db "VACUUM INTO 'data/rook-backup-$(date +%Y%m%d-%H%M%S).db'"

git reset --hard HEAD
git pull
bun install --frozen-lockfile
bun run css

sudo systemctl start rook.service
