import taskRequests from '../../lib/taskRequests.js'
import tools from '../../ai-tools/index.js'
import { readDestination } from '../../lib/settingsPages.js'

// Settings → People: the other users on this rook, and for each whether they may send the user
// task requests, and the user's note about them, which the model goes by when it looks at what
// they ask (see lib/taskRequests.js). Everyone starts blocked, and only the user sees what they
// set here. The sidebar lists the page only while there's someone to show and task requests are on.
export const GET = async function (ctx) {
  ctx.body = ctx.nunjucks(`settings/people`, {
    people: taskRequests.listPeople(ctx.state.user),
    maxNoteLength: taskRequests.maxNoteLength,
    isTaskRequestsOn: tools.isTaskRequestsOn(),
  })
}

// Each person has two fields, named for their user id: level-<id> (allow or block) and note-<id>
export const POST = async function (ctx) {
  const user = ctx.state.user
  const body = ctx.request.body ?? {}
  const people = []

  for (const person of taskRequests.listPeople(user)) {
    const level = body[`level-${person.id}`]
    const note = typeof body[`note-${person.id}`] === `string` ? body[`note-${person.id}`].trim() : ``

    // Someone added since the page was loaded isn't on the form, and stays as they are
    if (level == null) {
      people.push({ id: person.id, allowed: person.allowed, note: person.note })
      continue
    }

    if (note.length > taskRequests.maxNoteLength) {
      ctx.addFlash(`The note about ${person.name} is longer than ${taskRequests.maxNoteLength} characters.`, `error`)
      return ctx.redirect(`/settings/people`)
    }

    people.push({ id: person.id, allowed: level === `allow`, note })
  }

  taskRequests.setPeople(user.id, people)

  ctx.addFlash(`People saved.`, `success`)

  // Where to go once saved, when saving from the "Save your changes?" dialog
  const returnTo = typeof body.returnTo === `string` ? body.returnTo : null

  return ctx.redirect(readDestination(returnTo, `/settings/people`))
}
