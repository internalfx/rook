import fs from 'node:fs'
import path from 'node:path'
import Bun from 'bun'
import config from '../configure.js'

// Builds dist/application.css with Tailwind each time the server starts. The build takes about
// 150 ms, so it's cheaper to always run than to work out whether the sheet is missing or older
// than the templates, and an update pulled onto a server can't leave a stale one behind. In
// development the `devcss` watcher writes the same file; both produce the same bytes.
//
// The command itself is the `css` script in package.json, so there's one place it's written.
export const buildStylesheet = function () {
  const outputPath = path.join(config.appDir, `dist`, `application.css`)

  console.log(`Building the stylesheet...`)

  const build = Bun.spawnSync([process.execPath, `run`, `css`], {
    cwd: config.appDir,
    stdout: `inherit`,
    stderr: `inherit`,
  })

  const built = build.exitCode === 0 && fs.existsSync(outputPath)

  if (built === false) {
    console.error(`Couldn't build dist/application.css. Run \`bun install\`, then \`bun run css\` to see the error.`)
    process.exit(1)
  }
}

export default {
  buildStylesheet,
}
