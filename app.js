
import substruct from './substruct.js'
import dayjs from 'dayjs'
import AdvancedFormat from 'dayjs/plugin/advancedFormat'
import relativeTime from 'dayjs/plugin/relativeTime'
import utc from 'dayjs/plugin/utc'
import isSameOrAfter from 'dayjs/plugin/isSameOrAfter'
import duration from 'dayjs/plugin/duration'
import './services/cron.js'

dayjs.extend(AdvancedFormat)
dayjs.extend(relativeTime)
dayjs.extend(utc)
dayjs.extend(isSameOrAfter)
dayjs.extend(duration)

await substruct.start()

console.log(`Server Started...`)
