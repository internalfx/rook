import time from './time.js'
import math from './math.js'
import images from './images.js'
import webPages from './webPages.js'
import webSearch from './webSearch.js'
import memories from './memories.js'
import tasks from './tasks.js'
import slack from './slack.js'
import notifications from './notifications.js'
import { readCallDetails } from './arguments.js'

// Tools the chat model can call, as OpenAI-style function definitions. Every chat has the tools
// config.js gives right now, as an object keyed by tool name ("chat tools", see getChatTools):
//   { generate_image: { model: `SDXL-Turbo`, size: `512x512` }, read_web_page: {} }
//
// Each of time.js, math.js, images.js, webPages.js, webSearch.js, memories.js, tasks.js, slack.js
// and notifications.js gives its tools as a list of entries:
//   name        what the model calls it
//   settings    (user) => its settings for the user's chat right now ({} when there's nothing to
//               set), or null when config.js leaves it out
//   definition  (toolSettings) => its definition for the model, or null when it can't be offered
//               right now
//   run         ({ argumentsText, toolSettings, user, chatId, briefingId, signal }) => { content, imageId }
// `user` is whose chat or briefing it is (ctx.state.user): everything a tool reads or changes is
// theirs alone.
// The other files are what those need (calculator.js, webReader.js, duckduckgo.js, browser.js,
// sites.js, arguments.js), and limits.js, how many calls the model gets.

// Every tool, in the order the model is offered them
const allTools = [
  ...time.tools,
  ...math.tools,
  ...images.tools,
  ...webPages.tools,
  ...webSearch.tools,
  ...memories.tools,
  ...tasks.tools,
  ...slack.tools,
  ...notifications.tools,
]

const toolsByName = new Map(allTools.map(function (tool) {
  return [tool.name, tool]
}))

// The tools the user's chats have right now, and their settings, from config.js and their own
// Settings
export const getChatTools = function (user) {
  const chatTools = {}

  for (const tool of allTools) {
    const toolSettings = tool.settings(user)

    if (toolSettings != null) {
      chatTools[tool.name] = toolSettings
    }
  }

  return chatTools
}

// The definitions to offer the model for a chat's tools
export const getToolDefinitions = function (chatTools) {
  const definitions = []

  for (const [name, toolSettings] of Object.entries(chatTools)) {
    const tool = toolsByName.get(name)
    const definition = tool == null ? null : tool.definition(toolSettings)

    if (definition != null) {
      definitions.push(definition)
    }
  }

  return definitions
}

// Runs one tool call and returns { content, imageId }. `content` is what the model is told
// about the result. Failures are reported to the model as text rather than thrown, so it can
// explain them to the user; a stopped call still throws, so the caller can tell it was stopped.
// `user` is whose it is; `chatId` is the chat the call was made in, or `briefingId` the briefing.
export const runTool = async function ({ name, argumentsText, chatTools, user, chatId, briefingId = null, signal }) {
  const toolSettings = Object.hasOwn(chatTools, name) ? chatTools[name] : null

  // Only these tools are offered, so this catches a model inventing a name, or calling a tool
  // from earlier in the conversation that has since been turned off in config.js
  if (toolSettings == null) {
    return { content: `${name} is turned off in config.js.`, imageId: null }
  }

  const tool = toolsByName.get(name)

  if (tool == null) {
    return { content: `There is no tool named "${name}".`, imageId: null }
  }

  try {
    const result = await tool.run({ argumentsText, toolSettings, user, chatId, briefingId, signal })
    return result
  } catch (err) {
    if (signal.aborted === true) {
      throw err
    }

    console.error(`Tool ${name} failed`, err)
    return { content: `${name} failed: ${err.message}`, imageId: null }
  }
}

export default {
  imageSizes: images.imageSizes,
  defaultImageSize: images.defaultImageSize,
  getChatTools,
  getToolDefinitions,
  getWebDomains: webPages.getWebDomains,
  isWebPagesOn: webPages.isWebPagesOn,
  getPageReaderModel: webPages.getPageReaderModel,
  getReadableDomains: webPages.getReadableDomains,
  isWebSearchOn: webSearch.isWebSearchOn,
  getEmbeddingModel: memories.getEmbeddingModel,
  isMemoriesOn: memories.isMemoriesOn,
  buildMemoriesMessage: memories.buildMemoriesMessage,
  describeCurrentTime: time.describeCurrentTime,
  isTasksOn: tasks.isTasksOn,
  getSlackChannels: slack.getSlackChannels,
  isSlackOn: slack.isSlackOn,
  describeScheduledNotification: notifications.describeScheduled,
  describeSendTime: notifications.describeSendTime,
  readCallDetails,
  runTool,
}
