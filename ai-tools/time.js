import dayjs from 'dayjs'
import utc from 'dayjs/plugin/utc'
import timezone from 'dayjs/plugin/timezone'
import tasks from '../services/tasks.js'
import { parseArguments } from './arguments.js'
import prompts from '../prompts.js'

// get_current_time: the date and time now, which the model can't know otherwise. convert_time:
// a time in other time zones, which the model gets wrong when it works out offsets itself.

// app.js extends these too, but the tools are also loaded without it
dayjs.extend(utc)
dayjs.extend(timezone)

// The descriptions are in prompts.js

// Models only know the date their training ended, so they're given a way to ask
const currentTimeTool = {
  type: `function`,
  function: {
    name: `get_current_time`,
    description: prompts.tools.get_current_time.description,
    parameters: {
      type: `object`,
      properties: {},
    },
  },
}

const convertTimeTool = {
  type: `function`,
  function: {
    name: `convert_time`,
    description: prompts.tools.convert_time.description,
    parameters: {
      type: `object`,
      properties: {
        time: {
          type: `string`,
          description: prompts.tools.convert_time.parameters.time,
        },
        from_zone: {
          type: `string`,
          description: prompts.tools.convert_time.parameters.from_zone,
        },
        to_zones: {
          type: `array`,
          items: { type: `string` },
          description: prompts.tools.convert_time.parameters.to_zones,
        },
      },
    },
  },
}

// The server's time zone, which is the owner's
export const getOwnTimeZone = function () {
  return Intl.DateTimeFormat().resolvedOptions().timeZone
}

// The time now in the server's time zone, which is the owner's, written out so the model can't
// misread it, with the ISO form for working things out. Also told to briefings.
export const describeCurrentTime = function () {
  const now = new Date()
  const timeZone = getOwnTimeZone()
  const localTime = now.toLocaleString(`en-US`, { dateStyle: `full`, timeStyle: `long`, timeZone })

  return `It's ${localTime} (time zone ${timeZone}). In UTC: ${now.toISOString()}`
}

const runGetCurrentTime = function () {
  return { content: describeCurrentTime(), imageId: null }
}

// The most zones convert_time converts to at once
const maxToZones = 10

// Common abbreviations, read as their region's zone rather than a fixed offset, so EST in July
// still gives New York's summer time, which is what people mean. Some, like EST and CET, are
// zones of their own to Intl, without daylight saving, so these are looked up first.
const zoneAbbreviations = {
  ET: `America/New_York`,
  EST: `America/New_York`,
  EDT: `America/New_York`,
  CT: `America/Chicago`,
  CST: `America/Chicago`,
  CDT: `America/Chicago`,
  MT: `America/Denver`,
  MST: `America/Denver`,
  MDT: `America/Denver`,
  PT: `America/Los_Angeles`,
  PST: `America/Los_Angeles`,
  PDT: `America/Los_Angeles`,
  AKST: `America/Anchorage`,
  AKDT: `America/Anchorage`,
  HST: `Pacific/Honolulu`,
  BST: `Europe/London`,
  CET: `Europe/Paris`,
  CEST: `Europe/Paris`,
  JST: `Asia/Tokyo`,
  AEST: `Australia/Sydney`,
  AEDT: `Australia/Sydney`,
}

// The regions zone names start with, for finding a zone by its city
const zoneRegions = [`America`, `Europe`, `Asia`, `Africa`, `Australia`, `Pacific`, `Atlantic`, `Indian`, `Antarctica`]

// Every zone the runtime lists, by its city in lower case: America/Argentina/Buenos_Aires is
// "buenos aires". The list keeps some old names (Asia/Calcutta), which is why readTimeZone also
// tries a city under each region.
const zonesByCity = new Map()

for (const name of Intl.supportedValuesOf(`timeZone`)) {
  const city = name.split(`/`).pop().replaceAll(`_`, ` `).toLowerCase()

  if (zonesByCity.has(city) === false) {
    zonesByCity.set(city, name)
  }
}

// A mistake in what the model asked for, marked like calculator.js's, so runConvertTime tells
// the model instead of throwing
const fail = function (message) {
  const err = new Error(message)
  err.isCalculationError = true
  return err
}

// The zone's name as Intl writes it, or null when it isn't one
const checkZoneName = function (name) {
  try {
    return new Intl.DateTimeFormat(`en-US`, { timeZone: name }).resolvedOptions().timeZone
  } catch (err) {
    return null
  }
}

// A zone the model named: an IANA name in any case, a city a zone is named after, UTC, or one of
// the abbreviations above. Returns { zone, note }, the note saying how an abbreviation was read.
const readTimeZone = function (text) {
  const trimmed = typeof text === `string` ? text.trim() : ``

  if (trimmed === ``) {
    throw fail(`A time zone is empty. Give IANA names like America/New_York, or leave it out for the user's own.`)
  }

  const abbreviated = zoneAbbreviations[trimmed.toUpperCase()]

  if (abbreviated != null) {
    return { zone: abbreviated, note: `${trimmed} was taken as ${abbreviated}, with its daylight saving.` }
  }

  const named = checkZoneName(trimmed)

  if (named != null) {
    return { zone: named, note: null }
  }

  const city = trimmed.replaceAll(`_`, ` `).toLowerCase()

  if (zonesByCity.has(city)) {
    return { zone: zonesByCity.get(city), note: null }
  }

  for (const region of zoneRegions) {
    const zone = checkZoneName(`${region}/${city.replaceAll(` `, `_`)}`)

    if (zone != null) {
      return { zone, note: null }
    }
  }

  throw fail(`"${trimmed}" isn't a time zone. Give IANA names like America/New_York, Europe/London or Asia/Tokyo; for a city without a zone of its own, use the one it's in: Seattle is America/Los_Angeles, Mumbai is Asia/Kolkata.`)
}

// The time the model asked about, in `zone`: "2026-11-02 15:00", "15:00" or "3:30 pm" for today
// there, or nothing for now. Returns { instant, asked }, `asked` being the time as
// "YYYY-MM-DD HH:mm", null for now.
export const readTime = function (text, zone) {
  const trimmed = typeof text === `string` ? text.trim() : ``

  if (trimmed === `` || trimmed.toLowerCase() === `now`) {
    return { instant: dayjs(), asked: null }
  }

  const problem = `"${trimmed}" isn't a time. Give it as YYYY-MM-DD HH:MM in 24-hour time, HH:MM for today, or leave it out for now.`
  const match = trimmed.match(/^(?:(\d{4}-\d{2}-\d{2})[ T]+)?(\d{1,2})(?::(\d{2}))?\s*([ap]\.?m\.?)?$/i)

  if (match == null) {
    throw fail(problem)
  }

  const [, dayText, hourText, minuteText, meridiem] = match
  let hour = Number(hourText)
  const minute = Number(minuteText ?? `0`)

  // "15" alone could be anything, so a time without minutes needs am or pm
  if (minuteText == null && meridiem == null) {
    throw fail(problem)
  }

  if (meridiem != null) {
    if (hour < 1 || hour > 12) {
      throw fail(problem)
    }

    const isPm = meridiem.toLowerCase().startsWith(`p`)
    hour = (hour % 12) + (isPm ? 12 : 0)
  }

  if (hour > 23 || minute > 59) {
    throw fail(problem)
  }

  const day = dayText ?? dayjs().tz(zone).format(`YYYY-MM-DD`)

  if (tasks.isValidDay(day) === false) {
    throw fail(`"${day}" isn't a date. Give it as YYYY-MM-DD.`)
  }

  const asked = `${day} ${String(hour).padStart(2, `0`)}:${String(minute).padStart(2, `0`)}`

  // dayjs.tz shows a time that doesn't exist (in the hour the clocks skip) wrongly, though the
  // instant it holds is right, so the time is always rebuilt from that
  return { instant: dayjs(dayjs.tz(asked, zone).valueOf()), asked }
}

// When the clocks change near `instant` in `zone`: a time asked for that doesn't exist (the
// clocks skip it) or happens twice (they go back). Returns { instant, note }, with the first of
// a time that happens twice.
export const checkClockChange = function (instant, asked, zone) {
  const local = instant.tz(zone)
  const askedClock = asked.slice(11)

  if (local.format(`YYYY-MM-DD HH:mm`) !== asked) {
    return {
      instant,
      note: `${askedClock} doesn't exist on ${local.format(`ddd D MMM YYYY`)} in ${zone}: the clocks go forward then, so it was taken as ${local.format(`HH:mm`)}.`,
    }
  }

  const dayMs = 24 * 60 * 60 * 1000
  const offsets = new Set([
    dayjs(instant.valueOf() - dayMs).tz(zone).utcOffset(),
    dayjs(instant.valueOf() + dayMs).tz(zone).utcOffset(),
  ])

  for (const offset of offsets) {
    // The same clock time under the other offset
    const other = dayjs(dayjs.utc(asked).valueOf() - offset * 60 * 1000)

    if (other.valueOf() !== instant.valueOf() && other.tz(zone).format(`YYYY-MM-DD HH:mm`) === asked) {
      const [first, second] = [instant, other].sort((a, b) => a.valueOf() - b.valueOf())

      return {
        instant: first,
        note: `${askedClock} happens twice on ${local.format(`ddd D MMM YYYY`)} in ${zone}, as the clocks go back: first at UTC${first.tz(zone).format(`Z`)}, then again at UTC${second.tz(zone).format(`Z`)}. This uses the first.`,
      }
    }
  }

  return { instant, note: null }
}

// "Mountain Standard Time"; dayjs doesn't name zones
const describeZoneName = function (instant, zone) {
  const parts = new Intl.DateTimeFormat(`en-US`, { timeZone: zone, timeZoneName: `long` }).formatToParts(instant.toDate())

  return parts.find((part) => part.type === `timeZoneName`)?.value ?? zone
}

// "15:00 (3:00 PM) Mon 2 Nov 2026 in America/Denver (Mountain Standard Time, UTC-07:00)"
const describeZoneTime = function (instant, zone) {
  const local = instant.tz(zone)
  const ownZone = zone === getOwnTimeZone() ? `, the user's time zone` : ``

  return `${local.format(`HH:mm (h:mm A) ddd D MMM YYYY`)} in ${zone} (${describeZoneName(instant, zone)}, UTC${local.format(`Z`)}${ownZone})`
}

const plural = function (count, word) {
  return `${count} ${word}${count === 1 ? `` : `s`}`
}

// "7 hours ahead", "12 hours 30 minutes ahead, the next day", "the same time"
const describeDifference = function (instant, fromZone, toZone) {
  const from = instant.tz(fromZone)
  const to = instant.tz(toZone)
  const minutes = to.utcOffset() - from.utcOffset()

  let text = `the same time`

  if (minutes !== 0) {
    const size = Math.abs(minutes)
    const hours = Math.floor(size / 60)
    const parts = []

    if (hours > 0) {
      parts.push(plural(hours, `hour`))
    }

    if (size % 60 > 0) {
      parts.push(plural(size % 60, `minute`))
    }

    text = `${parts.join(` `)} ${minutes > 0 ? `ahead` : `behind`}`
  }

  const days = dayjs(to.format(`YYYY-MM-DD`)).diff(dayjs(from.format(`YYYY-MM-DD`)), `day`)

  if (days === 1) {
    text = `${text}, the next day`
  } else if (days === -1) {
    text = `${text}, the day before`
  } else if (days !== 0) {
    text = `${text}, ${plural(Math.abs(days), `day`)} ${days > 0 ? `later` : `earlier`}`
  }

  return text
}

// The time in `fromZone` (now, when there's no time) in each of `toZones`, written out. Throws an
// error marked isCalculationError saying what's wrong with the call.
export const convertTime = function ({ time, fromZone, toZones }) {
  const notes = []
  const readZone = function (text) {
    const { zone, note } = readTimeZone(text)

    if (note != null && notes.includes(note) === false) {
      notes.push(note)
    }

    return zone
  }

  // Left out, or left empty, means the user's own
  const isGiven = (text) => typeof text === `string` && text.trim() !== ``
  const from = isGiven(fromZone) ? readZone(fromZone) : getOwnTimeZone()

  let toList = typeof toZones === `string` ? [toZones] : toZones
  toList = Array.isArray(toList) ? toList.filter(isGiven) : []

  if (toList.length === 0) {
    toList = [getOwnTimeZone()]
  }

  const to = [...new Set(toList.slice(0, maxToZones).map(readZone))].filter((zone) => zone !== from)

  let { instant, asked } = readTime(time, from)

  if (asked != null) {
    const change = checkClockChange(instant, asked, from)
    instant = change.instant

    if (change.note != null) {
      notes.push(change.note)
    }
  }

  const fromText = describeZoneTime(instant, from)
  const lines = []

  if (to.length === 0) {
    lines.push(asked == null ? `It's now ${fromText}.` : `${fromText}.`)
  } else {
    lines.push(asked == null ? `It's now ${fromText}. There, it's:` : `${fromText} is:`)

    for (const zone of to) {
      lines.push(`- ${describeZoneTime(instant, zone)}: ${describeDifference(instant, from, zone)}`)
    }
  }

  for (const note of notes) {
    lines.push(`Note: ${note}`)
  }

  return lines.join(`\n`)
}

// A mistake in the call is told to the model, so it can fix it; anything else is a bug, and goes
// on to runTool to be logged
const runConvertTime = function ({ argumentsText }) {
  const args = parseArguments(argumentsText) ?? {}

  try {
    const content = convertTime({ time: args.time, fromZone: args.from_zone, toZones: args.to_zones })

    return { content, imageId: null }
  } catch (err) {
    if (err.isCalculationError === true) {
      return { content: `Converting the time failed: ${err.message}`, imageId: null }
    }

    throw err
  }
}

export const tools = [
  {
    name: `get_current_time`,
    // Always offered; it has nothing to set up
    settings: () => ({}),
    definition: () => currentTimeTool,
    run: runGetCurrentTime,
  },
  {
    name: `convert_time`,
    settings: () => ({}),
    definition: () => convertTimeTool,
    run: runConvertTime,
  },
]

export default {
  getOwnTimeZone,
  describeCurrentTime,
  readTime,
  checkClockChange,
  convertTime,
  tools,
}
