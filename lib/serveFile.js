import Bun from 'bun'
import mime from 'mime-types'
import path from 'node:path'

// Serve a file from rootDir, refusing any path that resolves outside of it (e.g. "../package.json")
export const serveFile = async function (ctx, rootDir, filePath) {
  const root = path.resolve(rootDir)
  const fullPath = path.resolve(root, filePath ?? ``)

  if (!fullPath.startsWith(root + path.sep)) {
    ctx.throw(404)
  }

  let fileBuffer
  let err

  try {
    fileBuffer = Buffer.from(await Bun.file(fullPath).arrayBuffer())
  } catch (e) {
    err = e
  }

  if (err?.code === `ENOENT` || err?.code === `EISDIR`) {
    ctx.throw(404)
  } else if (err != null) {
    ctx.throw(500, err)
  }

  ctx.set(`Cache-Control`, `max-age=600`)
  ctx.type = mime.lookup(fullPath) || `application/octet-stream`
  ctx.body = fileBuffer
}

export default serveFile
