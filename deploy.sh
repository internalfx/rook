#!/bin/sh
# Updates a systemd install (deploy/rook.service) to the latest commit: stops the service, backs
# up the database into data/, pulls, installs and starts it again. It runs
# `git reset --hard`, so local edits to tracked files are thrown away. Needs sudo and sqlite3.
set -e

sudo systemctl stop rook.service

sqlite3 -readonly data/rook.db "VACUUM INTO 'data/rook-backup-$(date +%Y%m%d-%H%M%S).db'"

git reset --hard HEAD
git pull
bun install --frozen-lockfile

sudo systemctl start rook.service
