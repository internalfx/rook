import briefings from '../services/briefings.js'
import notifications from '../services/notifications.js'
import tasks from '../services/tasks.js'

// What the Briefing, Tasks and Notifications nav items show the user, on every page: a dot for a
// briefing or notification they haven't seen yet, and how many of their tasks are due. The layout
// asks for them again through /indicators, so a page left open keeps up. Nothing to show while
// no one is logged in (the login page).
export const readIndicators = function (user) {
  if (user == null) {
    return { briefingIsNew: false, notificationsUnseen: false, tasksBadge: 0 }
  }

  return {
    briefingIsNew: briefings.hasUnseen(user.id),
    notificationsUnseen: notifications.hasUnseen(user.id),
    tasksBadge: tasks.countDue(user.id, user.timeZone),
  }
}

export default {
  readIndicators,
}
