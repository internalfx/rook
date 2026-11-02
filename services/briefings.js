import cuid from 'cuid'
import db from './db.js'
import lemonade from './lemonade.js'
import settings from './settings.js'
import tools from '../ai-tools/index.js'
import memories from './memories.js'
import chats from './chats.js'
import tasks from './tasks.js'
import runs from './runs.js'
import notifications from './notifications.js'
import slack from './slack.js'
import { maxCallsPerTool, maxRounds, describeCallLimit } from '../ai-tools/limits.js'
import prompts from '../prompts.js'

// A briefing runs the chat model in the background, with no one watching: it looks over the
// memories, tasks, recent chats and Slack conversations picked in Settings, and what the previous
// briefing said, tidies the memories and
// tasks, and writes the user a short overview. Discuss on the Briefing page starts a chat with
// that overview as the model's first message. For something that matters now, it can notify the
// user (services/notifications.js). Briefings run on a schedule (see runIfDue) or when asked for.
//
// The running briefing lives in memory, like chat replies (services/runs.js), so restarting the
// server ends it.

// How many notifications one briefing can send
const maxNotifications = 2

// Older briefings are deleted
const keptBriefings = 5

// What the model is shown
const recentMemoryLimit = 30
const openTaskLimit = 50
const recentChatLimit = 5
// The tasks done in the last week, with their completion notes, so it knows what's been
// finished or dropped
const doneTaskLookBack = 1000 * 60 * 60 * 24 * 7
const doneTaskLimit = 20
const messagesPerChat = 10
const messageCharLimit = 600

// How far back it sees the notifications sent, so it doesn't repeat one from a few briefings ago
const notificationLookBack = 1000 * 60 * 60 * 24 * 14
const historyLimit = 20

// How far back the first briefing looks for chats; later ones look back to the last briefing
const firstLookBack = 1000 * 60 * 60 * 24 * 7

// Slack is read back to the last briefing, but no further than this, and each picked conversation
// gives at most its newest messages and the replies to its newest threads
const slackLookBack = 1000 * 60 * 60 * 24
const slackMessageLimit = 30
const slackThreadLimit = 3

// Used until an interval is chosen in Settings
export const defaultBriefingMinutes = 360

// The only chat tools a briefing has: it doesn't search the web or make images
const briefingToolNames = [
  `save_memory`, `search_memories`, `update_memory`, `delete_memory`,
  `add_task`, `find_tasks`, `update_task`, `complete_task`,
  `calculate`, `days_between`, `add_to_date`, `find_weekday`,
  `read_slack`, `search_slack`,
]

const insertBriefing = db.query(`
  INSERT INTO briefings (id, status, startedBy, startedAt)
  VALUES ($id, 'running', $startedBy, $now)
`)
const finishBriefingRow = db.query(`
  UPDATE briefings SET status = $status, overview = $overview, error = $error, steps = $steps, finishedAt = $now
  WHERE id = $id
`)
const failStaleBriefings = db.query(`
  UPDATE briefings SET status = 'failed', error = $error, finishedAt = $now WHERE status = 'running'
`)
const selectFinished = db.query(`
  SELECT * FROM briefings WHERE status != 'running' ORDER BY startedAt DESC LIMIT $limit OFFSET $offset
`)
const selectBriefing = db.query(`SELECT * FROM briefings WHERE id = $id`)
const selectLastDone = db.query(`SELECT startedAt FROM briefings WHERE status = 'done' ORDER BY startedAt DESC LIMIT 1`)
const selectPreviousDone = db.query(`SELECT * FROM briefings WHERE status = 'done' ORDER BY startedAt DESC LIMIT 1`)
const selectLastStarted = db.query(`SELECT startedAt FROM briefings ORDER BY startedAt DESC LIMIT 1`)
const deleteOldBriefings = db.query(`
  DELETE FROM briefings WHERE id NOT IN (SELECT id FROM briefings ORDER BY startedAt DESC LIMIT $keep)
`)

const selectLastFinishedAt = db.query(`SELECT MAX(finishedAt) AS finishedAt FROM briefings WHERE status != 'running'`)

// A briefing still marked running was cut off by a restart
failStaleBriefings.run({ error: `The server restarted during the briefing.`, now: new Date().toISOString() })

// The briefing running now, as { id, abort, finished }, or null. `finished` settles once it's
// saved.
let current = null

// What a cancelled briefing's error says, after "This briefing didn't finish:"
const cancelledError = `You cancelled it.`

const notifyUserTool = {
  type: `function`,
  function: {
    name: `notify_user`,
    description: prompts.tools.notify_user.description,
    parameters: {
      type: `object`,
      properties: {
        title: {
          type: `string`,
          description: prompts.tools.notify_user.parameters.title,
        },
        message: {
          type: `string`,
          description: prompts.tools.notify_user.parameters.message,
        },
        priority: {
          type: `string`,
          enum: [`normal`, `high`],
          description: prompts.tools.notify_user.parameters.priority,
        },
      },
      required: [`title`, `message`],
    },
  },
}

// "2026-11-01" from an ISO date
const formatDay = function (iso) {
  return iso.slice(0, 10)
}

// "Sunday, November 1, 2026 at 9:58 AM", or with `short`, "Nov 1, 2026, 9:58 AM", in the
// server's time zone, which is the owner's
const describeWhen = function (iso, short = false) {
  const dateStyle = short ? `medium` : `full`
  return new Date(iso).toLocaleString(`en-US`, { dateStyle, timeStyle: `short` })
}

const shorten = function (text, limit = messageCharLimit) {
  const trimmed = text.trim()

  if (trimmed.length <= limit) {
    return trimmed
  }

  return `${trimmed.slice(0, limit)}…`
}

// The searchable memories it can tidy, with their ids. Pinned ones are in the system message.
const describeMemories = function () {
  if (tools.isMemoriesOn() === false) {
    return `Memories are off in Settings, so you have none and can't save any.`
  }

  const recent = memories.listRecent(recentMemoryLimit)

  if (recent.length === 0) {
    return `You have no searchable memories yet.`
  }

  const lines = recent.map(function (memory) {
    return `- [${memory.id}] ${memory.content} (changed ${formatDay(memory.updatedAt)})`
  })

  return `Your searchable memories, most recently changed first (up to ${recentMemoryLimit}; find others with search_memories):\n${lines.join(`\n`)}`
}

const describeTaskLines = function (taskList) {
  const lines = taskList.map(function (task) {
    return `- ${tasks.describeForModel(task)}`
  })

  return lines.join(`\n`)
}

// The open tasks, most important first, then those done in the last week, with their ids so it
// can change them
const describeTasks = function () {
  if (tools.isTasksOn() === false) {
    return `Tasks are off in Settings, so you can't see or change them.`
  }

  const openTasks = tasks.listOpen()

  let text = `The to-do list is empty.`

  if (openTasks.length > 0) {
    const listed = openTasks.slice(0, openTaskLimit)

    text = `The tasks still to do, most important first (up to ${openTaskLimit}; find others with find_tasks):\n${describeTaskLines(listed)}`

    if (openTasks.length > listed.length) {
      text = `${text}\n…and ${openTasks.length - listed.length} more.`
    }
  }

  const since = new Date(Date.now() - doneTaskLookBack).toISOString()
  const doneTasks = tasks.listDoneSince(since, doneTaskLimit)

  if (doneTasks.length > 0) {
    text = `${text}\n\nDone in the last 7 days, most recent first (up to ${doneTaskLimit}):\n${describeTaskLines(doneTasks)}`
  }

  return text
}

// "(with 2 images)", for a message the user attached images to; briefings aren't shown them
const describeAttachedImages = function (message) {
  const count = message.imageIds?.length ?? 0

  if (count === 0) {
    return ``
  }

  return `(with ${count === 1 ? `an image` : `${count} images`})`
}

// A chat's title and its last few messages; tool calls and their results are left out
const describeChat = function (chat) {
  const savedMessages = chats.getMessages(chat.id)

  const textMessages = savedMessages.filter(function (message) {
    const isConversation = message.role === `user` || message.role === `assistant`
    return isConversation && (message.content.trim() !== `` || message.imageIds != null)
  })

  const lastMessages = textMessages.slice(-messagesPerChat)

  const lines = lastMessages.map(function (message) {
    const speaker = message.role === `user` ? `User` : `You`
    const text = [shorten(message.content), describeAttachedImages(message)].filter((part) => part !== ``)
    return `${speaker}: ${text.join(` `)}`
  })

  return `### ${chat.title ?? `Untitled chat`} (last active ${formatDay(chat.updatedAt)})\n${lines.join(`\n`)}`
}

// The last briefing that finished, and what it told the user
const describePreviousBriefing = function () {
  const previous = selectPreviousDone.get()

  if (previous == null) {
    return `There hasn't been a briefing before this one.`
  }

  return `From ${describeWhen(previous.startedAt)}.\n\nOverview: ${previous.overview ?? `(none)`}`
}

// Every notification from the last two weeks, whichever briefing sent it
const describeRecentNotifications = function () {
  const since = new Date(Date.now() - notificationLookBack).toISOString()
  const sent = notifications.listSentSince(since, historyLimit)

  if (sent.length === 0) {
    return `None in the last 14 days.`
  }

  const lines = sent.map(function (notification) {
    return `- ${describeWhen(notification.createdAt, true)}: "${notification.title}": ${notification.message}`
  })

  return `Newest first (up to ${historyLimit}):\n${lines.join(`\n`)}`
}

// The chats since the last briefing that finished, or from the past week before there was one
const describeRecentChats = function () {
  const lastDone = selectLastDone.get()
  const since = lastDone?.startedAt ?? new Date(Date.now() - firstLookBack).toISOString()

  const recent = chats.listChatsSince(since, recentChatLimit)

  if (recent.length === 0) {
    return `There haven't been any chats since ${formatDay(since)}.`
  }

  const sections = recent.map(describeChat)

  return `Chats since ${formatDay(since)}, most recent first (up to ${recentChatLimit}, each with its last ${messagesPerChat} messages):\n\n${sections.join(`\n\n`)}`
}

// What's been said in the picked Slack conversations since the last briefing (or the past day,
// whichever is shorter), leaving out quiet ones; null while Slack is off. A failure to read Slack
// is said in the section, so the briefing goes on without it.
const describeSlack = async function (signal) {
  const conversations = tools.getSlackChannels()

  if (conversations.length === 0) {
    return null
  }

  const lastDone = selectLastDone.get()
  const dayAgo = Date.now() - slackLookBack
  let sinceTime = dayAgo

  if (lastDone != null) {
    const lastDoneTime = new Date(lastDone.startedAt).getTime()
    sinceTime = Math.max(lastDoneTime, dayAgo)
  }

  const since = new Date(sinceTime)
  const sinceText = describeWhen(since.toISOString(), true)
  const sections = []

  try {
    // Read all at once; the sections keep the order of the picks
    const reads = conversations.map(function (conversation) {
      return slack.readConversation({
        channelId: conversation.id,
        oldest: since,
        limit: slackMessageLimit,
        threadLimit: slackThreadLimit,
        signal,
      })
    })

    const results = await Promise.all(reads)

    for (const [index, conversation] of conversations.entries()) {
      const result = results[index]

      if (result.messageCount > 0) {
        sections.push(`### ${conversation.label}\n${result.text}`)
      }
    }
  } catch (err) {
    if (signal.aborted === true) {
      throw err
    }

    console.error(`Reading Slack for a briefing failed`, err)
    return `Couldn't read Slack: ${err.message}`
  }

  const labels = conversations.map(function (conversation) {
    return conversation.label
  })

  if (sections.length === 0) {
    return `Nothing has been said since ${sinceText} in the user's Slack conversations at work that you follow (${labels.join(`, `)}).`
  }

  return `Messages since ${sinceText} in the user's Slack conversations at work that you follow, oldest first (up to ${slackMessageLimit} each, with replies to the newest ${slackThreadLimit} threads; quiet ones left out):\n\n${sections.join(`\n\n`)}`
}

// One system message, since some models' chat templates only accept one, at the start
const buildSystemMessage = function () {
  const memoriesMessage = tools.buildMemoriesMessage()

  let content = prompts.briefing.instructions

  if (memoriesMessage != null) {
    content = `${content}\n\n${memoriesMessage.content}`
  }

  return { role: `system`, content }
}

// What rook tells the model about the state of things, as the user's message. Pass `signal` to
// cancel reading Slack.
const buildContext = async function (signal) {
  const sections = [
    tools.describeCurrentTime(),
    `## Memories\n\n${describeMemories()}`,
    `## Tasks\n\n${describeTasks()}`,
    `## Your previous briefing\n\n${describePreviousBriefing()}`,
    `## Notifications you've sent recently\n\n${describeRecentNotifications()}`,
    `## Recent chats\n\n${describeRecentChats()}`,
  ]

  const slackText = await describeSlack(signal)

  if (slackText != null) {
    sections.push(`## Slack\n\n${slackText}`)
  }

  return sections.join(`\n\n`)
}

const notifyUser = async function ({ argumentsText, briefingId, state }) {
  if (state.notificationCount >= maxNotifications) {
    return `Not sent: a briefing can send at most ${maxNotifications} notifications.`
  }

  let args = null

  try {
    args = JSON.parse(argumentsText)
  } catch (err) {}

  args = args ?? {}

  const title = typeof args.title === `string` ? args.title.trim().slice(0, 120) : ``
  const message = typeof args.message === `string` ? args.message.trim() : ``
  const priority = args.priority === `high` ? `high` : `normal`

  if (title === `` || message === ``) {
    return `Not sent: a notification needs a title and a message.`
  }

  const notification = await notifications.sendNotification({ title, message, priority, briefingId })
  state.notificationCount += 1

  if (notification.pushStatus === `sent`) {
    return `Sent to the user's phone.`
  }

  if (notification.pushStatus === `failed`) {
    return `Saved in rook, but pushing it to their phone failed: ${notification.pushError}`
  }

  return `Saved in rook; phone notifications aren't set up.`
}

// Runs one tool call and returns what the model is told about it
const runBriefingTool = async function ({ call, briefingId, briefingTools, callCounts, state, isLastRound, signal }) {
  const name = call.function.name
  const argumentsText = call.function.arguments
  const callCount = (callCounts[name] ?? 0) + 1
  callCounts[name] = callCount

  // The calls still need answers, but there's no next round to use them in
  if (isLastRound) {
    return `Not run: the limit of replies for one briefing was reached.`
  }

  if (callCount > maxCallsPerTool) {
    return describeCallLimit(name, `briefing`)
  }

  if (name === `notify_user`) {
    return notifyUser({ argumentsText, briefingId, state })
  }

  // A memory tool, or a name the model made up, which runTool answers as turned off
  const result = await tools.runTool({ name, argumentsText, chatTools: briefingTools, chatId: null, signal })

  return result.content
}

// Runs the model until it replies without calling a tool, and returns that reply: the overview.
// Each tool call is added to `state.steps` as it's made, so a failed briefing keeps what it did.
const runBriefing = async function ({ briefingId, state, signal }) {
  const model = settings.get(`chatModel`)

  if (model == null) {
    throw new Error(`Choose a chat model in Settings first.`)
  }

  const chatTools = tools.getChatTools()
  const briefingTools = {}

  for (const name of briefingToolNames) {
    if (chatTools[name] != null) {
      briefingTools[name] = chatTools[name]
    }
  }

  const definitions = [...tools.getToolDefinitions(briefingTools), notifyUserTool]

  const context = await buildContext(signal)
  const messages = [buildSystemMessage(), { role: `user`, content: context }]

  // How many times the model has called each tool in this briefing, by name
  const callCounts = {}

  for (let round = 1; round <= maxRounds; round += 1) {
    const reply = await lemonade.completeChat({ model, messages, tools: definitions, signal })
    const content = reply.content ?? ``
    const toolCalls = reply.tool_calls ?? []

    if (toolCalls.length === 0) {
      return content.trim()
    }

    messages.push({ role: `assistant`, content, tool_calls: toolCalls })

    const isLastRound = round === maxRounds

    for (const call of toolCalls) {
      // A cancelled briefing doesn't go on to the rest of the round's calls
      signal.throwIfAborted()

      const result = await runBriefingTool({ call, briefingId, briefingTools, callCounts, state, isLastRound, signal })

      state.steps.push({ name: call.function.name, arguments: call.function.arguments, result })
      messages.push({ role: `tool`, tool_call_id: call.id, content: result })
    }
  }

  // Out of rounds before it wrote an overview
  return ``
}

// Runs the briefing and saves how it went. It never throws: a failure is saved on the briefing.
const executeBriefing = async function (briefing) {
  const state = { steps: [], notificationCount: 0 }

  let status = `done`
  let overview = null
  let error = null

  try {
    const reply = await runBriefing({ briefingId: briefing.id, state, signal: briefing.abort.signal })

    if (reply !== ``) {
      overview = reply
    }
  } catch (err) {
    status = `failed`

    if (briefing.abort.signal.aborted) {
      error = cancelledError
    } else {
      console.error(`Briefing failed`, err)
      error = err.message
    }
  }

  try {
    const steps = JSON.stringify(state.steps)
    finishBriefingRow.run({ id: briefing.id, status, overview, error, steps, now: new Date().toISOString() })
    deleteOldBriefings.run({ keep: keptBriefings })
  } catch (err) {
    console.error(`Saving the briefing failed`, err)
  } finally {
    current = null
  }
}

// Starts a briefing in the background and returns its id. `startedBy` is `schedule` or `manual`.
// Only one runs at a time; while one is running, its id is returned instead.
export const startBriefing = function ({ startedBy }) {
  if (current != null) {
    return current.id
  }

  const id = cuid()

  insertBriefing.run({ id, startedBy, now: new Date().toISOString() })

  current = { id, abort: new AbortController(), finished: null }
  current.finished = executeBriefing(current)

  return id
}

// Stops the running briefing, if there is one, and waits until it's saved. It's saved as failed,
// keeping what it did before then: its steps, and the notifications it sent.
export const cancelBriefing = async function () {
  const briefing = current

  if (briefing == null) {
    return
  }

  briefing.abort.abort()
  await briefing.finished
}

export const isRunning = function () {
  return current != null
}

export const isScheduleOn = function () {
  return settings.get(`briefingOn`) === true
}

export const getBriefingMinutes = function () {
  return settings.get(`briefingMinutes`) ?? defaultBriefingMinutes
}

// When the next scheduled briefing is due: briefingMinutes after the last one started, or now
// when there's never been one. Null while scheduled briefings are off.
export const getNextDue = function () {
  if (isScheduleOn() === false) {
    return null
  }

  const last = selectLastStarted.get()

  if (last == null) {
    return new Date()
  }

  const interval = getBriefingMinutes() * 60 * 1000
  const lastStart = new Date(last.startedAt).getTime()

  return new Date(lastStart + interval)
}

// Called every minute (see services/cron.js). Starts a scheduled briefing when one is due,
// but not while one is already running or a chat is replying, so it doesn't compete with the
// user for the model; it's tried again next time.
export const runIfDue = function () {
  const nextDue = getNextDue()

  if (nextDue == null || current != null) {
    return
  }

  if (settings.get(`chatModel`) == null || runs.hasActiveRuns()) {
    return
  }

  if (Date.now() < nextDue.getTime()) {
    return
  }

  startBriefing({ startedBy: `schedule` })
}

// steps comes back parsed
const toBriefing = function (row) {
  return { ...row, steps: JSON.parse(row.steps) }
}

// A briefing by id, or null
export const getBriefing = function (id) {
  const row = selectBriefing.get({ id })

  if (row == null) {
    return null
  }

  return toBriefing(row)
}

// The most recent briefing that has finished (done or failed), or null
export const getLatest = function () {
  const rows = selectFinished.all({ limit: 1, offset: 0 })

  if (rows.length === 0) {
    return null
  }

  return toBriefing(rows[0])
}

// The finished briefings before the latest one, most recent first
export const listEarlier = function (limit) {
  const rows = selectFinished.all({ limit, offset: 1 })
  return rows.map(toBriefing)
}

// Called when the Briefing page is shown, so its nav item stops saying there's something new
export const markViewed = function () {
  settings.set(`briefingViewedAt`, new Date().toISOString())
}

// Whether a briefing has finished (done or failed) since the Briefing page was last shown, for
// the dot on its nav item
export const hasUnseen = function () {
  const row = selectLastFinishedAt.get()

  if (row.finishedAt == null) {
    return false
  }

  const viewedAt = settings.get(`briefingViewedAt`)

  if (viewedAt == null) {
    return true
  }

  // Both are ISO dates, which compare in time order as text
  return row.finishedAt > viewedAt
}

export default {
  defaultBriefingMinutes,
  startBriefing,
  cancelBriefing,
  isRunning,
  isScheduleOn,
  getBriefingMinutes,
  getNextDue,
  runIfDue,
  getLatest,
  listEarlier,
  getBriefing,
  markViewed,
  hasUnseen,
}
