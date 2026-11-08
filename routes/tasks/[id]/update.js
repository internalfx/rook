import tasks from '../../../lib/tasks.js'
import { readTaskForm, readReturnTo } from '../../../lib/taskForm.js'

// Form POST from a task's Edit form on the Tasks page
export const POST = async function (ctx) {
  const destination = readReturnTo(ctx.request.body)
  const userId = ctx.state.user.id
  const task = tasks.getTask(userId, ctx.state.params.id)

  if (task == null) {
    ctx.addFlash(`That task no longer exists.`, `error`)
    return ctx.redirect(destination)
  }

  let fields

  try {
    fields = await readTaskForm(ctx.request.body)
  } catch (err) {
    ctx.addFlash(err.message, `error`)
    return ctx.redirect(destination)
  }

  tasks.updateTask(userId, task.id, fields)

  return ctx.redirect(destination)
}
