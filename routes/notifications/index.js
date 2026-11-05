import dayjs from 'dayjs'
import utc from 'dayjs/plugin/utc'
import timezone from 'dayjs/plugin/timezone'
import notifications from '../../services/notifications.js'

dayjs.extend(utc)
dayjs.extend(timezone)

// A notification as the page shows it: when it was sent, in words and in `zone`, the user's time
// zone, and whether it's new since the page was last opened
const toPageNotification = function (notification, viewedAt, zone) {
  let briefingWhen = null

  if (notification.briefingStartedAt != null) {
    briefingWhen = dayjs(notification.briefingStartedAt).tz(zone).format(`ddd D MMM, h:mm A`)
  }

  return {
    ...notification,
    ago: dayjs(notification.createdAt).fromNow(),
    when: dayjs(notification.createdAt).tz(zone).format(`ddd D MMM YYYY, h:mm A`),
    briefingWhen,
    isNew: viewedAt == null || notification.createdAt > viewedAt,
  }
}

// How far back the page shows scheduled notifications that weren't sent
const notSentShownFor = 1000 * 60 * 60 * 24

// "Today, 3:00 PM", "Tomorrow, 9:00 AM" or "Thu 12 Nov, 9:00 AM", in `zone`, the user's time zone
const describeDay = function (iso, zone) {
  const day = dayjs(iso).tz(zone)
  const time = day.format(`h:mm A`)
  const now = dayjs().tz(zone)

  if (day.format(`YYYY-MM-DD`) === now.format(`YYYY-MM-DD`)) {
    return `Today, ${time}`
  }

  if (day.format(`YYYY-MM-DD`) === now.add(1, `day`).format(`YYYY-MM-DD`)) {
    return `Tomorrow, ${time}`
  }

  return day.format(`ddd D MMM, h:mm A`)
}

// A scheduled notification as the page shows it: when it's (or was) due, in words
const toPageScheduled = function (scheduled, zone) {
  return { ...scheduled, dueLabel: describeDay(scheduled.sendAt, zone) }
}

export const GET = async function (ctx) {
  const userId = ctx.state.user.id
  const zone = ctx.state.user.timeZone

  // Which are new is worked out before marking them seen
  const viewedAt = notifications.getViewedAt(userId)

  const list = notifications.listNotifications(userId, 100).map(function (notification) {
    return toPageNotification(notification, viewedAt, zone)
  })

  const toPage = function (scheduled) {
    return toPageScheduled(scheduled, zone)
  }

  const comingUp = notifications.listWaiting(userId).map(toPage)
  const notSent = notifications.listSkippedSince(userId, new Date(Date.now() - notSentShownFor)).map(toPage)

  // Before rendering, so the Notifications nav item on this page doesn't show the dot
  notifications.markViewed(userId)

  ctx.body = ctx.nunjucks(`notifications/index`, {
    notifications: list,
    comingUp,
    notSent,
    isPushOn: notifications.getNtfySettings(userId).url != null,
  })
}
