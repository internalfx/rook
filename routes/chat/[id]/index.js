
import { renderChatPage } from '../../../lib/chatPage.js'
import chats from '../../../lib/chats.js'

export const GET = async function (ctx) {
  const chat = chats.getChat(ctx.state.user.id, ctx.state.params.id)

  if (chat == null) {
    ctx.addFlash(`That chat no longer exists.`, `error`)
    return ctx.redirect(`/chat`)
  }

  await renderChatPage(ctx, chat)
}
