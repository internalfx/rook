
import lemonade from './lemonade.js'
import images from './images.js'
import settings from './settings.js'

// Tools the chat model can call, as OpenAI-style function definitions. Each tool is only
// offered when it's set up, e.g. generate_image needs an image model chosen in Settings.

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

export const getEnabledTools = function () {
  const tools = []

  const imageModel = settings.get(`imageModel`)

  if (imageModel != null) {
    tools.push(generateImageTool)
  }

  return tools
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

const runGenerateImage = async function ({ argumentsText, signal }) {
  const prompt = readImagePrompt(argumentsText)

  if (prompt == null || prompt.trim() === ``) {
    return { content: `Image generation failed: no prompt was given.`, imageId: null }
  }

  const imageModel = settings.get(`imageModel`)

  if (imageModel == null) {
    return { content: `Image generation is turned off.`, imageId: null }
  }

  const pngBuffer = await lemonade.generateImage({ model: imageModel, prompt, signal })
  const imageId = await images.saveImage(pngBuffer)

  return {
    content: `The image was created and is already shown to the user. Don't include a link or markdown image for it in your reply.`,
    imageId,
  }
}

// Runs one tool call and returns { content, imageId }. `content` is what the model is told
// about the result. Failures are reported to the model as text rather than thrown, so it can
// explain them to the user; a stopped call still throws, so the caller can tell it was stopped.
export const runTool = async function ({ name, argumentsText, signal }) {
  try {
    if (name === `generate_image`) {
      const result = await runGenerateImage({ argumentsText, signal })
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
  getEnabledTools,
  readImagePrompt,
  runTool,
}
