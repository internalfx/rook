// Replies in progress ("runs"), one per chat at most. A run belongs to the server, not to the
// browser that started it: leaving the page only stops watching, and coming back to the chat
// watches it again. Each run keeps every event it has sent, so a late watcher can replay them
// and draw the reply exactly as far as it has got, then follow it live.
//
// Runs live in memory, so restarting the server ends any reply in progress (what was saved by
// then stays saved).

// How often to send a watcher a keep-alive line while nothing else is being sent. Nothing is
// sent while a tool runs, which can be minutes for a slow image model, and an idle connection
// may be dropped. A comment line (": ...") keeps it active; browsers only read "data:" lines.
const keepAliveInterval = 1000 * 15

const runsByChatId = new Map()

// A run that isn't kept with the chats: a briefing's (see services/briefings.js), which is
// watched the same way. `startRun` makes a chat's with it.
export const newRun = function ({ chatId = null, baseCount = 0 } = {}) {
  return {
    chatId,
    baseCount,
    abort: new AbortController(),
    events: [],
    watchers: new Set(),
  }
}

// `baseCount` is how many messages the chat had saved when the run started, counting the
// user's new message; the page shows those, then replays the run's events after them
export const startRun = function ({ chatId, baseCount }) {
  if (runsByChatId.has(chatId)) {
    throw new Error(`This chat is still replying.`)
  }

  const run = newRun({ chatId, baseCount })

  runsByChatId.set(chatId, run)

  return run
}

export const getRun = function (chatId) {
  return runsByChatId.get(chatId) ?? null
}

// Whether any chat is replying right now; scheduled briefings wait until none is
export const hasActiveRuns = function () {
  return runsByChatId.size > 0
}

// Stops the chat's run, if it has one. Returns whether there was one.
export const stopRun = function (chatId) {
  const run = runsByChatId.get(chatId)

  if (run == null) {
    return false
  }

  run.abort.abort()

  return true
}

const writeEvent = function (output, event) {
  if (output.writable) {
    output.write(`data: ${JSON.stringify(event)}\n\n`)
  }
}

export const emit = function (run, event) {
  run.events.push(event)

  for (const watcher of run.watchers) {
    writeEvent(watcher.output, event)
  }
}

// Ends every watcher's stream and forgets the run
export const finishRun = function (run) {
  for (const watcher of run.watchers) {
    clearInterval(watcher.keepAlive)
    watcher.output.end()
  }

  run.watchers.clear()

  if (runsByChatId.get(run.chatId) === run) {
    runsByChatId.delete(run.chatId)
  }
}

// Streams the run into `output` (a PassThrough sent to the browser): every event so far, then
// each new one, ending when the run does. Call `stopWatching` when the browser goes away.
export const watchRun = function (run, output) {
  const watcher = { output, keepAlive: null }

  for (const event of run.events) {
    writeEvent(output, event)
  }

  watcher.keepAlive = setInterval(function () {
    if (output.writable) {
      output.write(`: keep-alive\n\n`)
    }
  }, keepAliveInterval)

  run.watchers.add(watcher)

  const stopWatching = function () {
    clearInterval(watcher.keepAlive)
    run.watchers.delete(watcher)
  }

  return stopWatching
}

export default {
  newRun,
  startRun,
  getRun,
  hasActiveRuns,
  stopRun,
  emit,
  finishRun,
  watchRun,
}
