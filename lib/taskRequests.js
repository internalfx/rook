import cuid from 'cuid'
import db from './db.js'
import settings from './settings.js'
import tasks from './tasks.js'
import users from './users.js'

// Task requests: one user asking another on the same rook to do something. A request isn't a
// task. It's sent from a chat (request_task, see ai-tools/taskRequests.js), and only reaches
// someone who has allowed the sender on their People page (Settings); everyone starts blocked.
// The recipient's model then looks at it (services/requestReviews.js), going by the note the
// recipient wrote about the sender, and accepts it, which adds a task to their list, declines it,
// or holds it for them to answer on the Tasks page.
//
// A request's status is reviewing (the model hasn't looked yet), waiting (held for the
// recipient), accepted or declined. What became of an accepted one is read from its task
// (tasks.requestId): still on the list, done, or removed. That's its `state`.
//
// The sender is shown where their request stands and, once it's done, the completion note. They
// aren't shown the model's reasons, which are written with the recipient's memories and tasks to
// hand; only a reason the recipient typed themselves when declining.

// The longest note a user can keep about someone, since the model is given it with every message
export const maxNoteLength = 500

// How many requests one user can send another in 24 hours: each costs the recipient a run of the
// model
export const maxPerDay = 10

// The longest reason kept for accepting, declining or holding a request
export const maxReasonLength = 500

// How long the Tasks page, list_task_requests and briefings go on showing what the model decided
export const recentDays = 7

// One sender's requests push the recipient's phone at most this often
const pushGap = 1000 * 60 * 60

// Each with both people's names, and its task's id, done date and completion note when it has one
const requestColumns = `
  taskRequests.*, senders.name AS fromName, recipients.name AS toName,
  tasks.id AS taskId, tasks.doneAt AS taskDoneAt, tasks.doneNote AS taskDoneNote
`
const requestFrom = `
  taskRequests JOIN users AS senders ON senders.id = taskRequests.fromUserId
  JOIN users AS recipients ON recipients.id = taskRequests.toUserId
  LEFT JOIN tasks ON tasks.requestId = taskRequests.id
`

const insertRequest = db.query(`
  INSERT INTO taskRequests (id, fromUserId, toUserId, title, notes, priority, dueDate, status, chatId, createdAt, updatedAt)
  VALUES ($id, $fromUserId, $toUserId, $title, $notes, $priority, $dueDate, 'reviewing', $chatId, $now, $now)
`)
const selectIncoming = db.query(`
  SELECT ${requestColumns} FROM ${requestFrom} WHERE taskRequests.id = $id AND taskRequests.toUserId = $userId
`)
const selectSent = db.query(`
  SELECT ${requestColumns} FROM ${requestFrom} WHERE taskRequests.id = $id AND taskRequests.fromUserId = $userId
`)
// Every user's, for reviewing them
const selectToReview = db.query(`
  SELECT ${requestColumns} FROM ${requestFrom} WHERE taskRequests.status = 'reviewing' ORDER BY taskRequests.createdAt
`)
const selectHeld = db.query(`
  SELECT ${requestColumns} FROM ${requestFrom}
  WHERE taskRequests.toUserId = $userId AND taskRequests.status = 'waiting' ORDER BY taskRequests.createdAt
`)
const selectAnswered = db.query(`
  SELECT ${requestColumns} FROM ${requestFrom}
  WHERE taskRequests.toUserId = $userId AND taskRequests.answeredAt > $since
  ORDER BY taskRequests.answeredAt DESC
`)
const selectSentList = db.query(`
  SELECT ${requestColumns} FROM ${requestFrom}
  WHERE taskRequests.fromUserId = $userId ORDER BY taskRequests.createdAt DESC LIMIT $limit
`)
const countHeldRows = db.query(`
  SELECT COUNT(*) AS count FROM taskRequests WHERE toUserId = $userId AND status = 'waiting'
`)
const countSentSince = db.query(`
  SELECT COUNT(*) AS count FROM taskRequests
  WHERE fromUserId = $fromUserId AND toUserId = $toUserId AND createdAt > $since
`)
const updateAccepted = db.query(`
  UPDATE taskRequests SET status = 'accepted', answeredBy = $by, answerNote = $note, answeredAt = $now, updatedAt = $now
  WHERE id = $id AND toUserId = $userId
`)
const updateDeclined = db.query(`
  UPDATE taskRequests SET status = 'declined', answeredBy = $by, answerNote = $note, answeredAt = $now, updatedAt = $now
  WHERE id = $id AND toUserId = $userId
`)
const updateHeld = db.query(`
  UPDATE taskRequests SET status = 'waiting', answerNote = $note, updatedAt = $now
  WHERE id = $id AND status = 'reviewing'
`)
const deleteUnanswered = db.query(`
  DELETE FROM taskRequests WHERE id = $id AND fromUserId = $userId AND status IN ('reviewing', 'waiting')
`)
const updatePushed = db.query(`UPDATE taskRequests SET pushedAt = $now WHERE id = $id`)
const selectLastPushed = db.query(`
  SELECT MAX(pushedAt) AS pushedAt FROM taskRequests WHERE fromUserId = $fromUserId AND toUserId = $toUserId
`)
// Declined ones, those whose task was done long enough ago to be deleted itself, and accepted
// ones whose task the recipient has removed
const deleteOldRows = db.query(`
  DELETE FROM taskRequests WHERE
    (status = 'declined' AND answeredAt < $before)
    OR id IN (SELECT requestId FROM tasks WHERE requestId IS NOT NULL AND doneAt IS NOT NULL AND doneAt < $before)
    OR (status = 'accepted' AND answeredAt < $before AND id NOT IN (SELECT requestId FROM tasks WHERE requestId IS NOT NULL))
`)

// PEOPLE

// What the user has set for the others, by their user id: { "2": { allowed: true, note: "…" } }.
// Someone not in it is blocked, with no note.
const readSavedPeople = function (userId) {
  return settings.get(userId, `people`) ?? {}
}

// Everyone else on this rook, as `user` has them: { id, name, email, label, allowed, note }.
// `allowed` is whether they may send `user` task requests, and `note` is what `user` wrote about
// them for the model. `label` is what the model calls them: their name, with their email when
// two of them share it.
export const listPeople = function (user) {
  const saved = readSavedPeople(user.id)

  const others = users.listUsers().filter(function (other) {
    return other.id !== user.id
  })

  const nameCounts = {}

  for (const other of others) {
    const key = other.name.trim().toLowerCase()
    nameCounts[key] = (nameCounts[key] ?? 0) + 1
  }

  return others.map(function (other) {
    const entry = saved[other.id] ?? {}
    const isSharedName = nameCounts[other.name.trim().toLowerCase()] > 1

    return {
      id: other.id,
      name: other.name,
      email: other.email,
      label: isSharedName ? `${other.name} (${other.email})` : other.name,
      allowed: entry.allowed === true,
      note: typeof entry.note === `string` ? entry.note : ``,
    }
  })
}

// What `userId` has set for `personId`: { allowed, note }
export const getPerson = function (userId, personId) {
  const entry = readSavedPeople(userId)[personId] ?? {}

  return {
    allowed: entry.allowed === true,
    note: typeof entry.note === `string` ? entry.note : ``,
  }
}

// Saves what the People page posted: `people` is a list of { id, allowed, note }. Those blocked
// with no note aren't kept, being what everyone starts as.
export const setPeople = function (userId, people) {
  const saved = {}

  for (const person of people) {
    const note = person.note.trim().slice(0, maxNoteLength)

    if (person.allowed === true || note !== ``) {
      saved[person.id] = { allowed: person.allowed === true, note }
    }
  }

  if (Object.keys(saved).length === 0) {
    settings.unset(userId, `people`)
  } else {
    settings.set(userId, `people`, saved)
  }
}

// REQUESTS

// Where an accepted request's task has got to; the others' state is their status
const readState = function (row) {
  if (row.status !== `accepted`) {
    return row.status
  }

  if (row.taskId == null) {
    return `removed`
  }

  if (row.taskDoneAt != null) {
    return `done`
  }

  return `accepted`
}

// A request as its recipient sees it, the model's reasons included
const toIncoming = function (row) {
  return { ...row, state: readState(row) }
}

// A request as its sender sees it: no reason the recipient's model gave, and nothing of the task
// but when it was done and its completion note
const toSent = function (row) {
  const state = readState(row)
  const isOwnDecline = row.status === `declined` && row.answeredBy === `user`

  return {
    id: row.id,
    toUserId: row.toUserId,
    toName: row.toName,
    title: row.title,
    notes: row.notes,
    priority: row.priority,
    dueDate: row.dueDate,
    state,
    answeredBy: row.answeredBy,
    answeredAt: row.answeredAt,
    declineReason: isOwnDecline ? row.answerNote : ``,
    doneAt: state === `done` ? row.taskDoneAt : null,
    doneNote: state === `done` ? row.taskDoneNote : ``,
    createdAt: row.createdAt,
  }
}

// Sends `from`'s request to another user: { outcome, request }. `outcome` is `sent`; `blocked`
// when the recipient hasn't allowed `from`; or `limit` when `from` has sent them maxPerDay in the
// last 24 hours. Only a sent one is kept, and has a `request`.
export const sendRequest = function ({ from, toUserId, title, notes = ``, priority = `normal`, dueDate = null, chatId = null }) {
  const person = getPerson(toUserId, from.id)

  if (person.allowed === false) {
    return { outcome: `blocked`, request: null }
  }

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  const sentToday = countSentSince.get({ fromUserId: from.id, toUserId, since }).count

  if (sentToday >= maxPerDay) {
    return { outcome: `limit`, request: null }
  }

  const id = cuid()

  insertRequest.run({ id, fromUserId: from.id, toUserId, title, notes, priority, dueDate, chatId, now: new Date().toISOString() })

  return { outcome: `sent`, request: getSent(from.id, id) }
}

// The request with that id sent to the user, or null: one sent to someone else reads as none
export const getIncoming = function (userId, id) {
  const row = selectIncoming.get({ userId, id })

  return row == null ? null : toIncoming(row)
}

// The request with that id the user sent, as they see it, or null
export const getSent = function (userId, id) {
  const row = selectSent.get({ userId, id })

  return row == null ? null : toSent(row)
}

// Every user's requests the model hasn't looked at yet, oldest first
export const listToReview = function () {
  return selectToReview.all().map(toIncoming)
}

// The requests held for the user to answer, oldest first
export const listHeld = function (userId) {
  return selectHeld.all({ userId }).map(toIncoming)
}

// The requests to the user that were accepted or declined after `since` (a Date), by them or by
// their model (answeredBy), newest first
export const listAnswered = function (userId, since) {
  return selectAnswered.all({ userId, since: since.toISOString() }).map(toIncoming)
}

// The requests the user has sent, newest first
export const listSent = function (userId, limit = 50) {
  return selectSentList.all({ userId, limit }).map(toSent)
}

// How many requests are held for the user, for the dot on the Tasks nav item
export const countHeld = function (userId) {
  return countHeldRows.get({ userId }).count
}

// Whether `by` (`user` or `model`) may accept the request as it stands: the model only one it's
// reviewing; the user one held for them, or one their model declined
const canAccept = function (request, by) {
  if (by === `model`) {
    return request.status === `reviewing`
  }

  return request.status === `waiting` || (request.status === `declined` && request.answeredBy === `model`)
}

// Accepts the user's request, adding a task to their list: { request, task }, or null when
// there's no such request or `by` can't accept it now. `by` is `user` or `model`, and `note` the
// model's reason. `priority` and `dueDate` are the model's changes to what was asked: left out
// (undefined), the task takes the request's.
export const accept = function (userId, id, { by, note = ``, priority, dueDate }) {
  const acceptRequest = db.transaction(function () {
    const request = getIncoming(userId, id)

    if (request == null || canAccept(request, by) === false) {
      return null
    }

    updateAccepted.run({ id, userId, by, note: note.slice(0, maxReasonLength), now: new Date().toISOString() })

    const task = tasks.createTask({
      userId,
      title: request.title,
      notes: request.notes,
      priority: priority ?? request.priority,
      dueDate: dueDate === undefined ? request.dueDate : dueDate,
      requestId: id,
    })

    return { request: getIncoming(userId, id), task }
  })

  return acceptRequest()
}

// Declines the user's request and returns it, or null when there's no such request or `by` can't
// decline it now: the model only one it's reviewing, the user only one held for them. `note` is
// the reason; the sender is shown the user's, never the model's.
export const decline = function (userId, id, { by, note = `` }) {
  const request = getIncoming(userId, id)
  const neededStatus = by === `model` ? `reviewing` : `waiting`

  if (request == null || request.status !== neededStatus) {
    return null
  }

  updateDeclined.run({ id, userId, by, note: note.slice(0, maxReasonLength), now: new Date().toISOString() })

  return getIncoming(userId, id)
}

// Leaves a request the model was reviewing for its recipient to answer. `note` is why: the
// model's reason, or what went wrong with the review.
export const hold = function (id, note) {
  updateHeld.run({ id, note: note.slice(0, maxReasonLength), now: new Date().toISOString() })
}

// Takes back a request the user sent that hasn't been answered yet. Returns whether there was one.
export const withdraw = function (userId, id) {
  const result = deleteUnanswered.run({ userId, id })

  return result.changes > 0
}

// Whether a request from `fromUserId` may push `toUserId`'s phone now: not within pushGap of
// their last one that did
export const canPush = function (fromUserId, toUserId) {
  const row = selectLastPushed.get({ fromUserId, toUserId })

  if (row.pushedAt == null) {
    return true
  }

  return Date.now() - Date.parse(row.pushedAt) >= pushGap
}

export const markPushed = function (id) {
  updatePushed.run({ id, now: new Date().toISOString() })
}

// Deletes every user's requests that were settled before `before` (a Date): see deleteOldRows.
// Called before the old done tasks are deleted (services/doneTasks.js), while a request can
// still be matched to its task.
export const deleteOld = function (before) {
  const result = deleteOldRows.run({ before: before.toISOString() })

  return result.changes
}

// FOR THE MODEL

// What was asked, e.g. `"Order paper" (high priority; due 2026-11-13)\n  Notes: …`
const describeAsk = function (request) {
  const details = []

  if (request.priority !== `normal`) {
    details.push(`${request.priority} priority`)
  }

  if (request.dueDate != null) {
    details.push(`due ${request.dueDate}`)
  }

  let text = `"${request.title}"`

  if (details.length > 0) {
    text = `${text} (${details.join(`; `)})`
  }

  if (request.notes !== ``) {
    text = `${text}\n  Notes: ${request.notes.replace(/\s+/g, ` `)}`
  }

  return text
}

// A request someone sent the user, as the user's model is told about it, e.g.
// `[id] Dana asked on 2026-11-10: "Order paper" (due 2026-11-13)\n  Notes: …`, then what's become
// of it and why. Its days are in `zone`, the user's time zone.
export const describeIncoming = function (request, zone) {
  let text = `[${request.id}] ${request.fromName} asked on ${tasks.toDay(new Date(request.createdAt), zone)}: ${describeAsk(request)}`

  let outcome = null

  if (request.status === `waiting`) {
    outcome = `Waiting for the user's answer`
  } else if (request.status === `declined`) {
    outcome = request.answeredBy === `model` ? `You declined it for the user` : `The user declined it themselves`
  } else if (request.status === `accepted`) {
    outcome = request.answeredBy === `model` ? `You accepted it for the user, so it's on their to-do list` : `The user accepted it themselves, so it's on their to-do list`
  }

  if (outcome != null) {
    text = `${text}\n  ${outcome}${request.answerNote === `` ? `.` : `: ${request.answerNote}`}`
  }

  return text
}

// A request the user sent, as their model is told about it, e.g.
// `[id] Asked of Dana on 2026-11-10: "Order paper" (due 2026-11-13)\n  Done 2026-11-12: "Ordered 10 reams."`
// Its days are in `zone`, the user's time zone.
export const describeSent = function (sent, zone) {
  const name = sent.toName

  const dayOf = function (iso) {
    return tasks.toDay(new Date(iso), zone)
  }
  let outcome = `${name}'s ROOK is looking at it.`

  if (sent.state === `waiting`) {
    outcome = `Waiting for ${name} to answer.`
  } else if (sent.state === `accepted`) {
    outcome = `Accepted ${dayOf(sent.answeredAt)}: it's on ${name}'s to-do list.`
  } else if (sent.state === `done`) {
    outcome = `Done ${dayOf(sent.doneAt)}${sent.doneNote === `` ? `.` : `: "${sent.doneNote.replace(/\s+/g, ` `)}"`}`
  } else if (sent.state === `removed`) {
    outcome = `${name} accepted it, then took it off their to-do list.`
  } else if (sent.state === `declined`) {
    const decliner = sent.answeredBy === `model` ? `${name}'s ROOK` : name
    outcome = `Declined by ${decliner} on ${dayOf(sent.answeredAt)}${sent.declineReason === `` ? `.` : `: "${sent.declineReason}"`}`
  }

  return `[${sent.id}] Asked of ${name} on ${dayOf(sent.createdAt)}: ${describeAsk(sent)}\n  ${outcome}`
}

export default {
  maxNoteLength,
  maxPerDay,
  maxReasonLength,
  recentDays,
  listPeople,
  getPerson,
  setPeople,
  sendRequest,
  getIncoming,
  getSent,
  listToReview,
  listHeld,
  listAnswered,
  listSent,
  countHeld,
  accept,
  decline,
  hold,
  withdraw,
  canPush,
  markPushed,
  deleteOld,
  describeIncoming,
  describeSent,
}
