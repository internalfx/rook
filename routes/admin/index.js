import dayjs from 'dayjs'
import config from '../../configure.js'
import lemonade from '../../lib/lemonade.js'
import usage from '../../lib/usage.js'
import runs from '../../lib/runs.js'
import briefings from '../../services/briefings.js'
import { formatContextLength } from '../../lib/format.js'

// Admin → Overview, for admins only (see middleware/auth.js): how the Lemonade server and rook are
// doing right now. Nothing here changes anything.

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
  const [health, stats, system] = await Promise.all([
    settle(lemonade.getHealth()),
    settle(lemonade.getStats()),
    settle(lemonade.getSystemInfo()),
  ])

  ctx.body = ctx.nunjucks(`admin/index`, {
    lemonadeHost: config.lemonade.host,
    health,
    stats,
    system,
    loadedModels: (health.value?.all_models_loaded ?? []).map(toLoadedModel),
    machine: system.value == null ? null : toMachine(system.value),
    storage: usage.describeStorage(),
    uptime: describeUptime(process.uptime()),
    repliesRunning: runs.countActiveRuns(),
    briefingsRunning: briefings.countRunning(),
    isScheduleOn: briefings.isScheduleOn(),
    briefingMinutes: briefings.getBriefingMinutes(),
  })
}
