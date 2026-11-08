
import chats from '../../lib/chats.js'
import images from '../../lib/images.js'
import { serveFile } from '../../lib/serveFile.js'

// Images generated in the user's chats, and those they attached. Another user's reads as none.
export const GET = async function (ctx) {
  const imageId = ctx.state.params.id

  if (chats.ownsImage(ctx.state.user.id, imageId) === false) {
    ctx.throw(404)
  }

  const fileName = images.findImageFile(imageId)

  if (fileName == null) {
    ctx.throw(404)
  }

  await serveFile(ctx, images.imagesDir, fileName)
}
