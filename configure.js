import config from "./config.js"
import path from "node:path"

const isBun = !!process.versions.bun

if (isBun !== true) {
  process.exit()
}

if (config.env === `production`) {
  config.isDevelopment = false
  config.isProduction = true
} else {
  config.isDevelopment = true
  config.isProduction = false
}

config.appDir = __dirname
config.apiDir = path.join(__dirname, `api`)
config.routesDir = path.join(__dirname, `routes`)
config.controllerDir = path.join(__dirname, `api`, `controllers`)
config.templateDir = path.join(__dirname, `templates`)
config.emailDir = path.join(__dirname, `emails`)
config.sysDir = path.join(__dirname, `system`)
config.dataDir = path.join(__dirname, `data`)
config.migrationsDir = path.join(__dirname, `migrations`)

export default config
