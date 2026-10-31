
import { renderChatPage } from '../../lib/chatPage.js'

// A new conversation; it's saved when the first message is sent
export const GET = async function (ctx) {
  await renderChatPage(ctx, null)
}
