import dayjs from 'dayjs'
import notifications from '../lib/notifications.js'
import { readTime, checkClockChange } from './time.js'
import { parseArguments } from './arguments.js'
import prompts from '../lib/prompts.js'

// schedule_notification, list_scheduled_notifications and cancel_notification: notifications to
// the user's phone at a later time, from a chat or a briefing (see lib/notifications.js).
// Just before each is due, the model checks it (services/notificationChecks.js).

// The descriptions are in lib/prompts.js
const scheduleNotificationTool = {
  type: `function`,
  function: {
    name: `schedule_notification`,
    description: prompts.tools.schedule_notification.description,
    parameters: {
      type: `object`,
      properties: {
        title: {
          type: `string`,
          description: prompts.tools.schedule_notification.parameters.title,
        },
        message: {
          type: `string`,
          description: prompts.tools.schedule_notification.parameters.message,
        },
        send_at: {
          type: `string`,
          description: prompts.tools.schedule_notification.parameters.send_at,
        },
        priority: {
          type: `string`,
          enum: [`normal`, `high`],
          description: prompts.tools.schedule_notification.parameters.priority,
        },
        check: {
          type: `string`,
          description: prompts.tools.schedule_notification.parameters.check,
        },
      },
      required: [`title`, `message`, `send_at`],
    },
  },
}

const listScheduledNotificationsTool = {
  type: `function`,
  function: {
    name: `list_scheduled_notifications`,
    description: prompts.tools.list_scheduled_notifications.description,
    parameters: {
      type: `object`,
      properties: {},
    },
  },
}

const cancelNotificationTool = {
  type: `function`,
  function: {
    name: `cancel_notification`,
    description: prompts.tools.cancel_notification.description,
    parameters: {
      type: `object`,
      properties: {
        id: {
          type: `string`,
        },
      },
      required: [`id`],
    },
  },
}

// "Wed, Nov 4, 2026, 3:00 PM", in the user's time zone
export const describeSendTime = function (iso, zone) {
  return new Date(iso).toLocaleString(`en-US`, {
    timeZone: zone,
    weekday: `short`,
    month: `short`,
    day: `numeric`,
    year: `numeric`,
    hour: `numeric`,
    minute: `2-digit`,
  })
}

// A scheduled notification as one line for the model, with its id, its time in the user's zone, e.g.
// `[ck…] Wed, Nov 4, 2026, 3:00 PM: "Leave for the dentist": It's at 3:30. (scheduled in the chat "Teeth")`
export const describeScheduled = function (scheduled, zone) {
  let text = `[${scheduled.id}] ${describeSendTime(scheduled.sendAt, zone)}: "${scheduled.title}": ${scheduled.message}`

  if (scheduled.priority === `high`) {
    text = `${text} (high priority)`
  }

  if (scheduled.checkNote !== ``) {
    text = `${text} (check first: ${scheduled.checkNote})`
  }

  if (scheduled.delays > 0) {
    text = `${text} (delayed ${scheduled.delays === 1 ? `once` : `${scheduled.delays} times`}: ${scheduled.note})`
  }

  if (scheduled.source === `briefing`) {
    text = `${text} (scheduled by a briefing)`
  } else {
    text = `${text} (scheduled in the chat "${scheduled.chatTitle ?? `Untitled chat`}")`
  }

  return text
}

// "in 20 minutes" or "in 2 hours", which the model can give instead of working out the time
const relativeTimePattern = /^in\s+(\d+)\s+(minutes?|mins?|hours?|hrs?)$/i

// When the model asked for it to be sent, a time being in `zone`, the user's: { instant, note },
// `note` saying how a clock change was handled, or { problem } to tell the model
const readSendAt = function (text, zone) {
  const trimmed = typeof text === `string` ? text.trim() : ``

  if (trimmed === ``) {
    return { problem: `no send_at was given` }
  }

  const relative = trimmed.match(relativeTimePattern)

  if (relative != null) {
    const amount = Number(relative[1])
    const isHours = relative[2].toLowerCase().startsWith(`h`)

    return { instant: dayjs().add(amount, isHours ? `hour` : `minute`), note: null }
  }

  try {
    const { instant, asked } = readTime(trimmed, zone)

    // "now" reads as now, which has passed by the time it could be sent
    if (asked == null) {
      return { problem: `send_at must be a later time; to send something now, a briefing uses notify_user` }
    }

    return checkClockChange(instant, asked, zone)
  } catch (err) {
    if (err.isCalculationError === true) {
      return { problem: err.message }
    }

    throw err
  }
}

const runScheduleNotification = function ({ argumentsText, user, chatId, briefingId }) {
  const args = parseArguments(argumentsText) ?? {}
  const title = typeof args.title === `string` ? args.title.trim().slice(0, 120) : ``
  const message = typeof args.message === `string` ? args.message.trim() : ``
  const priority = args.priority === `high` ? `high` : `normal`
  const checkNote = typeof args.check === `string` ? args.check.trim().slice(0, 500) : ``

  if (title === `` || message === ``) {
    return { content: `Not scheduled: a notification needs a title and a message.`, imageId: null }
  }

  const zone = user.timeZone
  const { instant, note, problem } = readSendAt(args.send_at, zone)

  if (problem != null) {
    return { content: `Not scheduled: ${problem}.`, imageId: null }
  }

  if (instant.valueOf() <= Date.now()) {
    return { content: `Not scheduled: ${describeSendTime(instant.toISOString(), zone)} has already passed. It's ${describeSendTime(new Date().toISOString(), zone)} now.`, imageId: null }
  }

  if (instant.valueOf() > Date.now() + notifications.maxDaysAhead * 24 * 60 * 60 * 1000) {
    return { content: `Not scheduled: a notification can be at most ${notifications.maxDaysAhead} days ahead.`, imageId: null }
  }

  if (notifications.countWaiting(user.id) >= notifications.maxWaiting) {
    return { content: `Not scheduled: ${notifications.maxWaiting} notifications are already waiting to be sent. Cancel one that's no longer needed first.`, imageId: null }
  }

  const scheduled = notifications.scheduleNotification({ userId: user.id, title, message, priority, sendAt: instant.toDate(), checkNote, briefingId, chatId })

  let content = `Scheduled [${scheduled.id}] "${title}" for ${describeSendTime(scheduled.sendAt, zone)}. Just before then it's checked against what's happened since, then sent, delayed or skipped.`

  if (note != null) {
    content = `${content} ${note}`
  }

  return { content, imageId: null }
}

const runListScheduledNotifications = function ({ user }) {
  const waiting = notifications.listWaiting(user.id)

  if (waiting.length === 0) {
    return { content: `No notifications are scheduled.`, imageId: null }
  }

  const lines = waiting.map(function (scheduled) {
    return `- ${describeScheduled(scheduled, user.timeZone)}`
  })

  return { content: `Scheduled notifications waiting to be sent, soonest first:\n${lines.join(`\n`)}`, imageId: null }
}

const runCancelNotification = function ({ argumentsText, user }) {
  const args = parseArguments(argumentsText) ?? {}
  const id = typeof args.id === `string` ? args.id.trim() : ``
  const scheduled = id === `` ? null : notifications.getScheduled(user.id, id)

  if (scheduled == null || scheduled.status !== `waiting` || notifications.cancelScheduled(user.id, id) === false) {
    return { content: `There's no scheduled notification with the id "${args.id}" waiting to be sent.`, imageId: null }
  }

  return { content: `Cancelled [${id}] "${scheduled.title}", which was due ${describeSendTime(scheduled.sendAt, user.timeZone)}.`, imageId: null }
}

// Always offered: notifications show on rook's Notifications page even without ntfy
export const tools = [
  {
    name: `schedule_notification`,
    settings: () => ({}),
    definition: () => scheduleNotificationTool,
    run: runScheduleNotification,
  },
  {
    name: `list_scheduled_notifications`,
    settings: () => ({}),
    definition: () => listScheduledNotificationsTool,
    run: runListScheduledNotifications,
  },
  {
    name: `cancel_notification`,
    settings: () => ({}),
    definition: () => cancelNotificationTool,
    run: runCancelNotification,
  },
]

export default {
  describeSendTime,
  describeScheduled,
  tools,
}
