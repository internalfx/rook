
import { renderChatPage } from '../../../lib/chatPage.js'
import chats from '../../../services/chats.js'

export const GET = async function (ctx) {
  const chat = chats.getChat(ctx.state.params.id)

  if (chat == null) {
    ctx.addFlash(`That chat no longer exists.`, `error`)
    return ctx.redirect(`/chat`)
  }

  await renderChatPage(ctx, chat)
}
