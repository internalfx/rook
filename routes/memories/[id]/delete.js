import memories from '../../../services/memories.js'

// Form POST from a memory's Delete confirmation on the memories page
export const POST = async function (ctx) {
  const memoryId = ctx.state.params.id

  memories.deleteMemory(memoryId)

  ctx.addFlash(`Memory deleted.`, `success`)
  return ctx.redirect(`/memories`)
}
