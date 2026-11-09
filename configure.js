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

const trustProxy = [`true`, `1`].includes((process.env.ROOK_TRUST_PROXY ?? `false`).toLowerCase())

const config = {
  env,
  isProduction: env === `production`,
  isDevelopment: env !== `production`,
  port,
  host,
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
