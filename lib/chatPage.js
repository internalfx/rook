
import lemonade from '../services/lemonade.js'
import chats from '../services/chats.js'
import settings from '../services/settings.js'
import tools from '../services/tools.js'

// Explains why chatting isn't possible right now, or returns null when it is
const findModelProblem = function ({ chatModel, models, modelsError }) {
  if (modelsError != null) {
    return `Couldn't load models: ${modelsError}`
  }

  if (chatModel == null) {
    return `Choose a chat model in Settings to start chatting.`
  }

  const isAvailable = models.some(function (model) {
    return model.id === chatModel
  })

  if (isAvailable === false) {
    return `The chat model "${chatModel}" isn't on the Lemonade server any more. Choose another one in Settings.`
  }

  return null
}

// Saved messages => what the page shows. A tool message gets the prompt from the call it
// answers, so an image can be captioned with what was asked for.
const toPageMessages = function (savedMessages) {
  const promptsByCallId = {}

  for (const message of savedMessages) {
    const toolCalls = message.toolCalls ?? []

    for (const call of toolCalls) {
      promptsByCallId[call.id] = tools.readImagePrompt(call.function.arguments)
    }
  }

  const pageMessages = savedMessages.map(function (message) {
    return {
      role: message.role,
      content: message.content,
      reasoning: message.reasoning,
      toolCallId: message.toolCallId,
      imageId: message.imageId,
      prompt: promptsByCallId[message.toolCallId] ?? null,
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

  const chatModel = settings.get(`chatModel`)
  const modelProblem = findModelProblem({ chatModel, models, modelsError })

  const imageModel = settings.get(`imageModel`)

  let messages = []

  if (chat != null) {
    const savedMessages = chats.getMessages(chat.id)
    messages = toPageMessages(savedMessages)
  }

  const pageData = {
    chat: chat == null ? null : { id: chat.id, title: chat.title },
    messages,
    chats: chats.listChats(),
  }

  // Embedded in a <script> tag, so "<" is escaped to keep message text from closing it early
  const pageJSON = JSON.stringify(pageData).replace(/</g, `\\u003c`)

  ctx.body = ctx.nunjucks(`chat/index`, { chat, chatModel, imageModel, modelProblem, pageJSON })
}

export default renderChatPage
