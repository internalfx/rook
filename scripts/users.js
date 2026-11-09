
// Manages rook's users from the server: adds one, resets a password, makes or unmakes an admin,
// removes one with everything that's theirs, or lists them. Admin → Users does the same in the
// browser; this is for when no admin can log in, such as a lost admin password.
//   bun scripts/users.js
//
// It opens data/rook.db, which is fine while the server is running. A removed user's browsers are
// logged out; a user whose password was reset stays logged in.

import inquirer from 'inquirer'
import users from '../lib/users.js'

const askPassword = async function () {
  const answers = await inquirer.prompt([
    { type: `password`, name: `password`, message: `Password:`, mask: `*` },
    { type: `password`, name: `confirm`, message: `Confirm password:`, mask: `*` },
  ])

  if (answers.password !== answers.confirm) {
    throw new Error(`The passwords don't match.`)
  }

  if (answers.password.length < users.passwordMinLength) {
    throw new Error(`The password needs at least ${users.passwordMinLength} characters.`)
  }

  return answers.password
}

// A user picked from a list, or null when there are none
const pickUser = async function (message) {
  const listed = users.listUsers()

  if (listed.length === 0) {
    console.log(`There are no users.`)
    return null
  }

  const answers = await inquirer.prompt([{
    type: `list`,
    name: `id`,
    message,
    choices: listed.map(function (user) {
      return { name: `${user.name} <${user.email}>`, value: user.id }
    }),
  }])

  return users.getUser(answers.id)
}

const listUsers = function () {
  const listed = users.listUsers()

  if (listed.length === 0) {
    console.log(`There are no users.`)
    return
  }

  for (const user of listed) {
    console.log(`${user.id}. ${user.name} <${user.email}>${user.isAdmin ? `  (admin)` : ``}  (${user.timeZone})`)
  }
}

const addUser = async function () {
  // The first account is the admin's: there'd be no one else to make it one
  const isFirst = users.hasUsers() === false

  if (isFirst) {
    console.log(`There are no users yet, so this one will be an admin.`)
  }

  const questions = [
    { type: `input`, name: `name`, message: `Name:` },
    { type: `input`, name: `email`, message: `Email:` },
  ]

  if (isFirst === false) {
    questions.push({ type: `confirm`, name: `isAdmin`, message: `Admin?`, default: false })
  }

  const answers = await inquirer.prompt(questions)
  const isAdmin = isFirst || answers.isAdmin

  const name = answers.name.trim()
  const email = answers.email.trim()

  if (name === `` || email === ``) {
    throw new Error(`A user needs a name and an email.`)
  }

  if (users.findLogin(email) != null) {
    throw new Error(`There's already a user with the email ${email}.`)
  }

  const password = await askPassword()
  const user = await users.createUser({ name, email, password, isAdmin })

  console.log(`Added ${user.name} <${user.email}>${user.isAdmin ? ` as an admin` : ``}. They log in with that email and password.`)
}

const toggleAdmin = async function () {
  const user = await pickUser(`Whose admin status?`)

  if (user == null) {
    return
  }

  const makeAdmin = user.isAdmin === false

  users.setAdmin(user.id, makeAdmin)

  console.log(`${user.name} <${user.email}> is ${makeAdmin ? `now an admin` : `no longer an admin`}.`)
}

const resetPassword = async function () {
  const user = await pickUser(`Whose password?`)

  if (user == null) {
    return
  }

  const password = await askPassword()
  await users.setPassword(user.id, password)

  console.log(`The password of ${user.name} <${user.email}> was changed.`)
}

const removeUser = async function () {
  const user = await pickUser(`Remove which user?`)

  if (user == null) {
    return
  }

  const answers = await inquirer.prompt([{
    type: `input`,
    name: `confirm`,
    message: `This deletes every chat, memory, task, briefing and notification of ${user.name}'s. Type their email to go on:`,
  }])

  if (answers.confirm.trim().toLowerCase() !== user.email.toLowerCase()) {
    console.log(`Not removed.`)
    return
  }

  users.deleteUser(user.id)

  console.log(`Removed ${user.name} <${user.email}> and everything that was theirs.`)
}

const actions = {
  list: listUsers,
  add: addUser,
  reset: resetPassword,
  admin: toggleAdmin,
  remove: removeUser,
}

const answers = await inquirer.prompt([{
  type: `list`,
  name: `action`,
  message: `What would you like to do?`,
  choices: [
    { name: `List the users`, value: `list` },
    { name: `Add a user`, value: `add` },
    { name: `Reset a user's password`, value: `reset` },
    { name: `Make or unmake an admin`, value: `admin` },
    { name: `Remove a user`, value: `remove` },
  ],
}])

try {
  await actions[answers.action]()
} catch (err) {
  console.log(err.message)
  process.exit(1)
}

process.exit(0)
