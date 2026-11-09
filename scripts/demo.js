
// Adds a demo user, Bill, who runs a small print shop, with made-up chats, memories, tasks, a
// briefing and notifications: something to look at, test against or screenshot.
//   bun scripts/demo.js            adds the demo user, or replaces them with a fresh set
//   bun scripts/demo.js --remove   takes the demo user away, with everything that's theirs
//
// It opens data/rook.db, which is fine while the server is running. Only the demo user's rows are
// touched: an existing demo user is deleted the way scripts/users.js deletes one, image files
// included, so every run gives a clean set dated around today. The password is new each run and
// printed at the end. The demo user isn't an admin.
//
// The account is a real one, so scheduled briefings run for it when Admin → Briefings turns them on, and
// the notification it has scheduled is checked and sent by the model when its time comes (kept in
// rook only: the demo user has no ntfy topic).

import cuid from 'cuid'
import config from '../configure.js'
import db from '../lib/db.js'
import users from '../lib/users.js'
import settings from '../lib/settings.js'
import chats from '../lib/chats.js'
import memories from '../lib/memories.js'
import tasks from '../lib/tasks.js'
import notifications from '../lib/notifications.js'
import images from '../lib/images.js'
import { uniqueId } from '../lib/utils.js'

const demoEmail = `demo@rook.local`
const demoName = `Bill`

// A 192x192 four-colour PNG, the "logo idea" in one of the chats
const logoPng = `iVBORw0KGgoAAAANSUhEUgAAAMAAAADACAMAAABlApw1AAAADFBMVEUfKTc4vfj4+vz7vyRiKggKAAABbElEQVR42u3cQXLCMBQE0T/O/e+c7LJIKmAZV6ZF9wnmFWzAlmbMzMzMzMzMzMzMzMzMzL7Kz9DjQYg8ir2+25Dng8+vJCRoQVai7+8RZD36/gpBwhYkbEHCFiRsQcIWJGxBwhYkcAEd8HjU8V2h4MT65wxlgOM4K6jaf/xekWBpf5Ngbf8DAWB/jYAOWN9fIriw/2+BgPu/QRXfoUv7Gz4COiA3AiJAQD8gtwIiQICAvl/zZb/tBZQDcm1/ASCX9gt48Z+6p/dXAHJhfwcg6/tLACv/TpcBsri/B3D2CU0joPRhGR4w9P0CBDQLRsBbAIa+X0D5c1bCS0N4wND38wFD33+DYAT8r2BmfG/03QD4d6f5b6/zzw/wT3Dwz9DwTzHxz5HxT/Lxz1LyT7NucJ6Yf6J7gzP1/FsNNrhXYoObPXa4W2WH223MzGzjPm5OgAABAgQIECBAgAABvQAzMzMzMzMzMzMzMzMzeJ9VmDIX6LbP1wAAAABJRU5ErkJggg==`

// The seeded rows all get dated around today, so the pages look current whenever this runs
const now = new Date()
const zone = users.serverTimeZone

// A Date `days` from today at `hour` o'clock, server time
const at = function (days, hour, minute = 0) {
  const date = new Date(now)
  date.setDate(date.getDate() + days)
  date.setHours(hour, minute, 0, 0)
  return date
}

// "2026-11-12": the day `days` from today, for due dates
const dayOf = function (days) {
  return tasks.toDay(at(days, 12), zone)
}

// "Thursday"
const weekdayOf = function (days) {
  return new Intl.DateTimeFormat(`en-US`, { timeZone: zone, weekday: `long` }).format(at(days, 12))
}

// "Saturday, November 22"
const longDateOf = function (days) {
  return new Intl.DateTimeFormat(`en-US`, { timeZone: zone, weekday: `long`, month: `long`, day: `numeric` }).format(at(days, 12))
}

// Every create stamps the time it's called, so these put the rows back where they belong
const setChatTime = db.query(`UPDATE chats SET createdAt = $at, updatedAt = $at WHERE id = $id`)
const setMemoryTime = db.query(`UPDATE memories SET createdAt = $at, updatedAt = $at WHERE id = $id`)
const setTaskTime = db.query(`UPDATE tasks SET createdAt = $at, updatedAt = $at WHERE id = $id`)
const setTaskDoneTime = db.query(`UPDATE tasks SET doneAt = $at, updatedAt = $at WHERE id = $id`)
const setNotificationTime = db.query(`UPDATE notifications SET createdAt = $at WHERE id = $id`)

// Briefings are only ever written by the runner (services/briefings.js), so a finished one is
// inserted here directly
const insertBriefing = db.query(`
  INSERT INTO briefings (id, userId, status, startedBy, overview, transcript, startedAt, finishedAt)
  VALUES ($id, $userId, 'done', $startedBy, $overview, $transcript, $startedAt, $finishedAt)
`)

// A tool entry in a briefing's transcript, in the shape the Briefing page renders
const transcriptTool = function ({ name, content, query = null, taskTitle = null, memory = null }) {
  return {
    role: `tool`,
    toolCallId: `call_${cuid()}`,
    name,
    prompt: null,
    url: null,
    query,
    memory,
    taskTitle,
    channel: null,
    content,
    imageId: null,
    pending: false,
  }
}

// A chat's tool round trip, as routes/chat/send.js records one: the assistant's call, then the
// result as a tool message
const addToolCall = function ({ chatId, reasoning, name, args, result, imageId = null }) {
  const callId = `call_${cuid()}`

  chats.addMessage({
    chatId,
    role: `assistant`,
    content: ``,
    reasoning,
    toolCalls: [{ id: callId, type: `function`, function: { name, arguments: JSON.stringify(args) } }],
  })

  chats.addMessage({ chatId, role: `tool`, content: result, toolCallId: callId, imageId })
}

const describeList = function (list) {
  return list.map((task) => `- ${tasks.describeForModel(task, zone)}`).join(`\n`)
}

// What find_tasks answers with no query: open tasks soonest due first, then the recent done ones
const findTasksResult = function (userId) {
  const open = describeList(tasks.listOpen(userId))
  const done = describeList(tasks.listDone(userId, 5))

  return `The to-do list, soonest due first, then the tasks done most recently:\n\n${open}\n${done}`
}

// MEMORIES
const seedMemories = function (userId) {
  const pinned = [
    `Inkwell Print Co. is open 8 to 5, Monday to Friday. Dev runs the press; Marisol does the front counter and the design work.`,
    `Keep replies short, with the numbers first.`,
    `Tomas Reyes is the accountant. Quarterly filings are due on the 15th, and he wants the receipts a week before.`,
  ]

  const searchable = [
    `Hartwell Realty's standing order is 2,000 flyers on the 1st of each month, 100lb gloss, invoiced net 30.`,
    `Maya's winter recital is on ${longDateOf(12)} at 6pm.`,
    `Northfield Paper's rep is Janelle; the account number ends in 4471.`,
    `Mrs. Okafor at the bakery prefers a phone call to an email.`,
    `Rush jobs are quoted at 15% on top of the normal price.`,
    `The Heidelberg's rollers are changed every 40,000 impressions; the last change was about two months ago.`,
    `Bill's coffee: a large flat white, no sugar, from Carraway's on the corner.`,
  ]

  let daysAgo = 34

  for (const content of pinned) {
    const memory = memories.createMemory({ userId, content, pinned: true })
    setMemoryTime.run({ id: memory.id, at: at(-daysAgo, 10).toISOString() })
    daysAgo -= 3
  }

  for (const content of searchable) {
    const memory = memories.createMemory({ userId, content })
    setMemoryTime.run({ id: memory.id, at: at(-daysAgo, 14).toISOString() })
    daysAgo -= 3
  }
}

// TASKS
const seedTasks = function (userId) {
  const open = [
    { title: `Send the Hartwell invoice`, priority: `high`, due: -2, notes: `October run, 2,000 flyers. Net 30.`, made: -9 },
    { title: `Call the landlord about the back door`, due: -1, notes: `The latch sticks again; it's in the lease.`, made: -6 },
    { title: `Order 80lb matte stock from Northfield Paper`, priority: `high`, due: 0, notes: `For the Okafor menus. 3 cases.`, made: -4 },
    { title: `Pay the electric bill`, due: 0, made: -12 },
    { title: `Pick up Maya's recital outfit from the cleaners`, due: 1, made: -3 },
    { title: `Change the press rollers`, due: 3, notes: `Due at 40,000 impressions; we're at 38,600.`, made: -7 },
    { title: `Send Tomas the Q3 receipts`, priority: `high`, due: 4, made: -5 },
    { title: `Renew the business licence`, due: 8, notes: `Online renewal; have last year's number ready.`, made: -15 },
    { title: `Quote the Lindqvist wedding invitations`, priority: `low`, due: 10, notes: `120 invitations, letterpress look, cream stock.`, made: -2 },
    { title: `Look into a second cutter`, priority: `low`, made: -20 },
    { title: `Update the price list on the website`, priority: `low`, made: -11 },
  ]

  const done = [
    { title: `Deliver the Okafor menus`, made: -8, doneDaysAgo: 2, note: `Dropped off Tuesday afternoon. She wants 50 more next month.` },
    { title: `Fix the jam on the folding machine`, priority: `high`, made: -5, doneDaysAgo: 4, note: `A bent guide. Straightened it; order a spare.` },
    { title: `Reply to the Chamber of Commerce about the mixer`, made: -9, doneDaysAgo: 6, note: `Going. Bringing business cards.` },
  ]

  for (const item of open) {
    const task = tasks.createTask({
      userId,
      title: item.title,
      notes: item.notes ?? ``,
      priority: item.priority ?? `normal`,
      dueDate: item.due == null ? null : dayOf(item.due),
    })

    setTaskTime.run({ id: task.id, at: at(item.made, 9).toISOString() })
  }

  for (const item of done) {
    const task = tasks.createTask({ userId, title: item.title, priority: item.priority ?? `normal` })

    tasks.setDone(userId, task.id, true, item.note)
    setTaskTime.run({ id: task.id, at: at(item.made, 9).toISOString() })
    setTaskDoneTime.run({ id: task.id, at: at(-item.doneDaysAgo, 16).toISOString() })
  }
}

// CHATS
const seedChats = async function (userId) {
  // This morning: what's due, then a task added from the chat
  const planning = chats.createChat(userId)
  chats.setTitle(planning.id, `This week's deadlines`)

  chats.addMessage({ chatId: planning.id, role: `user`, content: `What's due this week?` })
  addToolCall({
    chatId: planning.id,
    reasoning: `Bill wants this week's deadlines. I'll pull the list rather than guess at it.`,
    name: `find_tasks`,
    args: {},
    result: findTasksResult(userId),
  })
  chats.addMessage({
    chatId: planning.id,
    role: `assistant`,
    reasoning: `Two are overdue, two are due today. Lead with those, then the rest of the week, briefly.`,
    content: [
      `Two are already late:`,
      ``,
      `- **Hartwell invoice**, 2 days overdue`,
      `- **Landlord, back door**, due yesterday`,
      ``,
      `Today: the Northfield stock order and the electric bill. Tomorrow: Maya's outfit from the cleaners. ${weekdayOf(3)}: the press rollers. ${weekdayOf(4)}: Tomas's Q3 receipts.`,
      ``,
      `Want the invoice moved to the top?`,
    ].join(`\n`),
  })

  chats.addMessage({ chatId: planning.id, role: `user`, content: `Add a task to send Hartwell the November proof by ${weekdayOf(3)}` })

  const proofTask = tasks.createTask({ userId, title: `Send Hartwell the November proof`, priority: `high`, dueDate: dayOf(3), chatId: planning.id })

  addToolCall({
    chatId: planning.id,
    reasoning: `A new task, due ${dayOf(3)}. High priority: it's a client deliverable before their monthly run.`,
    name: `add_task`,
    args: { title: proofTask.title, priority: `high`, due_date: dayOf(3) },
    result: `Added the task ${tasks.describeForModel(proofTask, zone)}`,
  })
  chats.addMessage({
    chatId: planning.id,
    role: `assistant`,
    reasoning: `Confirm in one line.`,
    content: `Done: **Send Hartwell the November proof**, high priority, due ${weekdayOf(3)}.`,
  })
  setChatTime.run({ id: planning.id, at: at(0, 9, 12).toISOString() })

  // Yesterday: a quote worked out with the calculator
  const quote = chats.createChat(userId)
  chats.setTitle(quote.id, `Flyer quote with rush`)

  chats.addMessage({ chatId: quote.id, role: `user`, content: `What should I charge for 500 flyers at 0.34 each with the 15% rush, split over 3 payments?` })
  addToolCall({
    chatId: quote.id,
    reasoning: `Quantity times unit price, plus 15%, divided by three. I'll calculate it rather than do it in my head.`,
    name: `calculate`,
    args: { expression: `(500 * 0.34 * 1.15) / 3` },
    result: `(500 * 0.34 * 1.15) / 3 = 65.1666666666667`,
  })
  chats.addMessage({
    chatId: quote.id,
    role: `assistant`,
    reasoning: `Round to cents and give the total as well as the instalment.`,
    content: `**$195.50 total, or 3 payments of $65.17.**\n\nThat's 500 × $0.34 = $170.00, plus the 15% rush = $195.50.`,
  })
  setChatTime.run({ id: quote.id, at: at(-1, 14, 40).toISOString() })

  // Three days ago: a logo idea, with the image the tool made
  const logo = chats.createChat(userId)
  chats.setTitle(logo.id, `Logo idea`)

  const imageId = await images.saveImage(Buffer.from(logoPng, `base64`))

  chats.addMessage({ chatId: logo.id, role: `user`, content: `Sketch me a simple logo idea for the shop. Dark background, an ink drop.` })
  addToolCall({
    chatId: logo.id,
    reasoning: `A logo sketch. Keep the description plain: one shape, flat colours, no text.`,
    name: `generate_image`,
    args: { prompt: `A minimal logo for a print shop called Inkwell Print Co.: a round ink drop on a dark navy background, flat colours, no text` },
    result: `The image was created and is already shown to the user. Don't include a link or markdown image for it in your reply.`,
    imageId,
  })
  chats.addMessage({
    chatId: logo.id,
    role: `assistant`,
    reasoning: `Describe it in a sentence and offer the obvious next tries.`,
    content: `A first idea: a round drop with a highlight, on dark navy. Say the word and I'll try a warmer palette or add the name under it.`,
  })
  setChatTime.run({ id: logo.id, at: at(-3, 10, 5).toISOString() })

  // Five days ago: something worth remembering, saved as a memory from the chat
  const lead = chats.createChat(userId)
  chats.setTitle(lead.id, `Northfield lead time`)

  const leadMemory = memories.createMemory({
    userId,
    content: `Northfield Paper takes five working days to deliver; order stock the week before a big run.`,
    chatId: lead.id,
  })
  setMemoryTime.run({ id: leadMemory.id, at: at(-5, 15, 20).toISOString() })

  chats.addMessage({ chatId: lead.id, role: `user`, content: `Remember that Northfield takes five working days to deliver, so I need to order the week before a big run.` })
  addToolCall({
    chatId: lead.id,
    reasoning: `Worth keeping: it decides when stock gets ordered. Searchable, not pinned; it only matters when orders come up.`,
    name: `save_memory`,
    args: { content: leadMemory.content, pinned: false },
    result: `Saved memory [${leadMemory.id}] (searchable).`,
  })
  chats.addMessage({
    chatId: lead.id,
    role: `assistant`,
    reasoning: `Confirm briefly.`,
    content: `Saved. I'll bring it up when a stock order comes up.`,
  })
  setChatTime.run({ id: lead.id, at: at(-5, 15, 20).toISOString() })

  return { planning }
}

// BRIEFINGS
const seedBriefings = function (userId) {
  // Yesterday's, so the page has an earlier one
  const yesterday = cuid()

  insertBriefing.run({
    id: yesterday,
    userId,
    startedBy: `schedule`,
    overview: [
      `Morning. The **Hartwell invoice** went past due yesterday; nothing else is late.`,
      ``,
      `Today's the folding machine fix and the Okafor menus delivery. The rollers are at 38,400 impressions, so there's room for this week's small jobs before the change.`,
    ].join(`\n`),
    transcript: JSON.stringify([
      { role: `assistant`, reasoning: `Check the list and anything new in the memories before writing.`, content: `` },
      transcriptTool({ name: `find_tasks`, content: `The to-do list, soonest due first, then the tasks done most recently:\n\n(as it stood yesterday)` }),
      { role: `assistant`, reasoning: `One overdue, two due today. Short overview.`, content: `` },
    ]),
    startedAt: at(-1, 6).toISOString(),
    finishedAt: at(-1, 6, 3).toISOString(),
  })

  // This morning's: it read the list, looked up a memory, and added a task
  const morning = cuid()

  const followUp = tasks.createTask({ userId, title: `Print 50 more Okafor menus`, priority: `low`, notes: `From the completion note on the delivery: she wants 50 more next month.` })
  setTaskTime.run({ id: followUp.id, at: at(0, 6, 2).toISOString() })

  insertBriefing.run({
    id: morning,
    userId,
    startedBy: `schedule`,
    overview: [
      `Good morning. Two things are late: the **Hartwell invoice** (two days) and the **landlord call** about the back door. Today: order the Northfield stock for the Okafor menus, and pay the electric bill.`,
      ``,
      `**Deliver the Okafor menus** was finished on Tuesday. Its note says she wants 50 more next month, so I've added a low-priority task for that.`,
      ``,
      `One to watch: the press is at 38,600 impressions and the rollers are due at 40,000. The Hartwell run on the 1st would take you past it.`,
    ].join(`\n`),
    transcript: JSON.stringify([
      { role: `assistant`, reasoning: `Start with the task list, then see what the memories say about anything that stands out.`, content: `` },
      transcriptTool({ name: `find_tasks`, content: findTasksResult(userId) }),
      { role: `assistant`, reasoning: `The Okafor delivery is done with a note about a reorder. Check what's known about her before adding anything.`, content: `` },
      transcriptTool({
        name: `search_memories`,
        query: `Okafor`,
        content: `The memories closest to "Okafor", closest first. Ignore any that aren't about it.\n\n1. Mrs. Okafor at the bakery prefers a phone call to an email.`,
      }),
      transcriptTool({
        name: `add_task`,
        taskTitle: followUp.title,
        content: `Added the task ${tasks.describeForModel(followUp, zone)}`,
      }),
      { role: `assistant`, reasoning: `Two overdue, two due today, one thing to watch on the press. Keep it to three short paragraphs.`, content: `` },
    ]),
    startedAt: at(0, 6).toISOString(),
    finishedAt: at(0, 6, 4).toISOString(),
  })

  return { morning }
}

// NOTIFICATIONS
const seedNotifications = async function (userId, { morning, planning }) {
  const late = await notifications.sendNotification({
    userId,
    title: `Hartwell invoice is two days late`,
    message: `The October invoice for 2,000 flyers hasn't gone out. It's net 30, so every day pushes payment back.`,
    priority: `high`,
    briefingId: morning,
  })
  setNotificationTime.run({ id: late.id, at: at(0, 6, 4).toISOString() })

  const rollers = await notifications.sendNotification({
    userId,
    title: `Press rollers at 38,600`,
    message: `About 1,400 impressions before the rollers are due. The Hartwell run on the 1st would take you past.`,
  })
  setNotificationTime.run({ id: rollers.id, at: at(-3, 11, 30).toISOString() })

  notifications.scheduleNotification({
    userId,
    title: `Maya's outfit is at the cleaners`,
    message: `The recital outfit is ready to pick up, and the cleaners close at 6.`,
    sendAt: at(1, 9),
    checkNote: `Skip it if the task to pick up the outfit from the cleaners is already done.`,
    chatId: planning.id,
  })
}

// RUN
const existing = users.findLogin(demoEmail)

if (existing != null) {
  users.deleteUser(existing.id)
  console.log(`Removed the demo user and everything that was theirs.`)
}

if (process.argv.includes(`--remove`)) {
  if (existing == null) {
    console.log(`There was no demo user.`)
  }

  process.exit(0)
}

const password = uniqueId(12).toLowerCase()
const user = await users.createUser({ name: demoName, email: demoEmail, password })

settings.set(user.id, `timeZone`, zone)

seedMemories(user.id)
seedTasks(user.id)
const { planning } = await seedChats(user.id)
const { morning } = seedBriefings(user.id)
await seedNotifications(user.id, { morning, planning })

console.log(``)
console.log(`Demo user ready. Log in at http://localhost:${config.port} as`)
console.log(`  ${demoEmail} / ${password}`)
console.log(``)
console.log(`Run this again for a fresh set, or with --remove to take the demo user away.`)

process.exit(0)
