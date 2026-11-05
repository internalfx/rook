import tasks from '../../../services/tasks.js'
import { readReturnTo } from '../../../lib/taskForm.js'

// Form POST from a task's Delete confirmation. Only the user can delete tasks; the chat model
// has no tool for it.
export const POST = async function (ctx) {
  const destination = readReturnTo(ctx.request.body)

  tasks.deleteTask(ctx.state.user.id, ctx.state.params.id)

  ctx.addFlash(`Task deleted.`, `success`)
  return ctx.redirect(destination)
}
