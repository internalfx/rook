import fs from 'node:fs'
import path from 'node:path'

// Loads config.js and adds what's worked out from it: the environment flags and the directories.
// The values themselves are checked when the server starts (lib/checkConfig.js).

const isBun = !!process.versions.bun

if (isBun !== true) {
  console.error(`ROOK runs on Bun (https://bun.sh); start it with bun, not node.`)
  process.exit(1)
}

const configPath = path.join(__dirname, `config.js`)

if (fs.existsSync(configPath) === false) {
  console.error(`No config.js: copy config.example.js to config.js and fill it in (see README.md).`)
  process.exit(1)
}

const { default: config } = await import(configPath)

if (config.env === `production`) {
  config.isDevelopment = false
  config.isProduction = true
} else {
  config.isDevelopment = true
  config.isProduction = false
}

config.appDir = __dirname
config.routesDir = path.join(__dirname, `routes`)
config.templateDir = path.join(__dirname, `templates`)
config.dataDir = path.join(__dirname, `data`)
config.migrationsDir = path.join(__dirname, `migrations`)

export default config
