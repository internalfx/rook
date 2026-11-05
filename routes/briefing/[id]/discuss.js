import chats from '../../../services/chats.js'
import briefings from '../../../services/briefings.js'

// Form POST from a briefing's Discuss button: opens a new chat where the briefing's overview is
// the model's first message. The chat is titled after the user's first message, like any other.
export const POST = async function (ctx) {
  const userId = ctx.state.user.id
  const briefing = briefings.getBriefing(userId, ctx.state.params.id)

  if (briefing == null || briefing.overview == null) {
    ctx.addFlash(`That briefing has nothing to discuss.`, `error`)
    return ctx.redirect(`/briefing`)
  }

  const chat = chats.createChat(userId)

  chats.addMessage({ chatId: chat.id, role: `assistant`, content: briefing.overview })

  return ctx.redirect(`/chat/${chat.id}`)
}
