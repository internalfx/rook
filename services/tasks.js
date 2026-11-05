import cuid from 'cuid'
import dayjs from 'dayjs'
import utc from 'dayjs/plugin/utc'
import timezone from 'dayjs/plugin/timezone'
import prompts from '../prompts.js'
import db from './db.js'
import { rankByMeaning } from './embeddings.js'

dayjs.extend(utc)
dayjs.extend(timezone)

// Tasks: things a user needs to get done, each user's own (userId). Open tasks are sorted
// soonest due first: by due
// date (overdue first, undated last), then by priority, then oldest first. The model can
// find them by keyword (searchTasks) or by meaning (searchByMeaning). A done task can have a
// completion note (doneNote): how it went, or why it no longer applied. Done tasks are deleted
// doneKeptDays after they're done (deleteOldDone, run hourly by services/cron.js).

export const priorities = [`high`, `normal`, `low`]

// The longest completion note kept, from the Tasks page or the model
export const maxDoneNoteLength = 2000

// How long a done task is kept, in days, counted from when it was done
export const doneKeptDays = 30

const taskColumns = `tasks.id, tasks.title, tasks.notes, tasks.priority, tasks.dueDate, tasks.doneAt, tasks.doneNote, tasks.chatId, tasks.createdAt, tasks.updatedAt`

const openOrder = `
  tasks.dueDate IS NULL, tasks.dueDate,
  CASE tasks.priority WHEN 'high' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END,
  tasks.createdAt
`

const selectOpen = db.query(`
  SELECT ${taskColumns}, chats.title AS chatTitle
  FROM tasks LEFT JOIN chats ON chats.id = tasks.chatId
  WHERE tasks.userId = $userId AND tasks.doneAt IS NULL ORDER BY ${openOrder}
`)
const selectDone = db.query(`
  SELECT ${taskColumns}, chats.title AS chatTitle
  FROM tasks LEFT JOIN chats ON chats.id = tasks.chatId
  WHERE tasks.userId = $userId AND tasks.doneAt IS NOT NULL ORDER BY tasks.doneAt DESC LIMIT $limit
`)
const selectDoneSince = db.query(`
  SELECT ${taskColumns} FROM tasks
  WHERE tasks.userId = $userId AND tasks.doneAt > $since ORDER BY tasks.doneAt DESC LIMIT $limit
`)
const countDoneRows = db.query(`SELECT COUNT(*) AS count FROM tasks WHERE userId = $userId AND doneAt IS NOT NULL`)
const countDueRows = db.query(`
  SELECT COUNT(*) AS count FROM tasks WHERE userId = $userId AND doneAt IS NULL AND dueDate <= $today
`)
const selectTask = db.query(`SELECT ${taskColumns} FROM tasks WHERE id = $id AND userId = $userId`)
const insertTask = db.query(`
  INSERT INTO tasks (id, userId, title, notes, priority, dueDate, chatId, createdAt, updatedAt)
  VALUES ($id, $userId, $title, $notes, $priority, $dueDate, $chatId, $now, $now)
`)
// A new title or notes needs a new vector, so it's cleared until the next search
const updateTaskRow = db.query(`
  UPDATE tasks SET title = $title, notes = $notes, priority = $priority, dueDate = $dueDate, updatedAt = $now,
    embedding = CASE WHEN title = $title AND notes = $notes THEN embedding ELSE NULL END,
    embeddingModel = CASE WHEN title = $title AND notes = $notes THEN embeddingModel ELSE NULL END
  WHERE id = $id AND userId = $userId
`)
const selectSearchCandidates = db.query(`
  SELECT ${taskColumns}, chats.title AS chatTitle, tasks.embedding, tasks.embeddingModel
  FROM tasks LEFT JOIN chats ON chats.id = tasks.chatId
  WHERE tasks.userId = $userId AND (tasks.doneAt IS NULL OR $includeDone = 1)
  ORDER BY tasks.doneAt IS NOT NULL, ${openOrder}
`)
const updateEmbedding = db.query(`
  UPDATE tasks SET embedding = $embedding, embeddingModel = $embeddingModel WHERE id = $id
`)
// The completion note is searched too, so a new one clears the vector, as a new title does
const updateDone = db.query(`
  UPDATE tasks SET doneAt = $doneAt, doneNote = $doneNote, updatedAt = $now,
    embedding = CASE WHEN doneNote = $doneNote THEN embedding ELSE NULL END,
    embeddingModel = CASE WHEN doneNote = $doneNote THEN embeddingModel ELSE NULL END
  WHERE id = $id AND userId = $userId
`)
const deleteTaskRow = db.query(`DELETE FROM tasks WHERE id = $id AND userId = $userId`)
const deleteOldDoneRows = db.query(`DELETE FROM tasks WHERE doneAt IS NOT NULL AND doneAt < $before`)

// "2026-11-01": the day `date` falls on in `zone`, the user's time zone (en-CA writes dates that
// way)
export const toDay = function (date, zone) {
  return new Intl.DateTimeFormat(`en-CA`, { timeZone: zone, year: `numeric`, month: `2-digit`, day: `2-digit` }).format(date)
}

// Today in the user's time zone
export const today = function (zone) {
  return toDay(new Date(), zone)
}

// Whether `text` is a real day written as YYYY-MM-DD (so not 2026-02-30)
export const isValidDay = function (text) {
  if (typeof text !== `string` || /^\d{4}-\d{2}-\d{2}$/.test(text) === false) {
    return false
  }

  const [year, month, day] = text.split(`-`).map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))

  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
}

// For an open task with a due date: `overdue`, `today` or `tomorrow` in `zone`, the user's time
// zone, or null when it's later or has no date. Done tasks are never due.
export const dueState = function (task, zone) {
  if (task.dueDate == null || task.doneAt != null) {
    return null
  }

  const todayText = today(zone)
  const tomorrowText = dayjs().tz(zone).add(1, `day`).format(`YYYY-MM-DD`)

  if (task.dueDate < todayText) {
    return `overdue`
  }

  if (task.dueDate === todayText) {
    return `today`
  }

  if (task.dueDate === tomorrowText) {
    return `tomorrow`
  }

  return null
}

// A task as the model is told about it, e.g.
// "[id] Book the dentist (high priority; due 2026-11-03, tomorrow)\n  Notes: …", "tomorrow" being
// in `zone`, the user's time zone
export const describeForModel = function (task, zone) {
  const details = []

  if (task.priority !== `normal`) {
    details.push(`${task.priority} priority`)
  }

  if (task.dueDate != null) {
    const state = dueState(task, zone)
    details.push(state == null ? `due ${task.dueDate}` : `due ${task.dueDate}, ${state}`)
  }

  if (task.doneAt != null) {
    details.push(`done ${task.doneAt.slice(0, 10)}`)
  }

  let text = `[${task.id}] ${task.title}`

  if (details.length > 0) {
    text = `${text} (${details.join(`; `)})`
  }

  if (task.notes !== ``) {
    text = `${text}\n  Notes: ${task.notes.replace(/\s+/g, ` `)}`
  }

  if (task.doneNote !== ``) {
    text = `${text}\n  Completion note: ${task.doneNote.replace(/\s+/g, ` `)}`
  }

  return text
}

// The tasks still to do, soonest due first; each has the title of the chat it was added in
// (chatTitle), if any
export const listOpen = function (userId) {
  return selectOpen.all({ userId })
}

// The tasks done most recently, newest first
export const listDone = function (userId, limit) {
  return selectDone.all({ userId, limit })
}

// The tasks done after `since` (an ISO date), newest first
export const listDoneSince = function (userId, since, limit) {
  return selectDoneSince.all({ userId, since, limit })
}

export const countDone = function (userId) {
  const row = countDoneRows.get({ userId })
  return row.count
}

// The user's open tasks due today (in `zone`, their time zone) or earlier, for the badge on the
// Tasks nav item
export const countDue = function (userId, zone) {
  const row = countDueRows.get({ userId, today: today(zone) })
  return row.count
}

// The user's task with that id, or null: another user's reads as no task
export const getTask = function (userId, id) {
  return selectTask.get({ userId, id }) ?? null
}

// `chatId` is the chat the model added it in, or null when the user added it
export const createTask = function ({ userId, title, notes = ``, priority = `normal`, dueDate = null, chatId = null }) {
  const id = cuid()
  const now = new Date().toISOString()

  insertTask.run({ id, userId, title, notes, priority, dueDate, chatId, now })

  return getTask(userId, id)
}

// Returns the task as it is now, or null when the user has no task with that id
export const updateTask = function (userId, id, { title, notes, priority, dueDate }) {
  const now = new Date().toISOString()

  updateTaskRow.run({ userId, id, title, notes, priority, dueDate, now })

  return getTask(userId, id)
}

// Marks the task done, or still to do when `done` is false, which clears its completion note.
// Marking a done task done again keeps when it was first done. `note` is the completion note:
// a string replaces it (an empty one removes it), null keeps the one it has.
export const setDone = function (userId, id, done, note = null) {
  const task = getTask(userId, id)

  if (task == null) {
    return null
  }

  const now = new Date().toISOString()
  let doneAt = null
  let doneNote = ``

  if (done === true) {
    doneAt = task.doneAt ?? now
    doneNote = note ?? task.doneNote
  }

  updateDone.run({ userId, id, doneAt, doneNote, now })

  return getTask(userId, id)
}

export const deleteTask = function (userId, id) {
  deleteTaskRow.run({ userId, id })
}

// Deletes every user's tasks done more than doneKeptDays ago, and returns how many went. Open
// tasks are never touched: putting a done task back on the list clears its doneAt.
export const deleteOldDone = function () {
  const keptMs = 1000 * 60 * 60 * 24 * doneKeptDays
  const before = new Date(Date.now() - keptMs).toISOString()

  const result = deleteOldDoneRows.run({ before })

  return result.changes
}

// Tasks whose title, notes or completion note contain the words in `query`, those with the most
// of the words first; ties keep the list's order (open before done, soonest due first)
export const searchTasks = function ({ userId, query, includeDone = false, limit = 20 }) {
  const words = query.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(function (word) {
    return word.length >= 2
  })

  let candidates = listOpen(userId)

  if (includeDone) {
    candidates = [...candidates, ...listDone(userId, 200)]
  }

  const scored = []

  for (const task of candidates) {
    const text = `${task.title} ${task.notes} ${task.doneNote}`.toLowerCase()

    let score = 0

    for (const word of words) {
      if (text.includes(word)) {
        score += 1
      }
    }

    if (score > 0) {
      scored.push({ task, score })
    }
  }

  // Array sort is stable, so equal scores stay in the list's order
  scored.sort(function (a, b) {
    return b.score - a.score
  })

  const found = scored.slice(0, limit).map(function (entry) {
    return entry.task
  })

  return found
}

// The tasks closest in meaning to `query` (by their title, notes and completion note), closest
// first, each with its similarity as `score` and the title of the chat it was added in
// (chatTitle), if any. Asks Lemonade, so it can be slow or fail; see services/embeddings.js.
export const searchByMeaning = async function ({ userId, query, model, includeDone = false, limit = 5, signal }) {
  const rows = selectSearchCandidates.all({ userId, includeDone: includeDone ? 1 : 0 })

  const ranked = await rankByMeaning({
    rows,
    query,
    instruction: prompts.embeddings.tasks,
    model,
    signal,
    textOf: function (row) {
      const text = `${row.title}\n${row.notes}`

      // Only done tasks have one, so the others embed as they did before it existed
      if (row.doneNote === ``) {
        return text
      }

      return `${text}\n${row.doneNote}`
    },
    saveVector: function (row, embedding) {
      updateEmbedding.run({ id: row.id, embedding, embeddingModel: model })
    },
  })

  const closest = ranked.slice(0, limit).map(function ({ row, score }) {
    const { embedding, embeddingModel, ...task } = row

    return { ...task, score }
  })

  return closest
}

export default {
  priorities,
  maxDoneNoteLength,
  doneKeptDays,
  toDay,
  today,
  isValidDay,
  dueState,
  describeForModel,
  listOpen,
  listDone,
  listDoneSince,
  countDone,
  countDue,
  getTask,
  createTask,
  updateTask,
  setDone,
  deleteTask,
  deleteOldDone,
  searchTasks,
  searchByMeaning,
}
