import joi from '../../../services/joi.js'
import memories from '../../../services/memories.js'

// Form POST from a memory's Edit form on the memories page
export const POST = async function (ctx) {
  const memoryId = ctx.state.params.id
  const memory = memories.getMemory(memoryId)

  if (memory == null) {
    ctx.addFlash(`That memory no longer exists.`, `error`)
    return ctx.redirect(`/memories`)
  }

  let args

  try {
    args = await joi.object({
      content: joi.string().trim().max(2000).required(),
      // A checkbox, which a form leaves out when it's off
      pinned: joi.boolean(),
    }).validateAsync(ctx.request.body)
  } catch (err) {
    ctx.addFlash(err.message, `error`)
    return ctx.redirect(`/memories`)
  }

  memories.updateMemory(memoryId, { content: args.content, pinned: args.pinned === true })

  ctx.addFlash(`Memory saved.`, `success`)
  return ctx.redirect(`/memories`)
}
