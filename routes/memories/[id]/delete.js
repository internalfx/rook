import memories from '../../../services/memories.js'

// Form POST from a memory's Delete confirmation on the memories page. `returnTo` is the page it
// was deleted on, so a search stays open: /memories, or /memories with its ?q=.
export const POST = async function (ctx) {
  const returnTo = ctx.request.body?.returnTo
  const isMemoriesPage = returnTo === `/memories` || (typeof returnTo === `string` && returnTo.startsWith(`/memories?`))
  const destination = isMemoriesPage ? returnTo : `/memories`

  const memoryId = ctx.state.params.id

  memories.deleteMemory(memoryId)

  ctx.addFlash(`Memory deleted.`, `success`)
  return ctx.redirect(destination)
}
