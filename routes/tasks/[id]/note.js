import joi from '../../../services/joi.js'
import tasks from '../../../services/tasks.js'

// Form POST from a done task's note form: sets its completion note, or removes it when it's empty
export const POST = async function (ctx) {
  const task = tasks.getTask(ctx.state.params.id)

  if (task == null) {
    ctx.addFlash(`That task no longer exists.`, `error`)
    return ctx.redirect(`/tasks`)
  }

  if (task.doneAt == null) {
    ctx.addFlash(`That task isn't done, so it can't have a completion note.`, `error`)
    return ctx.redirect(`/tasks`)
  }

  let args

  try {
    args = await joi.object({
      doneNote: joi.string().trim().max(tasks.maxDoneNoteLength),
    }).validateAsync(ctx.request.body)
  } catch (err) {
    ctx.addFlash(err.message, `error`)
    return ctx.redirect(`/tasks`)
  }

  // An empty note comes through as null
  tasks.setDone(task.id, true, args.doneNote ?? ``)

  return ctx.redirect(`/tasks`)
}
