
import config from '../configure.js'
import lemonade from './lemonade.js'
import chats from './chats.js'
import tools from '../ai-tools/index.js'
import runs from './runs.js'
import memories from './memories.js'

// Explains why chatting isn't possible right now, as { message, link }, or returns null when it is.
// Every chat uses the chat model from Admin → Models; the link goes there for an admin.
const findModelProblem = function ({ chatModel, models, modelsError, isAdmin }) {
  const link = isAdmin ? { href: `/admin/models`, label: `Open Models` } : null

  if (chatModel == null) {
    return { message: `No chat model is chosen yet. An admin chooses one in Admin → Models.`, link }
  }

  if (modelsError != null) {
    return { message: `Couldn't load models: ${modelsError}`, link }
  }

  const isAvailable = models.some(function (model) {
    return model.id === chatModel
  })

  if (isAvailable) {
    return null
  }

  return {
    message: `The chat model "${chatModel}" isn't on the Lemonade server any more. Choose another in Admin → Models.`,
    link,
  }
}

// Saved messages => what the page shows. A tool message gets the tool's name and arguments from
// the call it answers, so an image can be captioned with what was asked for, a web page linked
// to, a search labelled with its query, a memory or task shown with its text, and a Slack read
// with its conversation.
const toPageMessages = function (savedMessages) {
  const callsById = {}

  for (const message of savedMessages) {
    const toolCalls = message.toolCalls ?? []

    for (const call of toolCalls) {
      const details = tools.readCallDetails(call.function.arguments)
      callsById[call.id] = { name: call.function.name, ...details }
    }
  }

  const pageMessages = savedMessages.map(function (message) {
    const call = callsById[message.toolCallId]

    return {
      role: message.role,
      content: message.content,
      reasoning: message.reasoning,
      toolCallId: message.toolCallId,
      imageId: message.imageId,
      // The images the user attached, for their messages
      imageIds: message.imageIds ?? null,
      name: call?.name ?? null,
      prompt: call?.prompt ?? null,
      url: call?.url ?? null,
      query: call?.query ?? null,
      memory: call?.memory ?? null,
      taskTitle: call?.taskTitle ?? null,
      channel: call?.channel ?? null,
      pending: false,
    }
  })

  return pageMessages
}

// Renders the chat page for `chat`, one of the logged-in user's, or for a new conversation when
// it's null
export const renderChatPage = async function (ctx, chat) {
  const user = ctx.state.user

  let models = []
  let modelsError = null

  try {
    models = await lemonade.listChatModels()
  } catch (err) {
    console.error(err)
    modelsError = err.message
  }

  // Every chat uses the models and tools from the Admin pages
  const chatModel = config.models.chat
  const chatTools = tools.getChatTools(user)

  const imageModel = chatTools.generate_image?.model ?? null
  const imageSize = chatTools.generate_image?.size ?? null

  // The sites the chat can read pages on; empty while web pages are off
  const webDomains = tools.getReadableDomains()
  const webSearchOn = tools.isWebSearchOn()
  const tasksOn = tools.isTasksOn()
  // The Slack conversations the chat can read; empty while Slack is off for the user
  const slackLabels = tools.getSlackChannels(user).map(function (conversation) {
    return conversation.label
  })

  // "Qwen3-Embedding-4B-GGUF · 2 pinned", or null while memories are off
  let memoriesSummary = null

  if (tools.isMemoriesOn()) {
    memoriesSummary = `${tools.getEmbeddingModel()} · ${memories.countPinned(user.id)} pinned`
  }

  const modelProblem = findModelProblem({ chatModel, models, modelsError, isAdmin: user.isAdmin })

  // Images can be attached while the chat model can see them (Lemonade labels it "vision")
  const chatModelInfo = models.find(function (model) {
    return model.id === chatModel
  })
  const seesImages = chatModelInfo != null && lemonade.hasLabel(chatModelInfo, `vision`)

  let messages = []
  let running = false

  if (chat != null) {
    let savedMessages = chats.getMessages(chat.id)

    // A reply still running is replayed by the page from its events (see lib/runs.js), so
    // only the messages saved before it started are sent here
    const run = runs.getRun(chat.id)

    if (run != null) {
      savedMessages = savedMessages.slice(0, run.baseCount)
      running = true
    }

    messages = toPageMessages(savedMessages)
  }

  const pageData = {
    chat: chat == null ? null : { id: chat.id, title: chat.title },
    messages,
    running,
    seesImages,
    chats: chats.listChats(user.id),
  }

  // Embedded in a <script> tag, so "<" is escaped to keep message text from closing it early
  const pageJSON = JSON.stringify(pageData).replace(/</g, `\\u003c`)

  ctx.body = ctx.nunjucks(`chat/index`, { chat, chatModel, imageModel, imageSize, webDomains, webSearchOn, memoriesSummary, tasksOn, slackLabels, modelProblem, pageJSON })
}

export default renderChatPage
