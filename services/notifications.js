import cuid from 'cuid'
import db from './db.js'
import settings from './settings.js'

// Notifications the model sends a user, each theirs alone (userId). Each is kept in rook, on the
// Notifications page, and pushed to their phone through ntfy (https://ntfy.sh) when a topic URL
// is set in their Settings. The ntfy app shows it even when rook isn't open.
//
// A briefing sends one straight away (notify_user), or the model schedules one for later, in a
// chat or a briefing (schedule_notification). A scheduled one waits in scheduledNotifications
// until it's due, when the model checks it and it's sent, delayed or skipped (see
// services/notificationChecks.js).

// Older notifications are deleted, per user
const keptNotifications = 200

// How many scheduled notifications a user can have waiting at once, and how far ahead one can be
export const maxWaiting = 20
export const maxDaysAhead = 30

// Skipped and missed scheduled notifications are kept this long, for briefings and the
// Notifications page to show
const skippedKeptDays = 7

const pushTimeout = 1000 * 10

// ntfy's priorities run 1 to 5; 3 is its default, 4 makes the phone more insistent
const ntfyPriorities = { normal: 3, high: 4 }

const insertNotification = db.query(`
  INSERT INTO notifications (id, userId, title, message, priority, briefingId, pushStatus, pushError, createdAt)
  VALUES ($id, $userId, $title, $message, $priority, $briefingId, $pushStatus, $pushError, $now)
`)
const deleteOldNotifications = db.query(`
  DELETE FROM notifications WHERE userId = $userId AND id NOT IN (
    SELECT id FROM notifications WHERE userId = $userId ORDER BY createdAt DESC, rowid DESC LIMIT $keep
  )
`)
const selectNotification = db.query(`SELECT * FROM notifications WHERE id = $id AND userId = $userId`)
const selectNotifications = db.query(`
  SELECT notifications.*, briefings.startedAt AS briefingStartedAt
  FROM notifications LEFT JOIN briefings ON briefings.id = notifications.briefingId
  WHERE notifications.userId = $userId
  ORDER BY notifications.createdAt DESC, notifications.rowid DESC LIMIT $limit
`)
const selectSentSince = db.query(`
  SELECT * FROM notifications WHERE userId = $userId AND createdAt > $since
  ORDER BY createdAt DESC, rowid DESC LIMIT $limit
`)
const selectLatestCreatedAt = db.query(`SELECT MAX(createdAt) AS createdAt FROM notifications WHERE userId = $userId`)
const deleteNotificationRow = db.query(`DELETE FROM notifications WHERE id = $id AND userId = $userId`)

// Each with the title of the chat it was scheduled in (chatTitle), if any
const scheduledColumns = `scheduledNotifications.*, chats.title AS chatTitle`
const scheduledFrom = `scheduledNotifications LEFT JOIN chats ON chats.id = scheduledNotifications.chatId`

const insertScheduled = db.query(`
  INSERT INTO scheduledNotifications (id, userId, title, message, priority, sendAt, checkNote, source, briefingId, chatId, createdAt, updatedAt)
  VALUES ($id, $userId, $title, $message, $priority, $sendAt, $checkNote, $source, $briefingId, $chatId, $now, $now)
`)
const selectScheduled = db.query(`
  SELECT ${scheduledColumns} FROM ${scheduledFrom}
  WHERE scheduledNotifications.id = $id AND scheduledNotifications.userId = $userId
`)
const selectWaiting = db.query(`
  SELECT ${scheduledColumns} FROM ${scheduledFrom}
  WHERE scheduledNotifications.userId = $userId AND status = 'waiting' ORDER BY sendAt
`)
// Every user's, for sending them
const selectDue = db.query(`
  SELECT ${scheduledColumns} FROM ${scheduledFrom} WHERE status = 'waiting' AND sendAt <= $until ORDER BY sendAt
`)
const selectSkippedSince = db.query(`
  SELECT ${scheduledColumns} FROM ${scheduledFrom}
  WHERE scheduledNotifications.userId = $userId AND status != 'waiting' AND scheduledNotifications.updatedAt > $since
  ORDER BY scheduledNotifications.updatedAt DESC
`)
const countWaitingRows = db.query(`
  SELECT COUNT(*) AS count FROM scheduledNotifications WHERE userId = $userId AND status = 'waiting'
`)
const deleteWaitingRow = db.query(`
  DELETE FROM scheduledNotifications WHERE id = $id AND userId = $userId AND status = 'waiting'
`)
const deleteScheduledRow = db.query(`DELETE FROM scheduledNotifications WHERE id = $id`)
const updateSkipped = db.query(`
  UPDATE scheduledNotifications SET status = $status, note = $note, updatedAt = $now WHERE id = $id
`)
const updateDelayed = db.query(`
  UPDATE scheduledNotifications SET sendAt = $sendAt, note = $note, delays = delays + 1, updatedAt = $now
  WHERE id = $id
`)
const deleteOldSkippedRows = db.query(`
  DELETE FROM scheduledNotifications WHERE status != 'waiting' AND updatedAt < $before
`)

// Where a user's pushes go, from their Settings: { url, token }, with url null while it isn't
// set up
export const getNtfySettings = function (userId) {
  return {
    url: settings.get(userId, `ntfyUrl`),
    token: settings.get(userId, `ntfyToken`),
  }
}

// A topic URL like https://ntfy.sh/rook-a1b2 => { server: "https://ntfy.sh/", topic: "rook-a1b2" }.
// The topic is the last part of the path, so a self-hosted ntfy under a sub-path works too.
// Null when it isn't an http(s) URL with a topic.
export const parseTopicUrl = function (url) {
  let parsed = null

  try {
    parsed = new URL(url)
  } catch (err) {
    return null
  }

  if (parsed.protocol !== `https:` && parsed.protocol !== `http:`) {
    return null
  }

  const segments = parsed.pathname.split(`/`).filter(function (segment) {
    return segment !== ``
  })

  if (segments.length === 0) {
    return null
  }

  const topic = segments.pop()
  const server = `${parsed.origin}/${segments.join(`/`)}`

  return { server, topic }
}

// ntfy's own error message from a failed response, which it sends as { error } JSON
const readNtfyError = async function (response) {
  const text = (await response.text()).trim()
  let message = text.slice(0, 200)

  try {
    const body = JSON.parse(text)

    if (typeof body.error === `string` && body.error !== ``) {
      message = body.error
    }
  } catch (err) {}

  if (message === ``) {
    return `ntfy answered ${response.status} ${response.statusText}`
  }

  return `ntfy answered ${response.status}: ${message}`
}

// Publishes to the topic at `url`, as JSON, which keeps any title intact (ntfy's header form
// only takes plain ASCII). Returns { ok, error }; it never throws.
export const pushToNtfy = async function ({ title, message, priority = `normal`, url, token = null }) {
  const target = parseTopicUrl(url)

  if (target == null) {
    return { ok: false, error: `"${url}" isn't an ntfy topic URL, like https://ntfy.sh/your-topic.` }
  }

  const headers = { 'Content-Type': `application/json` }

  // For a topic that needs logging in to
  if (token != null && token !== ``) {
    headers.Authorization = `Bearer ${token}`
  }

  const payload = {
    topic: target.topic,
    title,
    message,
    priority: ntfyPriorities[priority] ?? ntfyPriorities.normal,
    tags: [`bell`],
  }

  try {
    const response = await fetch(target.server, {
      method: `POST`,
      headers,
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(pushTimeout),
    })

    if (response.ok === false) {
      return { ok: false, error: await readNtfyError(response) }
    }

    return { ok: true, error: null }
  } catch (err) {
    return { ok: false, error: err.message }
  }
}

// From the Settings test button: pushes to what's typed there, without saving anything
export const sendTest = async function ({ url, token }) {
  const result = await pushToNtfy({
    title: `Rook test notification`,
    message: `Notifications from rook will arrive like this.`,
    url,
    token,
  })

  return result
}

// The user's notification with that id, or null: another user's reads as none
export const getNotification = function (userId, id) {
  return selectNotification.get({ userId, id }) ?? null
}

// Keeps the notification for the user and pushes it to their phone when their ntfy is set up.
// `briefingId` is the briefing that sent it. Returns the notification, with how the push went
// (pushStatus, pushError); it never throws.
export const sendNotification = async function ({ userId, title, message, priority = `normal`, briefingId = null }) {
  const { url, token } = getNtfySettings(userId)

  let pushStatus = `off`
  let pushError = null

  if (url != null) {
    const result = await pushToNtfy({ title, message, priority, url, token })

    pushStatus = result.ok ? `sent` : `failed`
    pushError = result.error
  }

  const id = cuid()

  insertNotification.run({ id, userId, title, message, priority, briefingId, pushStatus, pushError, now: new Date().toISOString() })
  deleteOldNotifications.run({ userId, keep: keptNotifications })

  return getNotification(userId, id)
}

// The user's newest notifications first, each with the start of the briefing that sent it
// (briefingStartedAt), if that's still kept
export const listNotifications = function (userId, limit = 100) {
  return selectNotifications.all({ userId, limit })
}

// The user's notifications sent after `since` (an ISO date), newest first
export const listSentSince = function (userId, since, limit) {
  return selectSentSince.all({ userId, since, limit })
}

export const deleteNotification = function (userId, id) {
  deleteNotificationRow.run({ userId, id })
}

// The user's scheduled notification with that id, or null: another user's reads as none
export const getScheduled = function (userId, id) {
  return selectScheduled.get({ userId, id }) ?? null
}

// Keeps a notification to send the user at `sendAt` (a Date), once the model has checked it.
// `checkNote` is what to check first, or empty. It was scheduled by the briefing `briefingId`,
// or else in the chat `chatId`. Returns the scheduled notification.
export const scheduleNotification = function ({ userId, title, message, priority = `normal`, sendAt, checkNote = ``, briefingId = null, chatId = null }) {
  const id = cuid()
  const source = briefingId == null ? `chat` : `briefing`

  insertScheduled.run({ id, userId, title, message, priority, sendAt: sendAt.toISOString(), checkNote, source, briefingId, chatId, now: new Date().toISOString() })

  return getScheduled(userId, id)
}

// The user's scheduled notifications still to send, soonest first
export const listWaiting = function (userId) {
  return selectWaiting.all({ userId })
}

export const countWaiting = function (userId) {
  return countWaitingRows.get({ userId }).count
}

// Every user's waiting to be sent at or before `until` (a Date), soonest first; each has its
// userId
export const listDue = function (until) {
  return selectDue.all({ until: until.toISOString() })
}

// The user's skipped or missed after `since` (a Date), most recent first
export const listSkippedSince = function (userId, since) {
  return selectSkippedSince.all({ userId, since: since.toISOString() })
}

// Cancels a scheduled notification of the user's that's still waiting. Returns whether there
// was one.
export const cancelScheduled = function (userId, id) {
  return deleteWaitingRow.run({ userId, id }).changes > 0
}

// Once it's been sent; it's in notifications from then on
export const deleteScheduled = function (id) {
  deleteScheduledRow.run({ id })
}

// `status` is `skipped` or `missed`; `note` says why
export const markSkipped = function (id, status, note) {
  updateSkipped.run({ id, status, note, now: new Date().toISOString() })
}

// Puts it off until `sendAt` (a Date), when it's checked again; `note` says why
export const delayScheduled = function (id, sendAt, note) {
  updateDelayed.run({ id, sendAt: sendAt.toISOString(), note, now: new Date().toISOString() })
}

export const deleteOldSkipped = function () {
  const before = new Date(Date.now() - skippedKeptDays * 24 * 60 * 60 * 1000).toISOString()
  deleteOldSkippedRows.run({ before })
}

// When the user last saw the Notifications page, as an ISO date, or null if never
export const getViewedAt = function (userId) {
  return settings.get(userId, `notificationsViewedAt`)
}

// Called when the Notifications page is shown, so its nav item stops saying there's something new
export const markViewed = function (userId) {
  settings.set(userId, `notificationsViewedAt`, new Date().toISOString())
}

// Whether a notification has arrived since the user last saw the Notifications page, for the
// dot on its nav item
export const hasUnseen = function (userId) {
  const row = selectLatestCreatedAt.get({ userId })

  if (row.createdAt == null) {
    return false
  }

  const viewedAt = getViewedAt(userId)

  if (viewedAt == null) {
    return true
  }

  // Both are ISO dates, which compare in time order as text
  return row.createdAt > viewedAt
}

export default {
  maxWaiting,
  maxDaysAhead,
  getNtfySettings,
  parseTopicUrl,
  pushToNtfy,
  sendTest,
  getNotification,
  sendNotification,
  listNotifications,
  listSentSince,
  deleteNotification,
  getScheduled,
  scheduleNotification,
  listWaiting,
  countWaiting,
  listDue,
  listSkippedSince,
  cancelScheduled,
  deleteScheduled,
  markSkipped,
  delayScheduled,
  deleteOldSkipped,
  getViewedAt,
  markViewed,
  hasUnseen,
}
