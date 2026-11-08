import chats from '../../../lib/chats.js'
import tasks from '../../../lib/tasks.js'
import { readReturnTo, toPageTask } from '../../../lib/taskForm.js'

// The model's first message in a chat about `task`: its title, priority and due date as the
// Tasks page words them (in `zone`, the user's time zone), and its notes, then a question for
// the user. It has no id; to change the task, the model finds it by title with find_tasks.
const describeTaskStart = function (task, zone) {
  const pageTask = toPageTask(task, zone)
  const parts = [`Let's talk about your task **${task.title}**.`]
  const details = []

  if (task.priority === `high`) {
    details.push(`High priority`)
  } else if (task.priority === `low`) {
    details.push(`Low priority`)
  }

  // "Due Thu 12 Nov", "Due today", "Due tomorrow", or "Overdue · Mon 2 Nov" as the page has it
  if (pageTask.dueState === `overdue`) {
    details.push(pageTask.dueLabel)
  } else if (pageTask.dueState != null) {
    details.push(`Due ${pageTask.dueState}`)
  } else if (pageTask.dueLabel != null) {
    details.push(`Due ${pageTask.dueLabel}`)
  }

  if (details.length > 0) {
    parts.push(details.join(` · `))
  }

  if (task.notes !== ``) {
    const quoted = task.notes.split(`\n`).map(function (line) {
      return `> ${line}`
    })

    parts.push(quoted.join(`\n`))
  }

  parts.push(`What would you like to discuss?`)

  return parts.join(`\n\n`)
}

// Form POST from an open task's Discuss button: opens a new chat where the model speaks first,
// with the task, as Discuss on a briefing does. The chat is titled after the user's first
// message, like any other.
export const POST = async function (ctx) {
  const userId = ctx.state.user.id
  const task = tasks.getTask(userId, ctx.state.params.id)

  if (task == null) {
    ctx.addFlash(`That task no longer exists.`, `error`)
    return ctx.redirect(readReturnTo(ctx.request.body))
  }

  const chat = chats.createChat(userId)

  chats.addMessage({ chatId: chat.id, role: `assistant`, content: describeTaskStart(task, ctx.state.user.timeZone) })

  return ctx.redirect(`/chat/${chat.id}`)
}
