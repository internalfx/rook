import dayjs from 'dayjs'
import utc from 'dayjs/plugin/utc'
import timezone from 'dayjs/plugin/timezone'
import chats from '../../../lib/chats.js'
import notifications from '../../../lib/notifications.js'
import { quoteMarkdown } from '../../../lib/format.js'

dayjs.extend(utc)
dayjs.extend(timezone)

// The model's first message in a chat about a sent notification: its title, when it was sent (in
// `zone`, the user's time zone), its message, where it came from, and a question for the user
const describeNotificationStart = function (notification, zone) {
  const when = dayjs(notification.createdAt).tz(zone).format(`ddd D MMM, h:mm A`)
  const parts = [`Let's talk about the notification **${notification.title}**, sent ${when}:`, quoteMarkdown(notification.message)]

  if (notification.briefingStartedAt != null) {
    const briefingWhen = dayjs(notification.briefingStartedAt).tz(zone).format(`ddd D MMM, h:mm A`)
    parts.push(`It came from the briefing of ${briefingWhen}.`)
  } else {
    parts.push(`It was sent from a chat.`)
  }

  parts.push(`What would you like to discuss?`)

  return parts.join(`\n\n`)
}

// Form POST from a notification's Discuss button: opens a new chat where the model speaks first,
// with the notification, as Discuss on a task does
export const POST = async function (ctx) {
  const userId = ctx.state.user.id
  const notification = notifications.getNotification(userId, ctx.state.params.id)

  if (notification == null) {
    ctx.addFlash(`That notification no longer exists.`, `error`)
    return ctx.redirect(`/notifications`)
  }

  const chat = chats.createChat(userId)

  chats.addMessage({ chatId: chat.id, role: `assistant`, content: describeNotificationStart(notification, ctx.state.user.timeZone) })

  return ctx.redirect(`/chat/${chat.id}`)
}
