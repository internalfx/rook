
import images from '../../services/images.js'
import { serveFile } from '../../lib/serveFile.js'

// Images generated in chats
export const GET = async function (ctx) {
  const id = ctx.state.params.id

  if (images.isImageId(id) === false) {
    ctx.throw(404)
  }

  await serveFile(ctx, images.imagesDir, images.imageFileName(id))
}
