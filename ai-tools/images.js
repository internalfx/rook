import crypto from 'node:crypto'
import lemonade from '../lib/lemonade.js'
import images from '../lib/images.js'
import config from '../configure.js'
import { readImagePrompt } from './arguments.js'
import prompts from '../lib/prompts.js'

// generate_image: makes a picture with the image model in Admin → Models, and shows it in the chat

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

// The image sizes Admin → Models may name, from small to large ("WIDTHxHEIGHT")
export const imageSizes = [`256x256`, `512x512`, `768x768`]

// Used while Admin → Models names no size; it's what the image models produce by default
export const defaultImageSize = `512x512`

// The image model in Admin → Models, or null while images are off
export const getImageModel = function () {
  return config.models?.image ?? null
}

export const getImageSize = function () {
  return config.models?.imageSize ?? defaultImageSize
}

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
    // Offered only while Admin → Models has an image model
    settings: function () {
      const imageModel = getImageModel()

      if (imageModel == null) {
        return null
      }

      return { model: imageModel, size: getImageSize() }
    },
    definition: () => generateImageTool,
    run: runGenerateImage,
  },
]

export default {
  imageSizes,
  defaultImageSize,
  getImageModel,
  getImageSize,
  tools,
}
