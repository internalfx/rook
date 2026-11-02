import briefings from '../services/briefings.js'
import notifications from '../services/notifications.js'
import tasks from '../services/tasks.js'

// What the Briefing and Tasks nav items and the bell show, on every page: a dot for a briefing
// or notification not seen yet, and how many tasks are due. The layout asks for them again
// through /indicators, so a page left open keeps up.
export const readIndicators = function () {
  return {
    briefingIsNew: briefings.hasUnseen(),
    notificationsUnseen: notifications.hasUnseen(),
    tasksBadge: tasks.countDue(),
  }
}

export default {
  readIndicators,
}
