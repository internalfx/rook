import fs from 'node:fs'
import path from 'node:path'
import config from '../configure.js'
import db from './db.js'
import images from './images.js'

// How much rook holds, for the Admin page: what each user has, and what it all takes on disk

// One row per user with something in the table, as { userId, count }
const countChats = db.query(`SELECT userId, COUNT(*) AS count FROM chats GROUP BY userId`)
const countMessages = db.query(`
  SELECT chats.userId, COUNT(*) AS count FROM chatMessages JOIN chats ON chats.id = chatMessages.chatId
  GROUP BY chats.userId
`)
const countMemories = db.query(`SELECT userId, COUNT(*) AS count FROM memories GROUP BY userId`)
const countOpenTasks = db.query(`SELECT userId, COUNT(*) AS count FROM tasks WHERE doneAt IS NULL GROUP BY userId`)
const countDoneTasks = db.query(`SELECT userId, COUNT(*) AS count FROM tasks WHERE doneAt IS NOT NULL GROUP BY userId`)
const countBriefings = db.query(`
  SELECT userId, COUNT(*) AS count, MAX(startedAt) AS lastStartedAt FROM briefings GROUP BY userId
`)
const countNotifications = db.query(`SELECT userId, COUNT(*) AS count FROM notifications GROUP BY userId`)
const countWaiting = db.query(`
  SELECT userId, COUNT(*) AS count FROM scheduledNotifications WHERE status = 'waiting' GROUP BY userId
`)

const emptyCounts = function () {
  return { chats: 0, messages: 0, memories: 0, openTasks: 0, doneTasks: 0, briefings: 0, lastBriefingAt: null, notifications: 0, waiting: 0 }
}

// Each user's counts, as a Map from user id to { chats, messages, memories, openTasks, doneTasks,
// briefings, lastBriefingAt, notifications, waiting }. A user with nothing isn't in it (see
// countsFor).
export const countByUser = function () {
  const byUser = new Map()

  const countsFor = function (userId) {
    if (byUser.has(userId) === false) {
      byUser.set(userId, emptyCounts())
    }

    return byUser.get(userId)
  }

  const fill = function (query, key) {
    for (const row of query.all()) {
      countsFor(row.userId)[key] = row.count
    }
  }

  fill(countChats, `chats`)
  fill(countMessages, `messages`)
  fill(countMemories, `memories`)
  fill(countOpenTasks, `openTasks`)
  fill(countDoneTasks, `doneTasks`)
  fill(countNotifications, `notifications`)
  fill(countWaiting, `waiting`)

  for (const row of countBriefings.all()) {
    const counts = countsFor(row.userId)
    counts.briefings = row.count
    counts.lastBriefingAt = row.lastStartedAt
  }

  return byUser
}

// The counts for one user, zeros when they have nothing
export const countsFor = function (byUser, userId) {
  return byUser.get(userId) ?? emptyCounts()
}

// A file's size, or 0 when it isn't there (the WAL and shared-memory files come and go)
const sizeOf = function (filePath) {
  try {
    return fs.statSync(filePath).size
  } catch (err) {
    return 0
  }
}

// What's on disk: { databaseBytes, imageCount, imageBytes }
export const describeStorage = function () {
  const dbPath = path.join(config.dataDir, `rook.db`)
  const databaseBytes = sizeOf(dbPath) + sizeOf(`${dbPath}-wal`)

  let imageCount = 0
  let imageBytes = 0

  for (const fileName of fs.readdirSync(images.imagesDir)) {
    imageCount += 1
    imageBytes += sizeOf(path.join(images.imagesDir, fileName))
  }

  return { databaseBytes, imageCount, imageBytes }
}

export default {
  countByUser,
  countsFor,
  describeStorage,
}
