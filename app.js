
import config from './configure.js'
import { checkConfig, checkModels } from './lib/checkConfig.js'
import { buildStylesheet } from './lib/stylesheet.js'
import substruct from './substruct.js'
import dayjs from 'dayjs'
import AdvancedFormat from 'dayjs/plugin/advancedFormat'
import relativeTime from 'dayjs/plugin/relativeTime'
import utc from 'dayjs/plugin/utc'
import isSameOrAfter from 'dayjs/plugin/isSameOrAfter'
import duration from 'dayjs/plugin/duration'

// The server-wide options in config.js, before anything reads them
checkConfig()

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

// Warns about models config.js names that the Lemonade server doesn't have
checkModels()
