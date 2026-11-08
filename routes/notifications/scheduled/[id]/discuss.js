import dayjs from 'dayjs'
import utc from 'dayjs/plugin/utc'
import timezone from 'dayjs/plugin/timezone'
import chats from '../../../../lib/chats.js'
import notifications from '../../../../lib/notifications.js'
import { quoteMarkdown } from '../../../../lib/format.js'

dayjs.extend(utc)
dayjs.extend(timezone)

// The model's first message in a chat about a scheduled notification: its title, when it's due
// (in `zone`, the user's time zone), its message, what's checked before it goes out, where it was
// scheduled, and a question for the user. The model can move or cancel it with its notification
// tools, which list the scheduled ones.
const describeScheduledStart = function (scheduled, zone) {
  const when = dayjs(scheduled.sendAt).tz(zone).format(`ddd D MMM, h:mm A`)
  const parts = [`Let's talk about the notification **${scheduled.title}**, scheduled for ${when}:`, quoteMarkdown(scheduled.message)]

  if (scheduled.checkNote !== ``) {
    parts.push(`Before it goes out, I check: ${scheduled.checkNote}`)
  }

  if (scheduled.source === `briefing`) {
    parts.push(`It was scheduled by a briefing.`)
  } else {
    parts.push(`It was scheduled in a chat.`)
  }

  parts.push(`What would you like to discuss?`)

  return parts.join(`\n\n`)
}

// Form POST from a scheduled notification's Discuss button on the Notifications page: opens a new
// chat where the model speaks first, with the notification
export const POST = async function (ctx) {
  const userId = ctx.state.user.id
  const scheduled = notifications.getScheduled(userId, ctx.state.params.id)

  if (scheduled == null || scheduled.status !== `waiting`) {
    ctx.addFlash(`That notification is no longer waiting to be sent.`, `error`)
    return ctx.redirect(`/notifications`)
  }

  const chat = chats.createChat(userId)

  chats.addMessage({ chatId: chat.id, role: `assistant`, content: describeScheduledStart(scheduled, ctx.state.user.timeZone) })

  return ctx.redirect(`/chat/${chat.id}`)
}
