import joi from '../../services/joi.js'
import memories from '../../services/memories.js'
import tools from '../../ai-tools/index.js'

export const GET = async function (ctx) {
  const allMemories = memories.listMemories()

  const pinned = allMemories.filter(function (memory) {
    return memory.pinned === true
  })

  const searchable = allMemories.filter(function (memory) {
    return memory.pinned === false
  })

  ctx.body = ctx.nunjucks(`memories/index`, {
    pinned,
    searchable,
    isMemoriesOn: tools.isMemoriesOn(),
  })
}

// Form POST from the "Add a memory" box; a memory the user adds isn't from any chat
export const POST = async function (ctx) {
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

  memories.createMemory({ content: args.content, pinned: args.pinned === true, chatId: null })

  ctx.addFlash(`Memory saved.`, `success`)
  return ctx.redirect(`/memories`)
}
