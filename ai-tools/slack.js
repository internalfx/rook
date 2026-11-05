import dayjs from 'dayjs'
import utc from 'dayjs/plugin/utc'
import timezone from 'dayjs/plugin/timezone'
import settings from '../services/settings.js'
import slack from '../services/slack.js'
import { parseArguments, readSearchQuery } from './arguments.js'
import prompts from '../prompts.js'

// read_slack and search_slack: read the Slack conversations the user picked in Settings, and only
// those, with their own Slack token (see services/slack.js). Briefings use them too.

// What read_slack gives the model at most: the newest messages, and the replies to the newest
// threads among them
const readLimit = 40
const readThreadLimit = 5

// The most matches search_slack gives the model
const searchLimit = 20

// The conversations the user picked in Settings, as [{ id, kind, label }]; none while they have
// no Slack token
export const getSlackChannels = function (user) {
  if (slack.isConfigured(user.id) === false) {
    return []
  }

  return settings.get(user.id, `slackChannels`) ?? []
}

export const isSlackOn = function (user) {
  return getSlackChannels(user).length > 0
}

const listLabels = function (conversations) {
  const labels = conversations.map(function (conversation) {
    return conversation.label
  })

  return labels.join(`, `)
}

// Both definitions name the picked conversations, as the chat's tools have them (see `settings`
// below)
const buildReadSlackTool = function ({ conversations }) {
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

const buildSearchSlackTool = function ({ conversations }) {
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
const findPicked = function (name, conversations) {
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

dayjs.extend(utc)
dayjs.extend(timezone)

// "2026-11-01" => the start of that day in `zone`, the user's time zone; null when it isn't a
// date like that
const readDay = function (text, zone) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(text) === false) {
    return null
  }

  const day = dayjs.tz(text, zone)

  if (day.isValid() === false) {
    return null
  }

  return day.toDate()
}

// The conversation's latest messages, or those since a day, oldest first
const runReadSlack = async function ({ argumentsText, toolSettings, user, signal }) {
  const args = parseArguments(argumentsText) ?? {}
  const label = typeof args.channel === `string` ? args.channel : ``

  // The picks can change in Settings part way through a conversation
  const conversations = getSlackChannels(user)
  const conversation = findPicked(label, conversations)

  if (conversation == null) {
    const picked = listLabels(conversations)
    return { content: `"${label}" isn't one of the Slack conversations picked in Settings, which are: ${picked}.`, imageId: null }
  }

  let since = null

  if (typeof args.since === `string` && args.since.trim() !== ``) {
    since = readDay(args.since.trim(), user.timeZone)

    if (since == null) {
      return { content: `Reading Slack failed: since should be a date like 2026-11-01.`, imageId: null }
    }
  }

  const result = await slack.readConversation({
    userId: user.id,
    timeZone: user.timeZone,
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
const runSearchSlack = async function ({ argumentsText, user, signal }) {
  const query = readSearchQuery(argumentsText)

  if (query == null || query.trim() === ``) {
    return { content: `The search failed: no query was given.`, imageId: null }
  }

  const conversations = getSlackChannels(user)

  if (conversations.length === 0) {
    return { content: `Slack is turned off in Settings.`, imageId: null }
  }

  const result = await slack.searchMessages({ userId: user.id, timeZone: user.timeZone, query: query.trim(), conversations, limit: searchLimit, signal })

  if (result.matchCount === 0) {
    return { content: `No messages match "${query.trim()}" in the picked Slack conversations.`, imageId: null }
  }

  return { content: `Messages matching "${query.trim()}", newest first:\n${result.text}`, imageId: null }
}

// In every chat's tools, with the user's picks as they are when the message is sent, but offered
// only while there are some
export const tools = [
  {
    name: `read_slack`,
    settings: (user) => ({ conversations: getSlackChannels(user) }),
    definition: buildReadSlackTool,
    run: runReadSlack,
  },
  {
    name: `search_slack`,
    settings: (user) => ({ conversations: getSlackChannels(user) }),
    definition: buildSearchSlackTool,
    run: runSearchSlack,
  },
]

export default {
  getSlackChannels,
  isSlackOn,
  tools,
}
