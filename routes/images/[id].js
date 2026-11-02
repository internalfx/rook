
import images from '../../services/images.js'
import { serveFile } from '../../lib/serveFile.js'

// Images generated in chats, and those the user attached
export const GET = async function (ctx) {
  const fileName = images.findImageFile(ctx.state.params.id)

  if (fileName == null) {
    ctx.throw(404)
  }

  await serveFile(ctx, images.imagesDir, fileName)
}
