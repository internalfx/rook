
import crypto from 'node:crypto'
import lemonade from './lemonade.js'
import images from './images.js'
import settings from './settings.js'

// Tools the chat model can call, as OpenAI-style function definitions. Each chat stores the tools
// it was created with, and their settings, as an object keyed by tool name ("chat tools"):
//   { generate_image: { model: `SDXL-Turbo` } }
// They never change for that chat; Settings only decide what new chats get.

const generateImageTool = {
  type: `function`,
  function: {
    name: `generate_image`,
    description: `Create an image from a text description and show it to the user. Use it whenever the user asks for a picture, drawing, illustration, photo, logo or any other image.`,
    parameters: {
      type: `object`,
      properties: {
        prompt: {
          type: `string`,
          description: `A detailed description of the image, in English: the subject, setting, style, colours and composition.`,
        },
      },
      required: [`prompt`],
    },
  },
}

const definitionsByName = {
  generate_image: generateImageTool,
}

// The image size choices in Settings, from small to large ("WIDTHxHEIGHT")
export const imageSizes = [`256x256`, `512x512`, `768x768`]

// Used until a size is chosen in Settings; it's what the image models produce by default
export const defaultImageSize = `512x512`

// The chat tools a new chat starts with, from the current Settings
export const toolsFromSettings = function () {
  const chatTools = {}

  const imageModel = settings.get(`imageModel`)

  if (imageModel != null) {
    const size = settings.get(`imageSize`) ?? defaultImageSize
    chatTools.generate_image = { model: imageModel, size }
  }

  return chatTools
}

// The definitions to offer the model for a chat's tools
export const getToolDefinitions = function (chatTools) {
  const definitions = []

  for (const name of Object.keys(chatTools)) {
    const definition = definitionsByName[name]

    if (definition != null) {
      definitions.push(definition)
    }
  }

  return definitions
}

// The prompt the model gave generate_image, or null when the arguments aren't valid JSON yet
export const readImagePrompt = function (argumentsText) {
  try {
    const args = JSON.parse(argumentsText)
    return args.prompt ?? null
  } catch (err) {
    return null
  }
}

const runGenerateImage = async function ({ argumentsText, toolSettings, signal }) {
  const prompt = readImagePrompt(argumentsText)

  if (prompt == null || prompt.trim() === ``) {
    return { content: `Image generation failed: no prompt was given.`, imageId: null }
  }

  // A new seed each time, so asking again gives a different image. Chats from before sizes were
  // saved have no size, which leaves the model's own default.
  const seed = crypto.randomInt(0, 2147483647)
  const size = toolSettings.size ?? null

  const pngBuffer = await lemonade.generateImage({ model: toolSettings.model, prompt, size, seed, signal })
  const imageId = await images.saveImage(pngBuffer)

  return {
    content: `The image was created and is already shown to the user. Don't include a link or markdown image for it in your reply.`,
    imageId,
  }
}

// Runs one tool call and returns { content, imageId }. `content` is what the model is told
// about the result. Failures are reported to the model as text rather than thrown, so it can
// explain them to the user; a stopped call still throws, so the caller can tell it was stopped.
export const runTool = async function ({ name, argumentsText, chatTools, signal }) {
  const toolSettings = chatTools[name]

  // Only a chat's own tools are offered, so this only catches a model inventing a name
  if (toolSettings == null) {
    return { content: `${name} isn't available in this chat.`, imageId: null }
  }

  try {
    if (name === `generate_image`) {
      const result = await runGenerateImage({ argumentsText, toolSettings, signal })
      return result
    }

    return { content: `There is no tool named "${name}".`, imageId: null }
  } catch (err) {
    if (signal.aborted === true) {
      throw err
    }

    console.error(`Tool ${name} failed`, err)
    return { content: `${name} failed: ${err.message}`, imageId: null }
  }
}

export default {
  imageSizes,
  defaultImageSize,
  toolsFromSettings,
  getToolDefinitions,
  readImagePrompt,
  runTool,
}
