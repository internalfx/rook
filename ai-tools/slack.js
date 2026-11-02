import settings from '../services/settings.js'
import slack from '../services/slack.js'
import { parseArguments, readSearchQuery } from './arguments.js'
import prompts from '../prompts.js'

// read_slack and search_slack: read the Slack conversations picked in Settings, and only those
// (see services/slack.js). Briefings use them too.

// What read_slack gives the model at most: the newest messages, and the replies to the newest
// threads among them
const readLimit = 40
const readThreadLimit = 5

// The most matches search_slack gives the model
const searchLimit = 20

// The conversations picked in Settings, as [{ id, kind, label }]; none while there's no Slack token
export const getSlackChannels = function () {
  if (slack.isConfigured() === false) {
    return []
  }

  return settings.get(`slackChannels`) ?? []
}

export const isSlackOn = function () {
  return getSlackChannels().length > 0
}

const listLabels = function (conversations) {
  const labels = conversations.map(function (conversation) {
    return conversation.label
  })

  return labels.join(`, `)
}

// Both definitions name the picked conversations, as they are in Settings right now
const buildReadSlackTool = function () {
  const conversations = getSlackChannels()

  if (conversations.length === 0) {
    return null
  }

  const labels = conversations.map(function (conversation) {
    return conversation.label
  })

  return {
    type: `function`,
    function: {
      name: `read_slack`,
      description: prompts.tools.read_slack.description,
      parameters: {
        type: `object`,
        properties: {
          channel: {
            type: `string`,
            enum: labels,
          },
          since: {
            type: `string`,
            description: prompts.tools.read_slack.parameters.since,
          },
        },
        required: [`channel`],
      },
    },
  }
}

const buildSearchSlackTool = function () {
  const conversations = getSlackChannels()

  if (conversations.length === 0) {
    return null
  }

  return {
    type: `function`,
    function: {
      name: `search_slack`,
      description: prompts.tools.search_slack.description({ conversations: listLabels(conversations) }),
      parameters: {
        type: `object`,
        properties: {
          query: {
            type: `string`,
            description: prompts.tools.search_slack.parameters.query,
          },
        },
        required: [`query`],
      },
    },
  }
}

// "#Ops" => "ops", for comparing what the model wrote with the labels
const simplifyLabel = function (text) {
  return text.trim().toLowerCase().replace(/^[#@]/, ``)
}

// The picked conversation the model named, or null. Models don't always copy the label exactly
// ("@aaron" for "@Aaron", "razor-rags" for "#razor-rags"), so case and a missing # or @ don't
// matter, as long as only one picked conversation matches.
const findPicked = function (name) {
  const conversations = getSlackChannels()

  const exact = conversations.find(function (conversation) {
    return conversation.label === name
  })

  if (exact != null) {
    return exact
  }

  const wanted = simplifyLabel(name)

  const matches = conversations.filter(function (conversation) {
    return simplifyLabel(conversation.label) === wanted
  })

  if (matches.length === 1) {
    return matches[0]
  }

  return null
}

// "2026-11-01" => the start of that day in the server's time zone, which is the owner's; null
// when it isn't a date like that
const readDay = function (text) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(text) === false) {
    return null
  }

  const day = new Date(`${text}T00:00:00`)

  if (Number.isNaN(day.getTime())) {
    return null
  }

  return day
}

// The conversation's latest messages, or those since a day, oldest first
const runReadSlack = async function ({ argumentsText, signal }) {
  const args = parseArguments(argumentsText) ?? {}
  const label = typeof args.channel === `string` ? args.channel : ``

  // The picks can change in Settings part way through a conversation
  const conversation = findPicked(label)

  if (conversation == null) {
    const picked = listLabels(getSlackChannels())
    return { content: `"${label}" isn't one of the Slack conversations picked in Settings, which are: ${picked}.`, imageId: null }
  }

  let since = null

  if (typeof args.since === `string` && args.since.trim() !== ``) {
    since = readDay(args.since.trim())

    if (since == null) {
      return { content: `Reading Slack failed: since should be a date like 2026-11-01.`, imageId: null }
    }
  }

  const result = await slack.readConversation({
    channelId: conversation.id,
    oldest: since,
    limit: readLimit,
    threadLimit: readThreadLimit,
    signal,
  })

  const sinceText = since == null ? `` : ` since ${args.since.trim()}`

  if (result.messageCount === 0) {
    return { content: `No messages in ${conversation.label}${sinceText}.`, imageId: null }
  }

  let content = `${conversation.label}, ${result.messageCount} messages${sinceText}, oldest first:\n${result.text}`

  if (result.hasMore) {
    content = `${content}\n(Only the newest ${readLimit} are shown.)`
  }

  return { content, imageId: null }
}

// Matches in the picked conversations, newest first, each with a link to it in Slack
const runSearchSlack = async function ({ argumentsText, signal }) {
  const query = readSearchQuery(argumentsText)

  if (query == null || query.trim() === ``) {
    return { content: `The search failed: no query was given.`, imageId: null }
  }

  const conversations = getSlackChannels()

  if (conversations.length === 0) {
    return { content: `Slack is turned off in Settings.`, imageId: null }
  }

  const result = await slack.searchMessages({ query: query.trim(), conversations, limit: searchLimit, signal })

  if (result.matchCount === 0) {
    return { content: `No messages match "${query.trim()}" in the picked Slack conversations.`, imageId: null }
  }

  return { content: `Messages matching "${query.trim()}", newest first:\n${result.text}`, imageId: null }
}

export const tools = [
  {
    name: `read_slack`,
    // In every chat's tools, but offered only while conversations are picked in Settings
    settings: () => ({}),
    definition: buildReadSlackTool,
    run: runReadSlack,
  },
  {
    name: `search_slack`,
    settings: () => ({}),
    definition: buildSearchSlackTool,
    run: runSearchSlack,
  },
]

export default {
  getSlackChannels,
  isSlackOn,
  tools,
}
