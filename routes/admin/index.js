import dayjs from 'dayjs'
import config from '../../configure.js'
import lemonade from '../../services/lemonade.js'
import users from '../../services/users.js'
import usage from '../../services/usage.js'
import runs from '../../services/runs.js'
import briefings from '../../services/briefings.js'
import { formatContextLength } from '../../lib/format.js'

// The Admin page, for admins only (see middleware/auth.js): how the Lemonade server is doing, what
// models it has, and what rook holds for each user. Nothing here changes anything.

// What config.js uses each model for, by the key in config.models
const roles = {
  chat: `Chat`,
  image: `Image`,
  embedding: `Embedding`,
  pageReader: `Page reader`,
}

// Lemonade's answer as { value, error }, so one call failing leaves the others showing
const settle = async function (promise) {
  try {
    return { value: await promise, error: null }
  } catch (err) {
    console.error(err)
    return { value: null, error: err.message }
  }
}

// A loaded model as the page shows it (an entry of /health's all_models_loaded)
const toLoadedModel = function (model) {
  let state = model.status ?? `loaded`

  if (model.is_streaming === true) {
    state = `streaming`
  } else if (model.is_busy === true) {
    state = `busy`
  }

  return {
    name: model.model_name,
    type: model.type,
    device: model.device,
    state,
    contextLength: formatContextLength(model.recipe_options?.ctx_size ?? model.max_context_window),
    backend: model.recipe_options?.llamacpp_backend ?? model.recipe ?? null,
  }
}

// A model /models lists as the page shows it, with the roles config.js gives it
const toListedModel = function (model) {
  const modelRoles = Object.entries(roles).filter(function ([key]) {
    return config.models[key] === model.id
  }).map(function ([, label]) {
    return label
  })

  return {
    id: model.id,
    labels: model.labels ?? [],
    sizeGB: model.size ?? null,
    contextLength: formatContextLength(model.context_length),
    downloaded: model.downloaded === true,
    updateAvailable: model.update_available === true,
    roles: modelRoles,
  }
}

// The roles config.js names a model for that Lemonade doesn't list, as "Chat: name"
const findMissingModels = function (models) {
  const missing = []

  for (const [key, label] of Object.entries(roles)) {
    const name = config.models[key]

    if (name != null && models.some((model) => model.id === name) === false) {
      missing.push(`${label}: ${name}`)
    }
  }

  return missing
}

// The machine, from /system-info: its processor, memory, the accelerators it has, and the model
// storage
const toMachine = function (info) {
  const devices = info.devices ?? {}
  const accelerators = []

  for (const gpu of [...(devices.amd_gpu ?? []), ...(devices.nvidia_gpu ?? [])]) {
    if (gpu.available === true) {
      accelerators.push(`GPU ${gpu.family ?? gpu.name}${gpu.integrated ? ` (integrated)` : ``}`)
    }
  }

  const npu = devices.amd_npu

  if (npu?.available === true) {
    accelerators.push(`NPU ${npu.family ?? npu.name}${npu.tops_max_int != null ? `, ${npu.tops_max_int} TOPS` : ``}`)
  }

  const storage = info.model_storage ?? null

  return {
    os: info[`OS Version`] ?? null,
    processor: info.Processor ?? null,
    memory: info[`Physical Memory`] ?? null,
    accelerators,
    storage: storage == null ? null : { used: storage.used_bytes, total: storage.total_bytes, free: storage.free_bytes, path: storage.path },
  }
}

// "3 hours" from seconds
const describeUptime = function (seconds) {
  return dayjs.duration(seconds, `seconds`).humanize()
}

export const GET = async function (ctx) {
  const [health, stats, system, models] = await Promise.all([
    settle(lemonade.getHealth()),
    settle(lemonade.getStats()),
    settle(lemonade.getSystemInfo()),
    settle(lemonade.listModels()),
  ])

  const loadedModels = (health.value?.all_models_loaded ?? []).map(toLoadedModel)
  const listedModels = (models.value ?? []).map(toListedModel)
  const missingModels = models.value == null ? [] : findMissingModels(models.value)
  const machine = system.value == null ? null : toMachine(system.value)

  // Each user with what they have, and when their briefings ran and are next due
  const byUser = usage.countByUser()
  const now = Date.now()

  const userRows = users.listUsers().map(function (user) {
    const counts = usage.countsFor(byUser, user.id)
    const nextDue = briefings.getNextDue(user.id)

    return {
      ...user,
      ...counts,
      lastBriefing: counts.lastBriefingAt == null ? null : dayjs(counts.lastBriefingAt).fromNow(),
      nextBriefing: nextDue == null ? null : (nextDue.getTime() <= now ? `due now` : dayjs(nextDue).fromNow()),
    }
  })

  const totals = { chats: 0, messages: 0, memories: 0, openTasks: 0, doneTasks: 0, briefings: 0, notifications: 0, waiting: 0 }

  for (const row of userRows) {
    for (const key of Object.keys(totals)) {
      totals[key] += row[key]
    }
  }

  ctx.body = ctx.nunjucks(`admin/index`, {
    lemonadeHost: config.lemonade.host,
    health,
    stats,
    system,
    models,
    loadedModels,
    listedModels,
    missingModels,
    machine,
    userRows,
    totals,
    storage: usage.describeStorage(),
    uptime: describeUptime(process.uptime()),
    repliesRunning: runs.countActiveRuns(),
    briefingsRunning: briefings.countRunning(),
    isScheduleOn: briefings.isScheduleOn(),
    briefingMinutes: briefings.getBriefingMinutes(),
  })
}
