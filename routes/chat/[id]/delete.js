
import chats from '../../../services/chats.js'

// Form POST from the chat list. `returnTo` is the page to go back to, unless that page
// is the chat being deleted, in which case the browser lands on a new chat.
export const POST = async function (ctx) {
  const chatId = ctx.state.params.id
  const chat = chats.getChat(chatId)

  if (chat != null) {
    chats.deleteChat(chatId)
  }

  const deletedPath = `/chat/${chatId}`
  const returnTo = ctx.request.body?.returnTo

  let destination = `/chat`

  const isChatPath = typeof returnTo === `string` && returnTo.startsWith(`/chat/`)

  if (isChatPath && returnTo !== deletedPath) {
    destination = returnTo
  }

  ctx.redirect(destination)
}
