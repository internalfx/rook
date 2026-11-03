import cuid from 'cuid'
import db from './db.js'
import { rankByMeaning } from './embeddings.js'

// Tasks: things the owner needs to get done. Open tasks are sorted most important first: by
// priority, then by due date (soonest first, undated last), then oldest first. The model can
// find them by keyword (searchTasks) or by meaning (searchByMeaning). A done task can have a
// completion note (doneNote): how it went, or why it no longer applied.

export const priorities = [`high`, `normal`, `low`]

// The longest completion note kept, from the Tasks page or the model
export const maxDoneNoteLength = 2000

const taskColumns = `tasks.id, tasks.title, tasks.notes, tasks.priority, tasks.dueDate, tasks.doneAt, tasks.doneNote, tasks.chatId, tasks.createdAt, tasks.updatedAt`

const openOrder = `
  CASE tasks.priority WHEN 'high' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END,
  tasks.dueDate IS NULL, tasks.dueDate, tasks.createdAt
`

const selectOpen = db.query(`
  SELECT ${taskColumns}, chats.title AS chatTitle
  FROM tasks LEFT JOIN chats ON chats.id = tasks.chatId
  WHERE tasks.doneAt IS NULL ORDER BY ${openOrder}
`)
const selectDone = db.query(`
  SELECT ${taskColumns}, chats.title AS chatTitle
  FROM tasks LEFT JOIN chats ON chats.id = tasks.chatId
  WHERE tasks.doneAt IS NOT NULL ORDER BY tasks.doneAt DESC LIMIT $limit
`)
const selectDoneSince = db.query(`
  SELECT ${taskColumns} FROM tasks WHERE tasks.doneAt > $since ORDER BY tasks.doneAt DESC LIMIT $limit
`)
const countDoneRows = db.query(`SELECT COUNT(*) AS count FROM tasks WHERE doneAt IS NOT NULL`)
const countDueRows = db.query(`SELECT COUNT(*) AS count FROM tasks WHERE doneAt IS NULL AND dueDate <= $today`)
const selectTask = db.query(`SELECT ${taskColumns} FROM tasks WHERE id = $id`)
const insertTask = db.query(`
  INSERT INTO tasks (id, title, notes, priority, dueDate, chatId, createdAt, updatedAt)
  VALUES ($id, $title, $notes, $priority, $dueDate, $chatId, $now, $now)
`)
// A new title or notes needs a new vector, so it's cleared until the next search
const updateTaskRow = db.query(`
  UPDATE tasks SET title = $title, notes = $notes, priority = $priority, dueDate = $dueDate, updatedAt = $now,
    embedding = CASE WHEN title = $title AND notes = $notes THEN embedding ELSE NULL END,
    embeddingModel = CASE WHEN title = $title AND notes = $notes THEN embeddingModel ELSE NULL END
  WHERE id = $id
`)
const selectSearchCandidates = db.query(`
  SELECT ${taskColumns}, chats.title AS chatTitle, tasks.embedding, tasks.embeddingModel
  FROM tasks LEFT JOIN chats ON chats.id = tasks.chatId
  WHERE tasks.doneAt IS NULL OR $includeDone = 1
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
  WHERE id = $id
`)
const deleteTaskRow = db.query(`DELETE FROM tasks WHERE id = $id`)

// "2026-11-01": a day in the server's time zone, which is the owner's
export const toDay = function (date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, `0`)
  const day = String(date.getDate()).padStart(2, `0`)

  return `${year}-${month}-${day}`
}

export const today = function () {
  return toDay(new Date())
}

// Whether `text` is a real day written as YYYY-MM-DD (so not 2026-02-30)
export const isValidDay = function (text) {
  if (typeof text !== `string` || /^\d{4}-\d{2}-\d{2}$/.test(text) === false) {
    return false
  }

  const [year, month, day] = text.split(`-`).map(Number)
  const date = new Date(year, month - 1, day)

  return toDay(date) === text
}

// For an open task with a due date: `overdue`, `today` or `tomorrow`, or null when it's later or
// has no date. Done tasks are never due.
export const dueState = function (task) {
  if (task.dueDate == null || task.doneAt != null) {
    return null
  }

  const now = new Date()
  const todayText = toDay(now)
  const tomorrowText = toDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1))

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
// "[id] Book the dentist (high priority; due 2026-11-03, tomorrow)\n  Notes: …"
export const describeForModel = function (task) {
  const details = []

  if (task.priority !== `normal`) {
    details.push(`${task.priority} priority`)
  }

  if (task.dueDate != null) {
    const state = dueState(task)
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

// The tasks still to do, most important first; each has the title of the chat it was added in
// (chatTitle), if any
export const listOpen = function () {
  return selectOpen.all()
}

// The tasks done most recently, newest first
export const listDone = function (limit) {
  return selectDone.all({ limit })
}

// The tasks done after `since` (an ISO date), newest first
export const listDoneSince = function (since, limit) {
  return selectDoneSince.all({ since, limit })
}

export const countDone = function () {
  const row = countDoneRows.get()
  return row.count
}

// Open tasks due today or earlier, for the badge on the Tasks nav item
export const countDue = function () {
  const row = countDueRows.get({ today: today() })
  return row.count
}

export const getTask = function (id) {
  return selectTask.get({ id }) ?? null
}

// `chatId` is the chat the model added it in, or null when the owner added it
export const createTask = function ({ title, notes = ``, priority = `normal`, dueDate = null, chatId = null }) {
  const id = cuid()
  const now = new Date().toISOString()

  insertTask.run({ id, title, notes, priority, dueDate, chatId, now })

  return getTask(id)
}

// Returns the task as it is now, or null when there's no task with that id
export const updateTask = function (id, { title, notes, priority, dueDate }) {
  const now = new Date().toISOString()

  updateTaskRow.run({ id, title, notes, priority, dueDate, now })

  return getTask(id)
}

// Marks the task done, or still to do when `done` is false, which clears its completion note.
// Marking a done task done again keeps when it was first done. `note` is the completion note:
// a string replaces it (an empty one removes it), null keeps the one it has.
export const setDone = function (id, done, note = null) {
  const task = getTask(id)

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

  updateDone.run({ id, doneAt, doneNote, now })

  return getTask(id)
}

export const deleteTask = function (id) {
  deleteTaskRow.run({ id })
}

// Tasks whose title, notes or completion note contain the words in `query`, those with the most
// of the words first; ties keep the list's order (open before done, most important first)
export const searchTasks = function ({ query, includeDone = false, limit = 20 }) {
  const words = query.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(function (word) {
    return word.length >= 2
  })

  let candidates = listOpen()

  if (includeDone) {
    candidates = [...candidates, ...listDone(200)]
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
export const searchByMeaning = async function ({ query, model, includeDone = false, limit = 5, signal }) {
  const rows = selectSearchCandidates.all({ includeDone: includeDone ? 1 : 0 })

  const ranked = await rankByMeaning({
    rows,
    query,
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
  searchTasks,
  searchByMeaning,
}
