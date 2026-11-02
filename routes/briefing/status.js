import briefings from '../../services/briefings.js'

// Polled by the Briefing page while a briefing runs, so it can reload when it's done
export const GET = async function (ctx) {
  ctx.body = { running: briefings.isRunning() }
}
