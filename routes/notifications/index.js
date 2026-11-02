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

export const GET = async function (ctx) {
  // Which are new is worked out before marking them seen
  const viewedAt = notifications.getViewedAt()

  const list = notifications.listNotifications(100).map(function (notification) {
    return toPageNotification(notification, viewedAt)
  })

  // Before rendering, so the bell on this page doesn't show the dot
  notifications.markViewed()

  ctx.body = ctx.nunjucks(`notifications/index`, {
    notifications: list,
    isPushOn: notifications.getNtfySettings().url != null,
  })
}
