import caches from './caches.js'
import settings from './settings.js'

// Slack's Web API, only ever read, with each user's own user token (slackToken in their
// Settings), so rook sees what they see. Which conversations it reads is chosen in Settings too
// (see ai-tools/slack.js).
// Channels, private channels, group DMs and DMs are all "conversations" to Slack, read the same
// way.
// https://api.slack.com/methods

const requestTimeout = 1000 * 10

// A message's text is cut to this, as chats are in briefings
const messageCharLimit = 600

// The replies shown under a thread: its latest ones
const repliesPerThread = 10

// How many pages of search results to look through for matches in the picked conversations
const searchPages = 3

// Messages that only say something happened, like someone joining, rather than something said
const skippedSubtypes = [
  `channel_join`, `channel_leave`, `channel_topic`, `channel_purpose`, `channel_name`,
  `channel_archive`, `channel_unarchive`, `group_join`, `group_leave`, `group_topic`,
  `group_purpose`, `group_name`, `group_archive`, `group_unarchive`,
]

// Slack's errors that mean the token itself is the problem
const badTokenErrors = [`invalid_auth`, `not_authed`, `token_revoked`, `token_expired`, `account_inactive`]

// The user's own Slack user token, from their Settings, or null
const getToken = function (userId) {
  const token = settings.get(userId, `slackToken`)
  return typeof token === `string` && token !== `` ? token : null
}

// Whether the user has a Slack token
export const isConfigured = function (userId) {
  return getToken(userId) != null
}

// Calls a Web API method with `token` and returns Slack's answer. Most failures come back as
// { ok: false }, which become an Error saying what to do. Pass `signal` to cancel.
const callSlackWith = async function (token, method, params, signal) {
  const url = new URL(`https://slack.com/api/${method}`)

  for (const [key, value] of Object.entries(params)) {
    if (value != null && value !== ``) {
      url.searchParams.set(key, String(value))
    }
  }

  const signals = [AbortSignal.timeout(requestTimeout)]

  if (signal != null) {
    signals.push(signal)
  }

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.any(signals),
  })

  if (response.status === 429) {
    const wait = response.headers.get(`retry-after`) ?? `a few`
    throw new Error(`Slack is limiting requests; try again in ${wait} seconds.`)
  }

  if (response.ok === false) {
    throw new Error(`Slack ${method} failed: HTTP ${response.status}`)
  }

  const body = await response.json()

  if (body.ok === true) {
    return body
  }

  if (badTokenErrors.includes(body.error)) {
    throw new Error(`The Slack token isn't valid (${body.error}).`)
  }

  if (body.error === `missing_scope`) {
    throw new Error(`The Slack token needs the ${body.needed} scope: add it under User Token Scopes in the Slack app, then reinstall it.`)
  }

  throw new Error(`Slack ${method} failed: ${body.error}`)
}

// Calls a Web API method as the user, with their token
const callSlack = async function (userId, method, params, signal) {
  const token = getToken(userId)

  if (token == null) {
    throw new Error(`Add your Slack user token in Settings.`)
  }

  return callSlackWith(token, method, params, signal)
}

// Tries a token a user has typed in Settings: { ok: true, name }, the name of the Slack account
// it belongs to, or { ok: false, error }
export const checkToken = async function (token, signal) {
  try {
    const body = await callSlackWith(token, `auth.test`, {}, signal)
    return { ok: true, name: body.user }
  } catch (err) {
    return { ok: false, error: err.message }
  }
}

// Loads under way, by cache key. A briefing reads its conversations at the same time, so they
// share one load instead of each asking Slack (which limits how often users.list can be called).
const loading = new Map()

const getCached = function (key, load) {
  const pending = loading.get(key)

  if (pending != null) {
    return pending
  }

  const promise = caches.get(key, load).finally(function () {
    loading.delete(key)
  })

  loading.set(key, promise)

  return promise
}

// The user's own Slack user id. Kept for a day. The caches are per user, like everything read
// with their token.
const getMyUserId = function (userId, signal) {
  return getCached(`slack:${userId}:me`, async function () {
    const body = await callSlack(userId, `auth.test`, {}, signal)
    return body.user_id
  })
}

// Everyone in the user's workspace, as maps from their user id and from their handle to
// { name, handle }. The name is their full name where they've given one. Kept for a day.
const getUsers = function (userId, signal) {
  return getCached(`slack:${userId}:users`, async function () {
    const byId = new Map()
    const byHandle = new Map()
    let cursor = ``

    do {
      const body = await callSlack(userId, `users.list`, { limit: 200, cursor }, signal)

      for (const member of body.members) {
        const name = member.profile?.real_name || member.real_name || member.profile?.display_name || member.name
        const user = { name, handle: member.name }

        byId.set(member.id, user)
        byHandle.set(member.name, user)
      }

      cursor = body.response_metadata?.next_cursor ?? ``
    } while (cursor !== ``)

    return { byId, byHandle }
  })
}

// A conversation as rook shows it: { id, kind, label, handle }. `kind` is channel, private,
// group or dm. The label is "#ops" for a channel, "@Jane Doe" for a DM, and "@Jane Doe, @Bob
// Smith" for a group DM, leaving the user out. Null for a DM with someone who has left.
const toConversation = function (channel, users, myId) {
  if (channel.is_im === true) {
    if (channel.is_user_deleted === true) {
      return null
    }

    const user = users.byId.get(channel.user)
    const name = user?.name ?? channel.user
    const label = channel.user === myId ? `@${name} (you)` : `@${name}`

    return { id: channel.id, kind: `dm`, label, handle: user?.handle ?? channel.user }
  }

  if (channel.is_mpim === true) {
    // Named after everyone's handles, like "mpdm-jane--bob--bryan-1"
    const handles = channel.name.replace(/^mpdm-/, ``).replace(/-\d+$/, ``).split(`--`)
    const myHandle = users.byId.get(myId)?.handle

    const others = handles.filter(function (handle) {
      return handle !== myHandle
    })

    const names = others.map(function (handle) {
      const user = users.byHandle.get(handle)
      return `@${user?.name ?? handle}`
    })

    return { id: channel.id, kind: `group`, label: names.join(`, `), handle: null }
  }

  const kind = channel.is_private === true ? `private` : `channel`

  return { id: channel.id, kind, label: `#${channel.name}`, handle: null }
}

// Two people can have the same name, so a repeated label gets their handle, or the id
const makeLabelsUnique = function (conversations) {
  const counts = new Map()

  for (const conversation of conversations) {
    counts.set(conversation.label, (counts.get(conversation.label) ?? 0) + 1)
  }

  for (const conversation of conversations) {
    if (counts.get(conversation.label) > 1) {
      const extra = conversation.handle ?? conversation.id
      conversation.label = `${conversation.label} (${extra})`
    }
  }
}

// The order they're listed in: channels, then group DMs and DMs, each by label
const kindOrder = [`channel`, `private`, `group`, `dm`]

// The channels, group DMs and DMs the user is in, as [{ id, kind, label }], for choosing what
// rook reads. Archived ones are left out. Kept for a minute.
export const listMyConversations = async function (userId, signal) {
  const cacheKey = `slack:${userId}:conversations`
  const cached = caches.flash.get(cacheKey)

  if (cached != null) {
    return cached
  }

  const users = await getUsers(userId, signal)
  const myId = await getMyUserId(userId, signal)
  const conversations = []
  let cursor = ``

  do {
    const params = { types: `public_channel,private_channel,mpim,im`, exclude_archived: true, limit: 200, cursor }
    const body = await callSlack(userId, `users.conversations`, params, signal)

    for (const channel of body.channels) {
      const conversation = toConversation(channel, users, myId)

      if (conversation != null) {
        conversations.push(conversation)
      }
    }

    cursor = body.response_metadata?.next_cursor ?? ``
  } while (cursor !== ``)

  makeLabelsUnique(conversations)

  conversations.sort(function (a, b) {
    const kindDifference = kindOrder.indexOf(a.kind) - kindOrder.indexOf(b.kind)

    if (kindDifference !== 0) {
      return kindDifference
    }

    return a.label.localeCompare(b.label)
  })

  const listed = conversations.map(function (conversation) {
    return { id: conversation.id, kind: conversation.kind, label: conversation.label }
  })

  caches.flash.set(cacheKey, listed)

  return listed
}

// Slack's markup => plain text: "<@U123>" is a person, "<#C123|ops>" a channel, "<!here>" a
// mention of everyone, "<https://…|label>" a link; &, < and > are escaped
const formatText = function (text, users) {
  const replaced = text.replace(/<([^>]+)>/g, function (match, inner) {
    const barAt = inner.indexOf(`|`)
    const target = barAt === -1 ? inner : inner.slice(0, barAt)
    const label = barAt === -1 ? null : inner.slice(barAt + 1)

    if (target.startsWith(`@`)) {
      const user = users.byId.get(target.slice(1))
      return `@${user?.name ?? label ?? target.slice(1)}`
    }

    if (target.startsWith(`#`)) {
      return `#${label ?? target.slice(1)}`
    }

    // @here, @channel, a user group, or a date with how to show it
    if (target.startsWith(`!`)) {
      return label ?? `@${target.slice(1)}`
    }

    if (target.startsWith(`mailto:`)) {
      return label ?? target.slice(`mailto:`.length)
    }

    if (label == null || label === target) {
      return target
    }

    return `${label} (${target})`
  })

  return replaced.replaceAll(`&lt;`, `<`).replaceAll(`&gt;`, `>`).replaceAll(`&amp;`, `&`)
}

// "Nov 2, 2026, 1:30 PM" from a Slack timestamp ("1730563200.123456", in seconds), in the user's
// time zone
const describeTime = function (ts, timeZone) {
  const date = new Date(Number(ts) * 1000)
  return date.toLocaleString(`en-US`, { dateStyle: `medium`, timeStyle: `short`, timeZone })
}

const shorten = function (text) {
  const trimmed = text.trim()

  if (trimmed.length <= messageCharLimit) {
    return trimmed
  }

  return `${trimmed.slice(0, messageCharLimit)}…`
}

// Who wrote a message: their name, marked when it's the user, or the bot's name
const describeAuthor = function (message, users, myId) {
  if (message.user != null) {
    const name = users.byId.get(message.user)?.name ?? message.user
    return message.user === myId ? `${name} (the user)` : name
  }

  return message.username ?? message.bot_profile?.name ?? `A bot`
}

// A message's text, with what it carries that isn't text: files, and a bot's attachments when it
// has no text of its own
const describeContent = function (message, users) {
  let text = formatText(message.text ?? ``, users)

  const attachments = message.attachments ?? []

  if (text.trim() === `` && attachments.length > 0) {
    const first = attachments[0]
    text = formatText(first.fallback ?? first.text ?? first.title ?? ``, users)
  }

  const parts = [shorten(text)]
  const files = message.files ?? []

  if (files.length > 0) {
    const fileNames = files.map(function (file) {
      return file.title ?? file.name ?? `a file`
    })

    const noun = files.length === 1 ? `a file` : `${files.length} files`
    parts.push(`(with ${noun}: ${fileNames.join(`, `)})`)
  }

  const nonEmpty = parts.filter(function (part) {
    return part !== ``
  })

  return nonEmpty.join(` `)
}

// One line for a message: "- Nov 2, 2026, 1:30 PM, Jane Doe: text (3 replies)", its time in the
// user's zone
const describeMessage = function (message, users, myId, timeZone) {
  const author = describeAuthor(message, users, myId)
  const content = describeContent(message, users)
  const replyCount = message.reply_count ?? 0

  let line = `- ${describeTime(message.ts, timeZone)}, ${author}: ${content}`

  if (replyCount > 0) {
    line = `${line} (${replyCount} ${replyCount === 1 ? `reply` : `replies`})`
  }

  return line
}

const isShown = function (message) {
  return skippedSubtypes.includes(message.subtype) === false
}

// The latest replies in a thread, oldest first, without the message that started it
const readReplies = async function ({ userId, channelId, threadTs, signal }) {
  const body = await callSlack(userId, `conversations.replies`, { channel: channelId, ts: threadTs, limit: 200 }, signal)

  const replies = body.messages.filter(function (message) {
    return message.ts !== threadTs && isShown(message)
  })

  return replies.slice(-repliesPerThread)
}

// A conversation's messages as text for the model, read as the user, oldest first, each thread's
// latest replies indented under it, with times in `timeZone`, the user's. `oldest` is a Date to
// read from (or null for the latest messages); `limit` is the most messages, the newest kept;
// `threadLimit` how many of the newest threads get their replies. Returns { text, messageCount,
// hasMore }, where hasMore says older ones were left out.
export const readConversation = async function ({ userId, timeZone, channelId, oldest = null, limit, threadLimit, signal }) {
  const users = await getUsers(userId, signal)
  const myId = await getMyUserId(userId, signal)

  const params = { channel: channelId, limit }

  if (oldest != null) {
    params.oldest = String(oldest.getTime() / 1000)
  }

  const body = await callSlack(userId, `conversations.history`, params, signal)

  // Slack gives the newest first
  const messages = body.messages.filter(isShown).reverse()

  const threads = messages.filter(function (message) {
    return (message.reply_count ?? 0) > 0
  })

  const threadsWithReplies = threads.slice(-threadLimit)
  const repliesByTs = new Map()

  for (const thread of threadsWithReplies) {
    const replies = await readReplies({ userId, channelId, threadTs: thread.ts, signal })
    repliesByTs.set(thread.ts, replies)
  }

  const lines = []

  for (const message of messages) {
    lines.push(describeMessage(message, users, myId, timeZone))

    const replies = repliesByTs.get(message.ts) ?? []

    for (const reply of replies) {
      lines.push(`  ${describeMessage(reply, users, myId, timeZone)}`)
    }
  }

  return { text: lines.join(`\n`), messageCount: messages.length, hasMore: body.has_more === true }
}

// Searches Slack as the user and keeps the matches in `conversations` (their picks, as
// [{ id, label }]), newest first, up to `limit`. Search covers everything they can see, so this
// is what keeps it to the picked conversations. Returns { text, matchCount }.
export const searchMessages = async function ({ userId, timeZone, query, conversations, limit, signal }) {
  const users = await getUsers(userId, signal)
  const myId = await getMyUserId(userId, signal)

  const labelsById = new Map(conversations.map(function (conversation) {
    return [conversation.id, conversation.label]
  }))

  const lines = []
  let page = 1
  let pageCount = 1

  while (lines.length < limit && page <= pageCount && page <= searchPages) {
    const body = await callSlack(userId, `search.messages`, { query, sort: `timestamp`, count: 100, page }, signal)

    for (const match of body.messages.matches) {
      const label = labelsById.get(match.channel?.id)

      if (label == null || lines.length >= limit) {
        continue
      }

      const line = describeMessage(match, users, myId, timeZone).replace(/^- /, `- ${label}, `)
      lines.push(`${line} ${match.permalink}`)
    }

    pageCount = body.messages.paging?.pages ?? 1
    page += 1
  }

  return { text: lines.join(`\n`), matchCount: lines.length }
}

export default {
  isConfigured,
  checkToken,
  listMyConversations,
  readConversation,
  searchMessages,
}
