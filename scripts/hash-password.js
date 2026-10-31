
// Prints a password hash for config.owner.passhash
//   bun scripts/hash-password.js

import Bun from 'bun'
import inquirer from 'inquirer'

const answers = await inquirer.prompt([
  { type: `password`, name: `password`, message: `Password:`, mask: `*` },
  { type: `password`, name: `confirm`, message: `Confirm password:`, mask: `*` },
])

if (answers.password !== answers.confirm) {
  console.log(`Passwords do not match.`)
  process.exit(1)
}

if (answers.password.length === 0) {
  console.log(`Password can't be empty.`)
  process.exit(1)
}

const passhash = await Bun.password.hash(answers.password)

console.log(``)
console.log(`Add this to the owner block in config.js:`)
console.log(``)
console.log(`  passhash: \`${passhash}\`,`)
