import joi from '../../../services/joi.js'
import tasks from '../../../services/tasks.js'

// Form POST from an open task's completion form, with `done` true and an optional completion
// note, or from a done task's checkbox, with `done` false to put it back on the list
export const POST = async function (ctx) {
  let args

  try {
    args = await joi.object({
      done: joi.boolean().required(),
      doneNote: joi.string().trim().max(tasks.maxDoneNoteLength),
    }).validateAsync(ctx.request.body)
  } catch (err) {
    ctx.addFlash(err.message, `error`)
    return ctx.redirect(`/tasks`)
  }

  // An empty note comes through as null, and means no note; putting it back removes the note
  const task = tasks.setDone(ctx.state.params.id, args.done, args.done ? (args.doneNote ?? ``) : null)

  if (task == null) {
    ctx.addFlash(`That task no longer exists.`, `error`)
    return ctx.redirect(`/tasks`)
  }

  return ctx.redirect(`/tasks`)
}
