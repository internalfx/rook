import taskRequests from '../../../../lib/taskRequests.js'

// Form POST from Withdraw on a task request the user sent that hasn't been answered yet
export const POST = async function (ctx) {
  const withdrawn = taskRequests.withdraw(ctx.state.user.id, ctx.state.params.id)

  if (withdrawn === false) {
    ctx.addFlash(`That request has already been answered, so it can't be withdrawn.`, `error`)
    return ctx.redirect(`/tasks`)
  }

  ctx.addFlash(`Request withdrawn.`, `success`)
  return ctx.redirect(`/tasks`)
}
