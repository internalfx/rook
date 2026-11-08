
// Starts a test copy of rook, for trying changes in a browser without touching the real data
//   bun scripts/test-server.js
//
// It runs on http://localhost:8015 (or the port in ROOK_TEST_PORT) with a fresh copy of
// data/rook.db, made in data/test/ each time it starts. Log in as test@rook.local with the
// password rook-test to see a copy of user 1's data, or as test2@rook.local, also with rook-test,
// as a second user who has nothing yet. It only listens on this machine, scheduled briefings
// don't run, and pushes to the phone are off.

import fs from 'node:fs'
import path from 'node:path'
import Bun from 'bun'
import { Database } from 'bun:sqlite'
import config from '../configure.js'

const testDataDir = path.join(config.dataDir, `test`)

fs.rmSync(testDataDir, { recursive: true, force: true })
fs.mkdirSync(testDataDir, { recursive: true })

// Safe while the dev server has the real database open
const realDb = new Database(path.join(config.dataDir, `rook.db`), { readonly: true })
realDb.run(`VACUUM INTO '${path.join(testDataDir, `rook.db`)}'`)
realDb.close()

config.dataDir = testDataDir
config.port = Number(process.env.ROOK_TEST_PORT ?? 8015)
config.host = `127.0.0.1`
config.baseURL = `http://localhost:${config.port}`
// Cookies on localhost are shared between ports, so logging in here mustn't replace the dev
// server's
config.session = { ...config.session, sessionCookieName: `ROOK-test.token` }
config.cronOff = true
// Plain HTTP on this machine, whatever config.js says: a production copy would refuse to set its
// secure cookie here, and would hide errors and stop reloading templates
config.env = `development`
config.isDevelopment = true
config.isProduction = false

// Before anything reads it, as app.js does. Imported only now: loading lib/checkConfig.js loads
// lib/images.js, which fixes its folder under dataDir, so it has to come after the change above
const { checkConfig } = await import(`../lib/checkConfig.js`)
checkConfig()

// Only now that dataDir points at the copy can anything open the database
const { default: db } = await import(`../lib/db.js`)
const { default: users } = await import(`../lib/users.js`)

// The test logins: user 1 (the owner, with a copy of their data) becomes
// test@rook.local, and test2@rook.local is added with nothing. None of the real logins carry
// over, and notifications are kept without pushing to anyone's phone.
const passhash = await Bun.password.hash(`rook-test`)
const now = new Date().toISOString()

db.run(`UPDATE users SET email = 'test@rook.local', name = 'Test User', passhash = $passhash, updatedAt = $now WHERE id = 1`, { passhash, now })
db.run(`DELETE FROM users WHERE email = 'test2@rook.local'`)
await users.createUser({ name: `Second User`, email: `test2@rook.local`, password: `rook-test` })

db.run(`DELETE FROM sessions`)
db.run(`DELETE FROM userSettings WHERE key IN ('ntfyUrl', 'ntfyToken')`)

await import(`../app.js`)
