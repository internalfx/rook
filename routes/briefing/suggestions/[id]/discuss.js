import chats from '../../../../services/chats.js'
import briefings from '../../../../services/briefings.js'

// Form POST from a suggestion's Discuss button: opens a chat where the model's message comes
// first, titled with the suggestion's title. A suggestion already discussed goes back to its
// chat, while that still exists.
export const POST = async function (ctx) {
  const suggestion = briefings.getSuggestion(ctx.state.params.id)

  if (suggestion == null) {
    ctx.addFlash(`That suggestion no longer exists.`, `error`)
    return ctx.redirect(`/briefing`)
  }

  if (suggestion.chatId != null && chats.getChat(suggestion.chatId) != null) {
    return ctx.redirect(`/chat/${suggestion.chatId}`)
  }

  const chat = chats.createChat()

  chats.setTitle(chat.id, suggestion.title)
  chats.addMessage({ chatId: chat.id, role: `assistant`, content: suggestion.message })
  briefings.markDiscussed(suggestion.id, chat.id)

  return ctx.redirect(`/chat/${chat.id}`)
}
