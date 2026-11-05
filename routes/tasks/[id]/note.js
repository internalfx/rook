import joi from '../../../services/joi.js'
import tasks from '../../../services/tasks.js'
import { readReturnTo } from '../../../lib/taskForm.js'

// Form POST from a done task's note form: sets its completion note, or removes it when it's empty
export const POST = async function (ctx) {
  const destination = readReturnTo(ctx.request.body)
  const userId = ctx.state.user.id
  const task = tasks.getTask(userId, ctx.state.params.id)

  if (task == null) {
    ctx.addFlash(`That task no longer exists.`, `error`)
    return ctx.redirect(destination)
  }

  if (task.doneAt == null) {
    ctx.addFlash(`That task isn't done, so it can't have a completion note.`, `error`)
    return ctx.redirect(destination)
  }

  let args

  try {
    args = await joi.object({
      doneNote: joi.string().trim().max(tasks.maxDoneNoteLength),
      returnTo: joi.string(),
    }).validateAsync(ctx.request.body)
  } catch (err) {
    ctx.addFlash(err.message, `error`)
    return ctx.redirect(destination)
  }

  // An empty note comes through as null
  tasks.setDone(userId, task.id, true, args.doneNote ?? ``)

  return ctx.redirect(destination)
}
