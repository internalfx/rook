import taskRequests from '../../../../lib/taskRequests.js'

// Form POST from Accept on a task request held for the user, or Accept anyway on one their model
// declined (see lib/taskRequests.js): the task joins their list
export const POST = async function (ctx) {
  const accepted = taskRequests.accept(ctx.state.user.id, ctx.state.params.id, { by: `user` })

  if (accepted == null) {
    ctx.addFlash(`That request is no longer waiting for an answer.`, `error`)
    return ctx.redirect(`/tasks`)
  }

  ctx.addFlash(`Added to your tasks. ${accepted.request.fromName} can see you accepted it.`, `success`)
  return ctx.redirect(`/tasks`)
}
