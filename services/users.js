import Bun from 'bun'
import config from '../configure.js'
import db from './db.js'
import chats from './chats.js'
import settings from './settings.js'

// Everyone who can log in. Each user's chats, memories, tasks, briefings and notifications are
// theirs alone: every such table has a userId, and chat messages belong to their chat. Accounts
// are made, reset and removed with scripts/users.js; there's no sign-up page and no admin.
//
// User 1 is the owner from config.js: migrations/017-users.sql makes it empty, and the first
// start fills it in from config.owner (see setUpOwner), after which that block can go.

// Every user's time zone until they choose one in Settings
export const serverTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone

const userColumns = `id, email, name, createdAt, updatedAt`

const selectUser = db.query(`SELECT ${userColumns} FROM users WHERE id = $id`)
const selectLogin = db.query(`SELECT id, passhash FROM users WHERE email = $email`)
const selectUsers = db.query(`SELECT ${userColumns} FROM users ORDER BY id`)
const selectPasshash = db.query(`SELECT passhash FROM users WHERE id = $id`)
const insertUser = db.query(`
  INSERT INTO users (email, name, passhash, createdAt, updatedAt)
  VALUES ($email, $name, $passhash, $now, $now)
`)
const updateUserRow = db.query(`
  UPDATE users SET email = $email, name = $name, passhash = $passhash, updatedAt = $now WHERE id = $id
`)
const updatePasshash = db.query(`UPDATE users SET passhash = $passhash, updatedAt = $now WHERE id = $id`)
const selectChatIds = db.query(`SELECT id FROM chats WHERE userId = $userId`)
const deleteUserRow = db.query(`DELETE FROM users WHERE id = $id`)
// A session's data is JSON, with the user's id in it once they've logged in
const deleteUserSessions = db.query(`DELETE FROM sessions WHERE json_extract(data, '$.userId') = $userId`)

// A user as the rest of rook sees them (ctx.state.user): no password hash, and their time zone
const toUser = function (row) {
  return { ...row, timeZone: settings.get(row.id, `timeZone`) ?? serverTimeZone }
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

export const listUsers = function () {
  return selectUsers.all().map(toUser)
}

export const createUser = async function ({ name, email, password }) {
  const passhash = await Bun.password.hash(password)
  const now = new Date().toISOString()

  const result = insertUser.run({ email, name, passhash, now })

  return getUser(result.lastInsertRowid)
}

export const setPassword = async function (id, password) {
  const passhash = await Bun.password.hash(password)

  updatePasshash.run({ id, passhash, now: new Date().toISOString() })
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

// Fills in user 1 from config.owner on the first start after the users table is made, and gives
// it the Slack token from config.slack while it has none. Once this has run, both blocks can be
// removed from config.js.
const setUpOwner = function () {
  const row = selectPasshash.get({ id: 1 })

  if (row == null) {
    return
  }

  const owner = config.owner ?? {}

  if (row.passhash === `` && typeof owner.passhash === `string` && typeof owner.email === `string`) {
    updateUserRow.run({ id: 1, email: owner.email, name: owner.name ?? owner.email, passhash: owner.passhash, now: new Date().toISOString() })
    console.log(`USER 1 SET UP FROM config.owner - ${owner.email}`)
  }

  const slackToken = config.slack?.oauthToken

  if (typeof slackToken === `string` && slackToken !== `` && settings.get(1, `slackToken`) == null) {
    settings.set(1, `slackToken`, slackToken)
    console.log(`USER 1 GIVEN THE SLACK TOKEN FROM config.slack`)
  }
}

setUpOwner()

export default {
  serverTimeZone,
  getUser,
  findLogin,
  listUsers,
  createUser,
  setPassword,
  checkPassword,
  deleteUser,
}
