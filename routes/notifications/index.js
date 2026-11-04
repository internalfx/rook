import dayjs from 'dayjs'
import notifications from '../../services/notifications.js'

// A notification as the page shows it: when it was sent, in words, and whether it's new since the
// page was last opened
const toPageNotification = function (notification, viewedAt) {
  let briefingWhen = null

  if (notification.briefingStartedAt != null) {
    briefingWhen = dayjs(notification.briefingStartedAt).format(`ddd D MMM, h:mm A`)
  }

  return {
    ...notification,
    ago: dayjs(notification.createdAt).fromNow(),
    when: dayjs(notification.createdAt).format(`ddd D MMM YYYY, h:mm A`),
    briefingWhen,
    isNew: viewedAt == null || notification.createdAt > viewedAt,
  }
}

// How far back the page shows scheduled notifications that weren't sent
const notSentShownFor = 1000 * 60 * 60 * 24

// "Today, 3:00 PM", "Tomorrow, 9:00 AM" or "Thu 12 Nov, 9:00 AM"
const describeDay = function (iso) {
  const day = dayjs(iso)
  const time = day.format(`h:mm A`)

  if (day.isSame(dayjs(), `day`)) {
    return `Today, ${time}`
  }

  if (day.isSame(dayjs().add(1, `day`), `day`)) {
    return `Tomorrow, ${time}`
  }

  return day.format(`ddd D MMM, h:mm A`)
}

// A scheduled notification as the page shows it: when it's (or was) due, in words
const toPageScheduled = function (scheduled) {
  return { ...scheduled, dueLabel: describeDay(scheduled.sendAt) }
}

export const GET = async function (ctx) {
  // Which are new is worked out before marking them seen
  const viewedAt = notifications.getViewedAt()

  const list = notifications.listNotifications(100).map(function (notification) {
    return toPageNotification(notification, viewedAt)
  })

  const comingUp = notifications.listWaiting().map(toPageScheduled)
  const notSent = notifications.listSkippedSince(new Date(Date.now() - notSentShownFor)).map(toPageScheduled)

  // Before rendering, so the Notifications nav item on this page doesn't show the dot
  notifications.markViewed()

  ctx.body = ctx.nunjucks(`notifications/index`, {
    notifications: list,
    comingUp,
    notSent,
    isPushOn: notifications.getNtfySettings().url != null,
  })
}
