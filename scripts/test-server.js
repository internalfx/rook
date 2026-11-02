
// Starts a test copy of rook, for trying changes in a browser without touching the real data
//   bun scripts/test-server.js
//
// It runs on http://localhost:8015 with a fresh copy of data/rook.db, made in data/test/ each time
// it starts. Log in as test@rook.local with the password rook-test. It only listens on this
// machine, scheduled briefings don't run, and pushes to the phone are off.

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
config.port = 8015
config.host = `127.0.0.1`
config.baseURL = `http://localhost:8015`
// Cookies on localhost are shared between ports, so logging in here mustn't replace the dev
// server's
config.session = { ...config.session, sessionCookieName: `ROOK-test.token` }
config.owner = {
  name: `Test User`,
  email: `test@rook.local`,
  passhash: await Bun.password.hash(`rook-test`),
}
config.cronOff = true

// Only now that dataDir points at the copy can anything open the database
const { default: db } = await import(`../services/db.js`)
const { default: settings } = await import(`../services/settings.js`)

// None of the real logins carry over, and notifications are kept without pushing to the phone
db.run(`DELETE FROM sessions`)
settings.unset(`ntfyUrl`)
settings.unset(`ntfyToken`)

await import(`../app.js`)
