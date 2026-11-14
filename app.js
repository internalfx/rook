
import config from './configure.js'
import serverSettings from './lib/serverSettings.js'
import { buildStylesheet } from './lib/stylesheet.js'
import substruct from './substruct.js'
import dayjs from 'dayjs'
import AdvancedFormat from 'dayjs/plugin/advancedFormat'
import relativeTime from 'dayjs/plugin/relativeTime'
import utc from 'dayjs/plugin/utc'
import isSameOrAfter from 'dayjs/plugin/isSameOrAfter'
import duration from 'dayjs/plugin/duration'

// The Lemonade server, models, tools and briefing schedule, from the database, before anything
// reads them
await serverSettings.load()

// dist/application.css, before the first page asks for it
buildStylesheet()

// Scheduled briefings, sending scheduled notifications, and deleting old done tasks; the test
// copy (scripts/test-server.js) runs without them
if (config.cronOff !== true) {
  await import(`./services/cron.js`)
}

dayjs.extend(AdvancedFormat)
dayjs.extend(relativeTime)
dayjs.extend(utc)
dayjs.extend(isSameOrAfter)
dayjs.extend(duration)

await substruct.start()

console.log(`Server Started...`)

// Warns about models that are set but aren't on the Lemonade server, or says it isn't set up yet
serverSettings.warnAboutModels()
