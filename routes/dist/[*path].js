import config from '../../configure.js'
import { serveFile } from '../../lib/serveFile.js'
import path from 'node:path'

export const GET = async function (ctx) {
  await serveFile(ctx, path.join(config.appDir, `dist`), ctx.state.params.path)
}
