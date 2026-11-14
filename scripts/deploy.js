// Deploy to production: bun run deploy
// Coolify builds and runs the `production` branch. This brings it up to `main`, but only from a
// clean `main` that matches origin and passes lint, so a broken build never reaches production.
// Anyone running ROOK elsewhere can ignore it.

import path from 'node:path'
import Bun from 'bun'

const appDir = path.join(import.meta.dir, `..`)

const run = function (command, { quiet = false } = {}) {
  const result = Bun.spawnSync(command, {
    cwd: appDir,
    stdout: quiet ? `pipe` : `inherit`,
    stderr: quiet ? `pipe` : `inherit`,
  })

  return { ok: result.exitCode === 0, out: quiet ? result.stdout.toString().trim() : `` }
}

const stop = function (reason) {
  console.error(`Not deployed: ${reason}`)
  process.exit(1)
}

if (run([`git`, `rev-parse`, `--abbrev-ref`, `HEAD`], { quiet: true }).out !== `main`) {
  stop(`deploy from main`)
}

if (run([`git`, `status`, `--porcelain`], { quiet: true }).out !== ``) {
  stop(`commit or stash your changes first`)
}

if (run([`git`, `fetch`, `origin`]).ok === false) {
  stop(`couldn't reach origin`)
}

const local = run([`git`, `rev-parse`, `main`], { quiet: true }).out
const remote = run([`git`, `rev-parse`, `origin/main`], { quiet: true }).out

if (local !== remote) {
  stop(`main and origin/main differ; push or pull first`)
}

console.log(`Linting...`)

if (run([process.execPath, `run`, `lint`]).ok === false) {
  stop(`lint failed`)
}

// A fast-forward only: production never has commits of its own
if (run([`git`, `push`, `origin`, `main:production`]).ok === false) {
  stop(`the push to production was refused`)
}

console.log(`Deployed ${local.slice(0, 7)}. Coolify builds it now.`)
