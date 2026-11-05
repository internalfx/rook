import chats from '../../../services/chats.js'
import runs from '../../../services/runs.js'

// The Stop button. A reply keeps running when the page is left, so stopping it is a request
// of its own. Only the chat's own user can stop it.
export const POST = async function (ctx) {
  const chat = chats.getChat(ctx.state.user.id, ctx.state.params.id)

  if (chat == null) {
    ctx.throw(404)
  }

  runs.stopRun(chat.id)
  ctx.status = 204
}
