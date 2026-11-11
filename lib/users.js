import Bun from 'bun'
import db from './db.js'
import chats from './chats.js'
import settings from './settings.js'

// Everyone who can log in. Each user's chats, memories, tasks, briefings and notifications are
// theirs alone: every such table has a userId, and chat messages belong to their chat. Accounts
// are made, changed and removed on Admin → Users, or with scripts/users.js on the server; there's
// no sign-up page, and the first account, made by the setup pages, is an admin's. A password an
// admin picks for someone else on Admin → Users is temporary: mustChangePassword is set, and that
// user chooses their own the next time they log in (middleware/auth.js).

// Every user's time zone until they choose one in Settings
export const serverTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone

// The one rule for passwords, wherever one is set
export const passwordMinLength = 10

const userColumns = `id, email, name, isAdmin, mustChangePassword, createdAt, updatedAt`

const selectUser = db.query(`SELECT ${userColumns} FROM users WHERE id = $id`)
const selectLogin = db.query(`SELECT id, passhash FROM users WHERE email = $email`)
const selectUsers = db.query(`SELECT ${userColumns} FROM users ORDER BY id`)
const anyUser = db.query(`SELECT EXISTS (SELECT 1 FROM users) AS found`)
const countUserRows = db.query(`SELECT COUNT(*) AS count FROM users`)
const selectPasshash = db.query(`SELECT passhash FROM users WHERE id = $id`)
const insertUser = db.query(`
  INSERT INTO users (email, name, passhash, isAdmin, mustChangePassword, createdAt, updatedAt)
  VALUES ($email, $name, $passhash, $isAdmin, $mustChangePassword, $now, $now)
`)
const updatePasshash = db.query(`
  UPDATE users SET passhash = $passhash, mustChangePassword = $mustChangePassword, updatedAt = $now WHERE id = $id
`)
const updateNameEmail = db.query(`UPDATE users SET name = $name, email = $email, updatedAt = $now WHERE id = $id`)
const updateAdmin = db.query(`UPDATE users SET isAdmin = $isAdmin, updatedAt = $now WHERE id = $id`)
const selectChatIds = db.query(`SELECT id FROM chats WHERE userId = $userId`)
const deleteUserRow = db.query(`DELETE FROM users WHERE id = $id`)
// A session's data is JSON, with the user's id in it once they've logged in
const deleteUserSessions = db.query(`DELETE FROM sessions WHERE json_extract(data, '$.userId') = $userId`)

// A user as the rest of rook sees them (ctx.state.user): no password hash, isAdmin and
// mustChangePassword as booleans (SQLite stores 1 or 0), and their time zone
const toUser = function (row) {
  return {
    ...row,
    isAdmin: row.isAdmin === 1,
    mustChangePassword: row.mustChangePassword === 1,
    timeZone: settings.get(row.id, `timeZone`) ?? serverTimeZone,
  }
}

export const getUser = function (id) {
  const row = selectUser.get({ id })

  if (row == null) {
    return null
  }

  return toUser(row)
}

// For logging in: { id, passhash }, or null. Emails compare without case (see the migration).
export const findLogin = function (email) {
  return selectLogin.get({ email }) ?? null
}

// Whether anyone has an account yet: until someone does, visitors are sent to the setup pages
export const hasUsers = function () {
  return anyUser.get().found === 1
}

// How many people have an account
export const countUsers = function () {
  return countUserRows.get().count
}

export const listUsers = function () {
  return selectUsers.all().map(toUser)
}

// mustChangePassword is for a password someone else picked for them (Admin → Users → Add user):
// they choose their own the first time they log in
export const createUser = async function ({ name, email, password, isAdmin = false, mustChangePassword = false }) {
  const passhash = await Bun.password.hash(password)
  const now = new Date().toISOString()

  const result = insertUser.run({
    email,
    name,
    passhash,
    isAdmin: isAdmin ? 1 : 0,
    mustChangePassword: mustChangePassword ? 1 : 0,
    now,
  })

  return getUser(result.lastInsertRowid)
}

// A duplicate email throws SQLite's UNIQUE error; the caller says so in its own words
export const updateUser = function (id, { name, email }) {
  updateNameEmail.run({ id, name, email, now: new Date().toISOString() })

  return getUser(id)
}

export const setAdmin = function (id, isAdmin) {
  updateAdmin.run({ id, isAdmin: isAdmin ? 1 : 0, now: new Date().toISOString() })
}

// A password the user chose themselves (or one set from the server with scripts/users.js): it's
// theirs to keep, so a change an admin was waiting on is done. Their browsers stay logged in.
export const setPassword = async function (id, password) {
  const passhash = await Bun.password.hash(password)

  updatePasshash.run({ id, passhash, mustChangePassword: 0, now: new Date().toISOString() })
}

// A password an admin picked for someone else: their browsers are logged out, and after logging
// in with it they're made to choose their own
export const setTemporaryPassword = async function (id, password) {
  const passhash = await Bun.password.hash(password)
  const now = new Date().toISOString()

  const reset = db.transaction(function () {
    updatePasshash.run({ id, passhash, mustChangePassword: 1, now })
    deleteUserSessions.run({ userId: id })
  })

  reset()
}

// Whether `password` is the user's, for changing it
export const checkPassword = async function (id, password) {
  const row = selectPasshash.get({ id })

  if (row == null) {
    return false
  }

  try {
    return await Bun.password.verify(password, row.passhash)
  } catch (err) {
    return false
  }
}

// Deletes the user and everything that's theirs: each chat goes through chats.deleteChat, so its
// image files go too; the rest cascades from the user row; and their sessions are deleted, so
// their browsers are logged out
export const deleteUser = function (id) {
  const remove = db.transaction(function () {
    for (const row of selectChatIds.all({ userId: id })) {
      chats.deleteChat(row.id)
    }

    deleteUserRow.run({ id })
    deleteUserSessions.run({ userId: id })
  })

  remove()
}

export default {
  serverTimeZone,
  passwordMinLength,
  getUser,
  findLogin,
  hasUsers,
  countUsers,
  listUsers,
  createUser,
  updateUser,
  setPassword,
  setTemporaryPassword,
  setAdmin,
  checkPassword,
  deleteUser,
}
