import joi from '../../../services/joi.js'
import memories from '../../../services/memories.js'

// Form POST from a memory's Edit form on the memories page. `returnTo` is the page it was edited
// on, so a search stays open: /memories, or /memories with its ?q=.
export const POST = async function (ctx) {
  const returnTo = ctx.request.body?.returnTo
  const isMemoriesPage = returnTo === `/memories` || (typeof returnTo === `string` && returnTo.startsWith(`/memories?`))
  const destination = isMemoriesPage ? returnTo : `/memories`

  const userId = ctx.state.user.id
  const memoryId = ctx.state.params.id
  const memory = memories.getMemory(userId, memoryId)

  if (memory == null) {
    ctx.addFlash(`That memory no longer exists.`, `error`)
    return ctx.redirect(destination)
  }

  let args

  try {
    args = await joi.object({
      content: joi.string().trim().max(2000).required(),
      // A checkbox, which a form leaves out when it's off
      pinned: joi.boolean(),
      returnTo: joi.string(),
    }).validateAsync(ctx.request.body)
  } catch (err) {
    ctx.addFlash(err.message, `error`)
    return ctx.redirect(destination)
  }

  memories.updateMemory(userId, memoryId, { content: args.content, pinned: args.pinned === true })

  ctx.addFlash(`Memory saved.`, `success`)
  return ctx.redirect(destination)
}
