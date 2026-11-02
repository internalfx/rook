import tasks from '../../../services/tasks.js'

// Form POST from a task's Delete confirmation. Only the owner can delete tasks; the chat model
// has no tool for it.
export const POST = async function (ctx) {
  tasks.deleteTask(ctx.state.params.id)

  ctx.addFlash(`Task deleted.`, `success`)
  return ctx.redirect(`/tasks`)
}
