import path from 'node:path'

// What's decided when ROOK is deployed, from environment variables with defaults, plus the
// directories. Everything an admin may change while it runs (the Lemonade server, models, tools,
// briefings) lives in the database and is loaded onto this object by lib/serverSettings.js.

const isBun = !!process.versions.bun

if (isBun !== true) {
  console.error(`ROOK runs on Bun (https://bun.sh); start it with bun, not node.`)
  process.exit(1)
}

const fail = function (message) {
  console.error(message)
  process.exit(1)
}

const env = process.env.ROOK_ENV ?? `development`

if ([`development`, `production`].includes(env) === false) {
  fail(`ROOK_ENV should be development or production, not "${env}".`)
}

const port = Number(process.env.ROOK_PORT ?? 8005)

if (Number.isInteger(port) === false || port < 1 || port > 65535) {
  fail(`ROOK_PORT should be a whole number from 1 to 65535, not "${process.env.ROOK_PORT}".`)
}

const host = process.env.ROOK_HOST ?? `0.0.0.0`

if (host.trim() === ``) {
  fail(`ROOK_HOST should be an address to listen on, like 0.0.0.0 or 127.0.0.1.`)
}

// true or false (1 and 0 also do); anything else stops the server
const readFlag = function (name, fallback) {
  const value = (process.env[name] ?? fallback).trim().toLowerCase()

  if ([`true`, `1`].includes(value)) {
    return true
  }

  if ([`false`, `0`].includes(value)) {
    return false
  }

  fail(`${name} should be true or false, not "${process.env[name]}".`)
}

const trustProxy = readFlag(`ROOK_TRUST_PROXY`, `false`)

// Whether a new install's setup pages are open. Until the first account exists, whoever reaches
// them makes it, which on a public address could be anyone. Off, they're closed and the first
// account, the admin's, is made on the server with scripts/users.js. The Docker image turns it off.
const webSetup = readFlag(`ROOK_WEB_SETUP`, `true`)

// Chrome's sandbox for the web tools. It needs user namespaces, which Docker's default seccomp
// profile refuses, so the Docker image turns it off and the container is the boundary instead.
const browserSandbox = readFlag(`ROOK_BROWSER_SANDBOX`, `true`)

const config = {
  env,
  isProduction: env === `production`,
  isDevelopment: env !== `production`,
  port,
  host,
  webSetup,
  browserSandbox,
  appName: `ROOK`,
  koa: {
    // Behind a reverse proxy, the client's address comes from X-Forwarded-For
    proxy: trustProxy,
    cors: {},
  },
  koaBody: {},
  session: {
    sessionCookieName: `ROOK.token`,
    // How long a login lasts: a year
    sessionCookieMaxAge: 1000 * 60 * 60 * 24 * 365,
  },
  // Filled in from the database by lib/serverSettings.js; the objects exist from the start so
  // nothing reads undefined before then
  lemonade: {},
  models: {},
  tools: {},
  briefings: {},
}

config.appDir = __dirname
config.routesDir = path.join(__dirname, `routes`)
config.templateDir = path.join(__dirname, `templates`)
config.dataDir = process.env.ROOK_DATA_DIR ?? path.join(__dirname, `data`)
config.migrationsDir = path.join(__dirname, `migrations`)

export default config
