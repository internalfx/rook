import cuid from 'cuid'
import db from './db.js'
import settings from './settings.js'

// Notifications the model sends the owner (from briefings, for now). Each is kept in rook, under
// the bell in the header, and pushed to their phone through ntfy (https://ntfy.sh) when a topic
// URL is set in Settings. The ntfy app shows it even when rook isn't open.

// Older notifications are deleted
const keptNotifications = 200

const pushTimeout = 1000 * 10

// ntfy's priorities run 1 to 5; 3 is its default, 4 makes the phone more insistent
const ntfyPriorities = { normal: 3, high: 4 }

const insertNotification = db.query(`
  INSERT INTO notifications (id, title, message, priority, briefingId, pushStatus, pushError, createdAt)
  VALUES ($id, $title, $message, $priority, $briefingId, $pushStatus, $pushError, $now)
`)
const deleteOldNotifications = db.query(`
  DELETE FROM notifications WHERE id NOT IN (
    SELECT id FROM notifications ORDER BY createdAt DESC, rowid DESC LIMIT $keep
  )
`)
const selectNotification = db.query(`SELECT * FROM notifications WHERE id = $id`)
const selectNotifications = db.query(`
  SELECT notifications.*, briefings.startedAt AS briefingStartedAt
  FROM notifications LEFT JOIN briefings ON briefings.id = notifications.briefingId
  ORDER BY notifications.createdAt DESC, notifications.rowid DESC LIMIT $limit
`)
const selectSentSince = db.query(`
  SELECT * FROM notifications WHERE createdAt > $since ORDER BY createdAt DESC, rowid DESC LIMIT $limit
`)
const selectLatestCreatedAt = db.query(`SELECT MAX(createdAt) AS createdAt FROM notifications`)
const deleteNotificationRow = db.query(`DELETE FROM notifications WHERE id = $id`)

// Where pushes go, from Settings: { url, token }, with url null while it isn't set up
export const getNtfySettings = function () {
  return {
    url: settings.get(`ntfyUrl`),
    token: settings.get(`ntfyToken`),
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

export const getNotification = function (id) {
  return selectNotification.get({ id }) ?? null
}

// Keeps the notification and pushes it to the phone when ntfy is set up. `briefingId` is the
// briefing that sent it. Returns the notification, with how the push went (pushStatus,
// pushError); it never throws.
export const sendNotification = async function ({ title, message, priority = `normal`, briefingId = null }) {
  const { url, token } = getNtfySettings()

  let pushStatus = `off`
  let pushError = null

  if (url != null) {
    const result = await pushToNtfy({ title, message, priority, url, token })

    pushStatus = result.ok ? `sent` : `failed`
    pushError = result.error
  }

  const id = cuid()

  insertNotification.run({ id, title, message, priority, briefingId, pushStatus, pushError, now: new Date().toISOString() })
  deleteOldNotifications.run({ keep: keptNotifications })

  return getNotification(id)
}

// The newest notifications first, each with the start of the briefing that sent it
// (briefingStartedAt), if that's still kept
export const listNotifications = function (limit = 100) {
  return selectNotifications.all({ limit })
}

// The notifications sent after `since` (an ISO date), newest first
export const listSentSince = function (since, limit) {
  return selectSentSince.all({ since, limit })
}

export const deleteNotification = function (id) {
  deleteNotificationRow.run({ id })
}

// When the Notifications page was last shown, as an ISO date, or null if never
export const getViewedAt = function () {
  return settings.get(`notificationsViewedAt`)
}

// Called when the Notifications page is shown, so the bell stops saying there's something new
export const markViewed = function () {
  settings.set(`notificationsViewedAt`, new Date().toISOString())
}

// Whether a notification has arrived since the Notifications page was last shown, for the dot
// on the bell
export const hasUnseen = function () {
  const row = selectLatestCreatedAt.get()

  if (row.createdAt == null) {
    return false
  }

  const viewedAt = getViewedAt()

  if (viewedAt == null) {
    return true
  }

  // Both are ISO dates, which compare in time order as text
  return row.createdAt > viewedAt
}

export default {
  getNtfySettings,
  parseTopicUrl,
  pushToNtfy,
  sendTest,
  getNotification,
  sendNotification,
  listNotifications,
  listSentSince,
  deleteNotification,
  getViewedAt,
  markViewed,
  hasUnseen,
}
