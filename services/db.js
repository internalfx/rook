import { Database } from 'bun:sqlite'
import config from '../configure.js'
import fs from 'node:fs'
import path from 'node:path'
import { mkdirp } from 'mkdirp'

mkdirp.sync(config.dataDir)

const dbPath = path.join(config.dataDir, `rook.db`)

// strict: named params are written without their prefix in JS, e.g. { token } for $token
const db = new Database(dbPath, { create: true, strict: true })

db.run(`PRAGMA journal_mode = WAL`)
db.run(`PRAGMA foreign_keys = ON`)

// MIGRATIONS
// Each file in migrations/ is named "<number>-<description>.sql". PRAGMA user_version holds
// the number of the last migration applied, and every file numbered above it runs in order.
const runMigrations = function () {
  const versionRow = db.query(`PRAGMA user_version`).get()
  const currentVersion = versionRow.user_version

  const fileNames = fs.readdirSync(config.migrationsDir)

  const migrations = []

  for (const fileName of fileNames) {
    const match = fileName.match(/^(\d+)-.+\.sql$/)

    if (match == null) {
      continue
    }

    const version = parseInt(match[1], 10)

    migrations.push({ version, fileName })
  }

  migrations.sort(function (a, b) {
    return a.version - b.version
  })

  for (const migration of migrations) {
    if (migration.version <= currentVersion) {
      continue
    }

    const filePath = path.join(config.migrationsDir, migration.fileName)
    const sql = fs.readFileSync(filePath, `utf8`)

    const applyMigration = db.transaction(function () {
      db.run(sql)
      db.run(`PRAGMA user_version = ${migration.version}`)
    })

    applyMigration()

    console.log(`MIGRATION APPLIED - ${migration.fileName}`)
  }
}

runMigrations()

export default db
