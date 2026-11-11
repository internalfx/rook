import joi from '../../../../lib/joi.js'
import taskRequests from '../../../../lib/taskRequests.js'

// Form POST from Decline on a task request held for the user, with an optional reason, which
// whoever sent it is shown
export const POST = async function (ctx) {
  let args

  try {
    args = await joi.object({
      reason: joi.string().trim().max(taskRequests.maxReasonLength),
    }).validateAsync(ctx.request.body)
  } catch (err) {
    ctx.addFlash(err.message, `error`)
    return ctx.redirect(`/tasks`)
  }

  const declined = taskRequests.decline(ctx.state.user.id, ctx.state.params.id, { by: `user`, note: args.reason ?? `` })

  if (declined == null) {
    ctx.addFlash(`That request is no longer waiting for an answer.`, `error`)
    return ctx.redirect(`/tasks`)
  }

  ctx.addFlash(`Declined. ${declined.fromName} can see that.`, `success`)
  return ctx.redirect(`/tasks`)
}
