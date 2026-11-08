import joi from '../../lib/joi.js'
import memories from '../../lib/memories.js'
import tools from '../../ai-tools/index.js'

// How many memories a search shows, closest first, and how long it may take: the first search
// with a new embedding model embeds every memory
const searchLimit = 10
const searchTimeout = 1000 * 60 * 2

// The memories, pinned and searchable. With ?q=, the memories closest in meaning to it instead,
// pinned ones too, found with the embedding model as the chat model finds them.
export const GET = async function (ctx) {
  const userId = ctx.state.user.id
  const q = typeof ctx.query.q === `string` ? ctx.query.q.trim() : ``

  let results = null
  let searchError = null

  if (q !== ``) {
    const model = tools.getEmbeddingModel()

    if (model == null) {
      searchError = `Searching by meaning needs an embedding model; name one in config.js.`
    } else {
      try {
        results = await memories.searchAll({ userId, query: q, model, limit: searchLimit, signal: AbortSignal.timeout(searchTimeout) })
      } catch (err) {
        console.error(err)
        searchError = `Couldn't search: ${err.message}`
      }
    }
  }

  const allMemories = memories.listMemories(userId)

  const pinned = allMemories.filter(function (memory) {
    return memory.pinned === true
  })

  const searchable = allMemories.filter(function (memory) {
    return memory.pinned === false
  })

  // Where editing or deleting a memory comes back to, so a search stays open
  const returnTo = q === `` ? `/memories` : `/memories?q=${encodeURIComponent(q)}`

  ctx.body = ctx.nunjucks(`memories/index`, {
    pinned,
    searchable,
    isMemoriesOn: tools.isMemoriesOn(),
    q,
    results,
    searchError,
    returnTo,
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

  memories.createMemory({ userId: ctx.state.user.id, content: args.content, pinned: args.pinned === true, chatId: null })

  ctx.addFlash(`Memory saved.`, `success`)
  return ctx.redirect(`/memories`)
}
