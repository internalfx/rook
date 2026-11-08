import chats from '../../../lib/chats.js'
import memories from '../../../lib/memories.js'
import { quoteMarkdown } from '../../../lib/format.js'

// The model's first message in a chat about `memory`: the memory itself, whether it's pinned, and
// a question for the user. It has no id; to change or delete the memory, the model finds it with
// search_memories.
const describeMemoryStart = function (memory) {
  const parts = [`Let's talk about this memory:`, quoteMarkdown(memory.content)]

  if (memory.pinned) {
    parts.push(`It's pinned, so I'm given it at the start of every chat.`)
  } else {
    parts.push(`It's searchable: I find it when it's relevant.`)
  }

  parts.push(`What would you like to discuss?`)

  return parts.join(`\n\n`)
}

// Form POST from a memory's Discuss button: opens a new chat where the model speaks first, with
// the memory, as Discuss on a task does. `returnTo` is the page it was clicked on, so a search
// stays open if the memory has gone.
export const POST = async function (ctx) {
  const userId = ctx.state.user.id
  const memory = memories.getMemory(userId, ctx.state.params.id)

  if (memory == null) {
    const returnTo = ctx.request.body?.returnTo
    const isMemoriesPage = returnTo === `/memories` || (typeof returnTo === `string` && returnTo.startsWith(`/memories?`))

    ctx.addFlash(`That memory no longer exists.`, `error`)
    return ctx.redirect(isMemoriesPage ? returnTo : `/memories`)
  }

  const chat = chats.createChat(userId)

  chats.addMessage({ chatId: chat.id, role: `assistant`, content: describeMemoryStart(memory) })

  return ctx.redirect(`/chat/${chat.id}`)
}
