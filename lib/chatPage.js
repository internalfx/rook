
import lemonade from '../services/lemonade.js'
import chats from '../services/chats.js'
import settings from '../services/settings.js'
import tools from '../services/tools.js'

const settingsLink = { href: `/settings`, label: `Open Settings` }
const newChatLink = { href: `/chat`, label: `New chat` }

// Explains why chatting isn't possible right now, as { message, link }, or returns null when it is.
// A new chat's model comes from Settings; an existing chat's model is its own and can't be changed.
const findModelProblem = function ({ chat, chatModel, models, modelsError }) {
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

  if (chat == null) {
    return {
      message: `The chat model "${chatModel}" isn't on the Lemonade server any more. Choose another one in Settings.`,
      link: settingsLink,
    }
  }

  return {
    message: `This chat's model, "${chatModel}", isn't on the Lemonade server any more. Start a new chat to use another model.`,
    link: newChatLink,
  }
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

  // An existing chat shows its own models; a new one shows what Settings will give it
  let chatModel = null
  let imageModel = null

  if (chat == null) {
    chatModel = settings.get(`chatModel`)
    imageModel = settings.get(`imageModel`)
  } else {
    chatModel = chat.model
    imageModel = chat.tools.generate_image?.model ?? null
  }

  const modelProblem = findModelProblem({ chat, chatModel, models, modelsError })

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
