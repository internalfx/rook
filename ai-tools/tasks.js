import config from '../configure.js'
import tasks from '../services/tasks.js'
import { getEmbeddingModel } from './memories.js'
import { parseArguments } from './arguments.js'
import prompts from '../prompts.js'

// add_task, find_tasks, update_task and complete_task: the user's to-do list (see
// services/tasks.js)

// Tasks are on unless switched off in config.js
export const isTasksOn = function () {
  return config.tools?.tasks !== false
}

// The descriptions are in prompts.js
const addTaskTool = {
  type: `function`,
  function: {
    name: `add_task`,
    description: prompts.tools.add_task.description,
    parameters: {
      type: `object`,
      properties: {
        title: {
          type: `string`,
          description: prompts.tools.add_task.parameters.title,
        },
        notes: {
          type: `string`,
          description: prompts.tools.add_task.parameters.notes,
        },
        priority: {
          type: `string`,
          enum: tasks.priorities,
          description: prompts.tools.add_task.parameters.priority,
        },
        due_date: {
          type: `string`,
          description: prompts.tools.add_task.parameters.due_date,
        },
      },
      required: [`title`],
    },
  },
}

const findTasksTool = {
  type: `function`,
  function: {
    name: `find_tasks`,
    description: prompts.tools.find_tasks.description,
    parameters: {
      type: `object`,
      properties: {
        query: {
          type: `string`,
          description: prompts.tools.find_tasks.parameters.query,
        },
      },
    },
  },
}

const updateTaskTool = {
  type: `function`,
  function: {
    name: `update_task`,
    description: prompts.tools.update_task.description,
    parameters: {
      type: `object`,
      properties: {
        id: {
          type: `string`,
        },
        title: {
          type: `string`,
        },
        notes: {
          type: `string`,
          description: prompts.tools.update_task.parameters.notes,
        },
        priority: {
          type: `string`,
          enum: tasks.priorities,
          description: prompts.tools.update_task.parameters.priority,
        },
        due_date: {
          type: `string`,
          description: prompts.tools.update_task.parameters.due_date,
        },
      },
      required: [`id`],
    },
  },
}

const completeTaskTool = {
  type: `function`,
  function: {
    name: `complete_task`,
    description: prompts.tools.complete_task.description,
    parameters: {
      type: `object`,
      properties: {
        id: {
          type: `string`,
        },
        done: {
          type: `boolean`,
          description: prompts.tools.complete_task.parameters.done,
        },
        note: {
          type: `string`,
          description: prompts.tools.complete_task.parameters.note,
        },
      },
      required: [`id`],
    },
  },
}

// The title, notes, priority and due date the model gave add_task or update_task, checked. Each
// is left out of `fields` when the model left it out; an empty due date removes it. Returns
// { fields }, or { problem } saying what's wrong, to tell the model.
const readTaskFields = function (args) {
  const fields = {}

  if (args.title !== undefined) {
    const title = typeof args.title === `string` ? args.title.trim() : ``

    if (title === ``) {
      return { problem: `the title is empty` }
    }

    fields.title = title.slice(0, 200)
  }

  if (args.notes !== undefined) {
    fields.notes = typeof args.notes === `string` ? args.notes.trim() : ``
  }

  if (args.priority !== undefined) {
    if (tasks.priorities.includes(args.priority) === false) {
      return { problem: `priority must be high, normal or low` }
    }

    fields.priority = args.priority
  }

  if (args.due_date !== undefined) {
    const dueDate = typeof args.due_date === `string` ? args.due_date.trim() : ``

    if (dueDate === ``) {
      fields.dueDate = null
    } else if (tasks.isValidDay(dueDate)) {
      fields.dueDate = dueDate
    } else {
      return { problem: `due_date must be a real day written as YYYY-MM-DD` }
    }
  }

  return { fields }
}

// The task with the id the model gave, or null
const findTaskById = function (user, args) {
  if (typeof args.id !== `string`) {
    return null
  }

  return tasks.getTask(user.id, args.id.trim())
}

// Each task on a line, its due date in `zone`, the user's time zone
const describeTaskList = function (taskList, zone) {
  const lines = taskList.map(function (task) {
    return `- ${tasks.describeForModel(task, zone)}`
  })

  return lines.join(`\n`)
}

// The most tasks find_tasks lists at once, and how many recently done ones it lists after the
// open ones
const maxListedTasks = 50
const recentDoneLimit = 20

const runAddTask = function ({ argumentsText, user, chatId }) {
  const args = parseArguments(argumentsText) ?? {}
  const { fields, problem } = readTaskFields(args)

  if (problem != null) {
    return { content: `The task wasn't added: ${problem}.`, imageId: null }
  }

  if (fields.title == null) {
    return { content: `The task wasn't added: no title was given.`, imageId: null }
  }

  const task = tasks.createTask({ ...fields, userId: user.id, chatId })

  return { content: `Added the task ${tasks.describeForModel(task, user.timeZone)}`, imageId: null }
}

// How many tasks find_tasks gives as close in meaning, besides those containing the query's words
const closeTaskLimit = 5

// What find_tasks says for a query: the tasks containing its words, then the closest in meaning
// that aren't among those. Done tasks are always searched too, so the model can find one the
// user has finished. Searching by meaning needs an embedding model; when it fails, the keyword
// matches are still given, and the model is told why.
const describeTaskSearch = async function ({ user, query, embeddingModel, signal }) {
  const userId = user.id
  const wordMatches = tasks.searchTasks({ userId, query, includeDone: true })

  let meaningMatches = []
  let meaningProblem = null

  if (embeddingModel != null) {
    try {
      const closest = await tasks.searchByMeaning({
        userId,
        query,
        model: embeddingModel,
        includeDone: true,
        limit: closeTaskLimit + wordMatches.length,
        signal,
      })

      const wordMatchIds = new Set(wordMatches.map(function (task) {
        return task.id
      }))

      meaningMatches = closest.filter(function (task) {
        return wordMatchIds.has(task.id) === false
      }).slice(0, closeTaskLimit)
    } catch (err) {
      if (signal.aborted === true) {
        throw err
      }

      console.error(`Searching tasks by meaning failed`, err)
      meaningProblem = err.message
    }
  }

  const sections = []

  if (wordMatches.length > 0) {
    sections.push(`Containing those words, best matches first:\n${describeTaskList(wordMatches, user.timeZone)}`)
  }

  if (meaningMatches.length > 0) {
    sections.push(`Close in meaning, closest first. Ignore any that aren't about it:\n${describeTaskList(meaningMatches, user.timeZone)}`)
  }

  if (sections.length === 0) {
    sections.push(`No tasks match "${query}".`)
  }

  if (meaningProblem != null) {
    sections.push(`(Searching by meaning failed, so only words were matched: ${meaningProblem})`)
  }

  return `Tasks for "${query}":\n\n${sections.join(`\n\n`)}`
}

const runFindTasks = async function ({ argumentsText, toolSettings, user, signal }) {
  const args = parseArguments(argumentsText) ?? {}
  const query = typeof args.query === `string` ? args.query.trim() : ``

  if (query !== ``) {
    const embeddingModel = toolSettings.embeddingModel ?? null
    const content = await describeTaskSearch({ user, query, embeddingModel, signal })

    return { content, imageId: null }
  }

  // The open tasks, then the ones done most recently
  const taskList = [...tasks.listOpen(user.id), ...tasks.listDone(user.id, recentDoneLimit)]

  if (taskList.length === 0) {
    return { content: `The to-do list is empty.`, imageId: null }
  }

  const listed = taskList.slice(0, maxListedTasks)
  let content = `The to-do list, soonest due first, then the tasks done most recently:\n\n${describeTaskList(listed, user.timeZone)}`

  if (taskList.length > listed.length) {
    content = `${content}\n\n…and ${taskList.length - listed.length} more. Search with a query to find others.`
  }

  return { content, imageId: null }
}

const runUpdateTask = function ({ argumentsText, user }) {
  const args = parseArguments(argumentsText) ?? {}
  const task = findTaskById(user, args)

  if (task == null) {
    return { content: `There's no task with the id "${args.id}".`, imageId: null }
  }

  const { fields, problem } = readTaskFields(args)

  if (problem != null) {
    return { content: `The task wasn't changed: ${problem}.`, imageId: null }
  }

  // Whatever the model leaves out stays as it is
  const updated = tasks.updateTask(user.id, task.id, {
    title: fields.title ?? task.title,
    notes: fields.notes ?? task.notes,
    priority: fields.priority ?? task.priority,
    dueDate: fields.dueDate === undefined ? task.dueDate : fields.dueDate,
  })

  return { content: `Updated the task ${tasks.describeForModel(updated, user.timeZone)}`, imageId: null }
}

const runCompleteTask = function ({ argumentsText, user }) {
  const args = parseArguments(argumentsText) ?? {}
  const task = findTaskById(user, args)

  if (task == null) {
    return { content: `There's no task with the id "${args.id}".`, imageId: null }
  }

  const done = args.done !== false
  const note = typeof args.note === `string` ? args.note.trim().slice(0, tasks.maxDoneNoteLength) : null
  const updated = tasks.setDone(user.id, task.id, done, note)
  const description = tasks.describeForModel(updated, user.timeZone)

  if (done) {
    return { content: `Marked done: ${description}`, imageId: null }
  }

  return { content: `Put back on the to-do list: ${description}`, imageId: null }
}

// Offered only while tasks are on. The model can't delete tasks; only the user can, on the
// Tasks page.
export const tools = [
  {
    name: `add_task`,
    settings: () => (isTasksOn() ? {} : null),
    definition: () => addTaskTool,
    run: runAddTask,
  },
  {
    name: `find_tasks`,
    // Searches by meaning too while there's an embedding model, the one memories use
    settings: () => (isTasksOn() ? { embeddingModel: getEmbeddingModel() } : null),
    definition: () => findTasksTool,
    run: runFindTasks,
  },
  {
    name: `update_task`,
    settings: () => (isTasksOn() ? {} : null),
    definition: () => updateTaskTool,
    run: runUpdateTask,
  },
  {
    name: `complete_task`,
    settings: () => (isTasksOn() ? {} : null),
    definition: () => completeTaskTool,
    run: runCompleteTask,
  },
]

export default {
  isTasksOn,
  tools,
}
