
// Manages rook's users: adds one, resets a password, removes one with everything that's theirs,
// or lists them. There's no sign-up page, so this is how accounts are made.
//   bun scripts/users.js
//
// It opens data/rook.db, which is fine while the server is running. A removed user's browsers are
// logged out; a user whose password was reset stays logged in.

import inquirer from 'inquirer'
import users from '../services/users.js'

const askPassword = async function () {
  const answers = await inquirer.prompt([
    { type: `password`, name: `password`, message: `Password:`, mask: `*` },
    { type: `password`, name: `confirm`, message: `Confirm password:`, mask: `*` },
  ])

  if (answers.password !== answers.confirm) {
    throw new Error(`The passwords don't match.`)
  }

  if (answers.password.length === 0) {
    throw new Error(`The password can't be empty.`)
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
    console.log(`${user.id}. ${user.name} <${user.email}>  (${user.timeZone})`)
  }
}

const addUser = async function () {
  const answers = await inquirer.prompt([
    { type: `input`, name: `name`, message: `Name:` },
    { type: `input`, name: `email`, message: `Email:` },
  ])

  const name = answers.name.trim()
  const email = answers.email.trim()

  if (name === `` || email === ``) {
    throw new Error(`A user needs a name and an email.`)
  }

  if (users.findLogin(email) != null) {
    throw new Error(`There's already a user with the email ${email}.`)
  }

  const password = await askPassword()
  const user = await users.createUser({ name, email, password })

  console.log(`Added ${user.name} <${user.email}>. They log in with that email and password.`)
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
