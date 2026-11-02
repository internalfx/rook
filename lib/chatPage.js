
import lemonade from '../services/lemonade.js'
import chats from '../services/chats.js'
import settings from '../services/settings.js'
import tools from '../ai-tools/index.js'
import runs from '../services/runs.js'
import memories from '../services/memories.js'

const settingsLink = { href: `/settings`, label: `Open Settings` }

// Explains why chatting isn't possible right now, as { message, link }, or returns null when it is.
// Every chat uses the chat model in Settings.
const findModelProblem = function ({ chatModel, models, modelsError }) {
  if (modelsError != null) {
    return { message: `Couldn't load models: ${modelsError}`, link: null }
  }

  if (chatModel == null) {
    return { message: `Choose a chat model in Settings to start chatting.`, link: settingsLink }
  }

  const isAvailable = models.some(function (model) {
    return model.id === chatModel
  })

  if (isAvailable) {
    return null
  }

  return {
    message: `The chat model "${chatModel}" isn't on the Lemonade server any more. Choose another one in Settings.`,
    link: settingsLink,
  }
}

// Saved messages => what the page shows. A tool message gets the tool's name and arguments from
// the call it answers, so an image can be captioned with what was asked for, a web page linked
// to, a search labelled with its query, and a memory or task shown with its text.
const toPageMessages = function (savedMessages) {
  const callsById = {}

  for (const message of savedMessages) {
    const toolCalls = message.toolCalls ?? []

    for (const call of toolCalls) {
      callsById[call.id] = {
        name: call.function.name,
        prompt: tools.readImagePrompt(call.function.arguments),
        url: tools.readToolUrl(call.function.arguments),
        query: tools.readSearchQuery(call.function.arguments),
        memory: tools.readMemoryContent(call.function.arguments),
        taskTitle: tools.readTaskTitle(call.function.arguments),
      }
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
      pending: false,
    }
  })

  return pageMessages
}

// Renders the chat page for `chat`, or for a new conversation when it's null
export const renderChatPage = async function (ctx, chat) {
  let models = []
  let modelsError = null

  try {
    models = await lemonade.listChatModels()
  } catch (err) {
    console.error(err)
    modelsError = err.message
  }

  // Every chat uses the models and tools in Settings as they are now
  const chatModel = settings.get(`chatModel`)
  const chatTools = tools.getChatTools()

  const imageModel = chatTools.generate_image?.model ?? null
  const imageSize = chatTools.generate_image?.size ?? null

  // The sites the chat can read pages on; empty while web pages are off
  const webDomains = tools.getReadableDomains()
  const webSearchOn = tools.isWebSearchOn()
  const tasksOn = tools.isTasksOn()

  // "Qwen3-Embedding-4B-GGUF · 2 pinned", or null while memories are off
  let memoriesSummary = null

  if (tools.isMemoriesOn()) {
    memoriesSummary = `${tools.getEmbeddingModel()} · ${memories.countPinned()} pinned`
  }

  const modelProblem = findModelProblem({ chatModel, models, modelsError })

  // Images can be attached while the chat model can see them (Lemonade labels it "vision")
  const chatModelInfo = models.find(function (model) {
    return model.id === chatModel
  })
  const seesImages = chatModelInfo != null && lemonade.hasLabel(chatModelInfo, `vision`)

  let messages = []
  let running = false

  if (chat != null) {
    let savedMessages = chats.getMessages(chat.id)

    // A reply still running is replayed by the page from its events (see services/runs.js), so
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
    chats: chats.listChats(),
  }

  // Embedded in a <script> tag, so "<" is escaped to keep message text from closing it early
  const pageJSON = JSON.stringify(pageData).replace(/</g, `\\u003c`)

  ctx.body = ctx.nunjucks(`chat/index`, { chat, chatModel, imageModel, imageSize, webDomains, webSearchOn, memoriesSummary, tasksOn, modelProblem, pageJSON })
}

export default renderChatPage
