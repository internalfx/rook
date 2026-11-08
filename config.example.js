// ROOK's server-wide settings. Copy this file to config.js and fill it in; config.js is yours
// alone and is never committed. Changing anything here needs a restart.

export default {
  // `development` or `production`. In production the login cookie is only sent over HTTPS, so
  // put a TLS proxy (Caddy, nginx) in front and set koa.proxy to true.
  env: `development`,
  port: 8005,
  host: `0.0.0.0`,
  // What the assistant calls itself
  appName: `ROOK`,
  koa: {
    // true when a reverse proxy sits in front, so the client's address comes from X-Forwarded-For
    proxy: false,
    cors: {},
  },
  session: {
    sessionCookieName: `ROOK.token`,
    // How long a login lasts: a year
    sessionCookieMaxAge: 1000 * 60 * 60 * 24 * 365,
  },
  // The Lemonade server that runs the models: https://lemonade-server.ai
  lemonade: {
    host: `http://localhost:8000`,
    // Leave empty when the server doesn't ask for one
    apikey: ``,
  },
  // Models by their names on the Lemonade server. `bun scripts/models.js` lists them by kind.
  models: {
    // Required: the model that chats, runs tools and writes briefings
    chat: null,
    // Image generation, or null to leave it out
    image: null,
    // 256x256, 512x512 or 768x768
    imageSize: `512x512`,
    // Lets the assistant find memories and tasks by meaning; required when tools.memories is on
    embedding: null,
    // A MinerU-HTML model that picks out a web page's main content; null converts pages directly
    pageReader: null,
  },
  tools: {
    // Whether the assistant may read pages on the sites in webDomains
    webPages: true,
    // The sites it may read, one per entry, like `github.com` (subdomains included)
    webDomains: [],
    // Web searches, through DuckDuckGo in a headless Chrome
    webSearch: false,
    // Long-term memories, searched by meaning; needs models.embedding
    memories: false,
    // Tasks the assistant can add, find, change and complete
    tasks: true,
  },
  briefings: {
    // Scheduled briefings for every user, this many minutes apart (1 to 1440)
    on: false,
    minutes: 360,
  },
}
