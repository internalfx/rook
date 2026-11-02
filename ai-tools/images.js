import crypto from 'node:crypto'
import lemonade from '../services/lemonade.js'
import images from '../services/images.js'
import settings from '../services/settings.js'
import { readImagePrompt } from './arguments.js'
import prompts from '../prompts.js'

// generate_image: makes a picture with the image model chosen in Settings, and shows it in the chat

const generateImageTool = {
  type: `function`,
  function: {
    name: `generate_image`,
    description: prompts.tools.generate_image.description,
    parameters: {
      type: `object`,
      properties: {
        prompt: {
          type: `string`,
          description: prompts.tools.generate_image.parameters.prompt,
        },
      },
      required: [`prompt`],
    },
  },
}

// The image size choices in Settings, from small to large ("WIDTHxHEIGHT")
export const imageSizes = [`256x256`, `512x512`, `768x768`]

// Used until a size is chosen in Settings; it's what the image models produce by default
export const defaultImageSize = `512x512`

const runGenerateImage = async function ({ argumentsText, toolSettings, signal }) {
  const prompt = readImagePrompt(argumentsText)

  if (prompt == null || prompt.trim() === ``) {
    return { content: `Image generation failed: no prompt was given.`, imageId: null }
  }

  // A new seed each time, so asking again gives a different image. Without a size, the model
  // uses its own default.
  const seed = crypto.randomInt(0, 2147483647)
  const size = toolSettings.size ?? null

  const pngBuffer = await lemonade.generateImage({ model: toolSettings.model, prompt, size, seed, signal })
  const imageId = await images.saveImage(pngBuffer)

  return {
    content: `The image was created and is already shown to the user. Don't include a link or markdown image for it in your reply.`,
    imageId,
  }
}

export const tools = [
  {
    name: `generate_image`,
    // Offered only while Settings have an image model
    settings: function () {
      const imageModel = settings.get(`imageModel`)

      if (imageModel == null) {
        return null
      }

      const size = settings.get(`imageSize`) ?? defaultImageSize

      return { model: imageModel, size }
    },
    definition: () => generateImageTool,
    run: runGenerateImage,
  },
]

export default {
  imageSizes,
  defaultImageSize,
  tools,
}
