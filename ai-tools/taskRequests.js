import config from '../configure.js'
import tasks from '../lib/tasks.js'
import taskRequests from '../lib/taskRequests.js'
import { isTasksOn, readTaskFields } from './tasks.js'
import { parseArguments } from './arguments.js'
import prompts from '../lib/prompts.js'

// request_task, list_task_requests and answer_task_request: asking someone else on this rook to
// do something, and answering what they ask (see lib/taskRequests.js). These are for chats, where
// the user is there to see what's sent in their name. Briefings and the checks on scheduled
// notifications don't get them: nothing that runs with no one watching sends to other people.

// On unless switched off in Admin → Tools, and only while tasks are
export const isTaskRequestsOn = function () {
  return isTasksOn() && config.tools?.taskRequests !== false
}

// The tools' settings for the user's chat: the others on this rook as the user has them, or null
// while requests are off or there's no one else to ask
const readSettings = function (user) {
  if (isTaskRequestsOn() === false) {
    return null
  }

  const people = taskRequests.listPeople(user)

  if (people.length === 0) {
    return null
  }

  return { people }
}

// request_task's definition names the people it can ask, each with the user's note about them.
// The descriptions are in lib/prompts.js.
const buildRequestTaskTool = function (toolSettings) {
  const people = toolSettings.people

  const peopleList = people.map(function (person) {
    return person.note === `` ? person.label : `${person.label} (${person.note.replace(/\s+/g, ` `)})`
  })

  return {
    type: `function`,
    function: {
      name: `request_task`,
      description: prompts.tools.request_task.description({ people: peopleList.join(`; `) }),
      parameters: {
        type: `object`,
        properties: {
          to: {
            type: `string`,
            enum: people.map(function (person) {
              return person.label
            }),
            description: prompts.tools.request_task.parameters.to,
          },
          title: {
            type: `string`,
            description: prompts.tools.request_task.parameters.title,
          },
          notes: {
            type: `string`,
            description: prompts.tools.request_task.parameters.notes,
          },
          priority: {
            type: `string`,
            enum: tasks.priorities,
            description: prompts.tools.request_task.parameters.priority,
          },
          due_date: {
            type: `string`,
            description: prompts.tools.request_task.parameters.due_date,
          },
        },
        required: [`to`, `title`],
      },
    },
  }
}

const listTaskRequestsTool = {
  type: `function`,
  function: {
    name: `list_task_requests`,
    description: prompts.tools.list_task_requests.description,
    parameters: {
      type: `object`,
      properties: {},
    },
  },
}

const answerTaskRequestTool = {
  type: `function`,
  function: {
    name: `answer_task_request`,
    description: prompts.tools.answer_task_request.description,
    parameters: {
      type: `object`,
      properties: {
        id: {
          type: `string`,
        },
        accept: {
          type: `boolean`,
          description: prompts.tools.answer_task_request.parameters.accept,
        },
        reason: {
          type: `string`,
          description: prompts.tools.answer_task_request.parameters.reason,
        },
      },
      required: [`id`, `accept`],
    },
  },
}

// The person the model named, by their label, however it's capitalized; null when there's none
const findPerson = function (people, name) {
  const wanted = typeof name === `string` ? name.trim().toLowerCase() : ``

  const person = people.find(function (candidate) {
    return candidate.label.toLowerCase() === wanted
  })

  return person ?? null
}

const runRequestTask = function ({ argumentsText, toolSettings, user, chatId }) {
  const args = parseArguments(argumentsText) ?? {}
  const person = findPerson(toolSettings.people, args.to)

  if (person == null) {
    const labels = toolSettings.people.map(function (candidate) {
      return candidate.label
    })

    return { content: `Not sent: there's no one called "${args.to}" on this ROOK. The people here: ${labels.join(`; `)}.`, imageId: null }
  }

  const { fields, problem } = readTaskFields(args)

  if (problem != null) {
    return { content: `Not sent: ${problem}.`, imageId: null }
  }

  if (fields.title == null) {
    return { content: `Not sent: no title was given.`, imageId: null }
  }

  const { outcome, request } = taskRequests.sendRequest({ ...fields, from: user, toUserId: person.id, chatId })

  if (outcome === `blocked`) {
    return { content: `Not sent: ${person.label} isn't taking task requests from the user. ${person.label} can allow them in their own Settings, under People.`, imageId: null }
  }

  if (outcome === `limit`) {
    return { content: `Not sent: the user has already sent ${person.label} ${taskRequests.maxPerDay} requests in the last 24 hours, which is the most allowed.`, imageId: null }
  }

  return {
    content: `Sent to ${person.label}: ${taskRequests.describeSent(request, user.timeZone)}\nTheir ROOK accepts it, declines it or leaves it for ${person.label} to answer, usually within a few minutes. Nothing comes back to this chat: the user's Tasks page and briefings show what happens, and list_task_requests does when they ask.`,
    imageId: null,
  }
}

const runListTaskRequests = function ({ user }) {
  const held = taskRequests.listHeld(user.id)
  const since = new Date(Date.now() - taskRequests.recentDays * 24 * 60 * 60 * 1000)
  const answered = taskRequests.listAnswered(user.id, since)
  const sent = taskRequests.listSent(user.id)

  const sections = []

  if (held.length > 0) {
    const lines = held.map(function (request) {
      return `- ${taskRequests.describeIncoming(request, user.timeZone)}`
    })

    sections.push(`Asked of the user, waiting for their answer:\n${lines.join(`\n`)}`)
  }

  if (answered.length > 0) {
    const lines = answered.map(function (request) {
      return `- ${taskRequests.describeIncoming(request, user.timeZone)}`
    })

    sections.push(`Asked of the user and answered in the last ${taskRequests.recentDays} days, most recent first:\n${lines.join(`\n`)}`)
  }

  if (sent.length > 0) {
    const lines = sent.map(function (request) {
      return `- ${taskRequests.describeSent(request, user.timeZone)}`
    })

    sections.push(`Asked of others by the user, most recent first:\n${lines.join(`\n`)}`)
  }

  if (sections.length === 0) {
    return { content: `There are no task requests: none waiting for the user, and none they've sent.`, imageId: null }
  }

  return { content: sections.join(`\n\n`), imageId: null }
}

const runAnswerTaskRequest = function ({ argumentsText, user }) {
  const args = parseArguments(argumentsText) ?? {}
  const id = typeof args.id === `string` ? args.id.trim() : ``
  const request = id === `` ? null : taskRequests.getIncoming(user.id, id)

  if (request == null) {
    return { content: `There's no task request to the user with the id "${args.id}".`, imageId: null }
  }

  if (typeof args.accept !== `boolean`) {
    return { content: `Not answered: accept must be true or false.`, imageId: null }
  }

  if (args.accept === true) {
    const accepted = taskRequests.accept(user.id, id, { by: `user` })

    if (accepted == null) {
      return { content: `Not accepted: that request isn't waiting for an answer. ${taskRequests.describeIncoming(request, user.timeZone)}`, imageId: null }
    }

    return { content: `Accepted, and added the task ${tasks.describeForModel(accepted.task, user.timeZone)}`, imageId: null }
  }

  const reason = typeof args.reason === `string` ? args.reason.trim() : ``
  const declined = taskRequests.decline(user.id, id, { by: `user`, note: reason })

  if (declined == null) {
    return { content: `Not declined: that request isn't waiting for an answer. ${taskRequests.describeIncoming(request, user.timeZone)}`, imageId: null }
  }

  return { content: `Declined ${request.fromName}'s request "${request.title}". They're shown that it was declined${reason === `` ? `` : `, and why`}.`, imageId: null }
}

export const tools = [
  {
    name: `request_task`,
    settings: readSettings,
    definition: buildRequestTaskTool,
    run: runRequestTask,
  },
  {
    name: `list_task_requests`,
    settings: (user) => (readSettings(user) == null ? null : {}),
    definition: () => listTaskRequestsTool,
    run: runListTaskRequests,
  },
  {
    name: `answer_task_request`,
    settings: (user) => (readSettings(user) == null ? null : {}),
    definition: () => answerTaskRequestTool,
    run: runAnswerTaskRequest,
  },
]

export default {
  isTaskRequestsOn,
  tools,
}
