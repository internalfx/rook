import dayjs from 'dayjs'
import tasks from '../services/tasks.js'

// Exact arithmetic and date sums for the model: the calculate, days_between, add_to_date and
// find_weekday tools (see math.js), since small models often get these wrong in their
// heads.
// Expressions are read by a small parser written for this; nothing is handed to eval.

const maxExpressionLength = 500

// How deeply parentheses, minus signs and powers can nest, so a silly expression can't run
// the parser out of stack
const maxDepth = 50

// Ignored, so "$84.50 * 3" works
const ignoredCharacters = `$€£¥`

// Other ways models write the operators
const operatorAliases = { '×': `*`, '÷': `/`, '−': `-` }

const operators = `+-*/^%(),`

const dayFormat = `ddd D MMM YYYY`

export const dateUnits = [`days`, `weeks`, `months`, `years`]

// Monday first, as the model is offered them; dayjs counts from Sunday (see findWeekday)
export const weekdays = [`monday`, `tuesday`, `wednesday`, `thursday`, `friday`, `saturday`, `sunday`]

// A mistake in what the model asked for, with a message it can act on: an Error marked with
// isCalculationError, which ai-tools/math.js tells the model. Anything else thrown from here is a
// bug.
const fail = function (message) {
  const err = new Error(message)
  err.isCalculationError = true
  return err
}

const plural = function (count, word) {
  return `${count} ${word}${count === 1 ? `` : `s`}`
}

// Rounds half away from zero. Shifting by the exponent in text, rather than multiplying,
// keeps 1.005 from becoming 1.00499999…
const roundTo = function (value, places) {
  const size = Math.abs(value)

  if (String(size).includes(`e`)) {
    return Math.sign(value) * Number(size.toFixed(places))
  }

  const shifted = Math.round(Number(`${size}e${places}`))

  return Math.sign(value) * Number(`${shifted}e-${places}`)
}

const median = function (list) {
  const sorted = [...list].sort(function (a, b) {
    return a - b
  })
  const middle = Math.floor(sorted.length / 2)

  if (sorted.length % 2 === 1) {
    return sorted[middle]
  }

  return (sorted[middle - 1] + sorted[middle]) / 2
}

const mean = function (list) {
  return list.reduce(function (total, value) {
    return total + value
  }, 0) / list.length
}

// Each function: how many arguments it takes (min, max), an example for when it's called wrong,
// and what it works out
const functions = {
  sqrt: {
    min: 1,
    max: 1,
    example: `sqrt(2)`,
    run: function ([value]) {
      if (value < 0) {
        throw fail(`Can't take the square root of a negative number.`)
      }

      return Math.sqrt(value)
    },
  },
  abs: { min: 1, max: 1, example: `abs(-3)`, run: ([value]) => Math.abs(value) },
  floor: { min: 1, max: 1, example: `floor(2.7)`, run: ([value]) => Math.floor(value) },
  ceil: { min: 1, max: 1, example: `ceil(2.1)`, run: ([value]) => Math.ceil(value) },
  round: {
    min: 1,
    max: 2,
    example: `round(3.14159, 2)`,
    run: function ([value, places = 0]) {
      if (Number.isInteger(places) === false || places < 0 || places > 15) {
        throw fail(`round's places must be a whole number from 0 to 15.`)
      }

      return roundTo(value, places)
    },
  },
  // Floored, so mod(-7, 3) is 2, as people expect, not JavaScript's -1
  mod: {
    min: 2,
    max: 2,
    example: `mod(17, 5)`,
    run: function ([value, divisor]) {
      if (divisor === 0) {
        throw fail(`Can't take mod by zero.`)
      }

      return value - divisor * Math.floor(value / divisor)
    },
  },
  percent_change: {
    min: 2,
    max: 2,
    example: `percent_change(80, 100)`,
    run: function ([from, to]) {
      if (from === 0) {
        throw fail(`percent_change can't start from 0.`)
      }

      return (to - from) / Math.abs(from) * 100
    },
  },
  sum: { min: 1, max: Infinity, example: `sum(1, 2, 3)`, run: (list) => list.reduce((total, value) => total + value, 0) },
  mean: { min: 1, max: Infinity, example: `mean(12, 15.5, 9)`, run: mean },
  median: { min: 1, max: Infinity, example: `median(3, 1, 2)`, run: median },
  min: { min: 1, max: Infinity, example: `min(4, 2, 8)`, run: (list) => Math.min(...list) },
  max: { min: 1, max: Infinity, example: `max(4, 2, 8)`, run: (list) => Math.max(...list) },
}

functions.avg = functions.mean
functions.average = functions.mean

const functionList = `sqrt, abs, floor, ceil, round, mod, percent_change, sum, mean, median, min and max`

const describeArgumentCount = function ({ min, max }) {
  if (max === Infinity) {
    return `one or more numbers`
  }

  if (min === max) {
    return min === 1 ? `one number` : `${min} numbers`
  }

  return `${min} or ${max} numbers`
}

// The expression as tokens, each { type: number|name|operator, value, at }, where `at` is
// where it starts in the text
const tokenize = function (text) {
  const tokens = []
  let index = 0

  while (index < text.length) {
    const character = text[index]
    const rest = text.slice(index)

    if (/\s/.test(character) || ignoredCharacters.includes(character)) {
      index += 1
      continue
    }

    const number = rest.match(/^(\d+\.?\d*|\.\d+)(e[+-]?\d+)?/i)

    if (number != null) {
      tokens.push({ type: `number`, value: Number(number[0]), at: index })
      index += number[0].length
      continue
    }

    const name = rest.match(/^[a-z_]+/i)

    if (name != null) {
      tokens.push({ type: `name`, value: name[0].toLowerCase(), at: index })
      index += name[0].length
      continue
    }

    if (rest.startsWith(`**`)) {
      tokens.push({ type: `operator`, value: `^`, at: index })
      index += 2
      continue
    }

    const operator = operatorAliases[character] ?? character

    if (operators.includes(operator) === false) {
      throw fail(`"${character}" isn't something calculate understands. Use numbers, + - * / ^ %, parentheses and the functions ${functionList}.`)
    }

    tokens.push({ type: `operator`, value: operator, at: index })
    index += 1
  }

  return tokens
}

// Works out an expression like "(84.50 * 1.15) / 3" and returns the number. Throws an error
// marked isCalculationError saying what's wrong with it.
export const evaluateExpression = function (text) {
  if (typeof text !== `string` || text.trim() === ``) {
    throw fail(`Give an expression to work out, e.g. (84.50 * 1.15) / 3.`)
  }

  if (text.length > maxExpressionLength) {
    throw fail(`The expression is too long; keep it under ${maxExpressionLength} characters, or work it out in parts.`)
  }

  const tokens = tokenize(text)
  let position = 0
  let depth = 0

  const peek = function () {
    return tokens[position]
  }

  const isOperator = function (token, value) {
    return token != null && token.type === `operator` && token.value === value
  }

  const unexpected = function (token) {
    if (token == null) {
      return fail(`The expression ends too soon.`)
    }

    if (isOperator(token, `,`)) {
      return fail(`Commas only separate a function's numbers, as in max(4, 2); write numbers without thousands separators, e.g. 1234.5.`)
    }

    return fail(`Couldn't read the expression from "${text.slice(token.at, token.at + 30)}".`)
  }

  const expectClose = function () {
    const token = peek()

    if (isOperator(token, `)`)) {
      position += 1
      return
    }

    if (token == null) {
      throw fail(`A parenthesis isn't closed.`)
    }

    throw unexpected(token)
  }

  // + and -, the loosest
  const parseSum = function () {
    let value = parseProduct()

    while (isOperator(peek(), `+`) || isOperator(peek(), `-`)) {
      const operator = peek().value
      position += 1
      const right = parseProduct()

      value = operator === `+` ? value + right : value - right
    }

    return value
  }

  const parseProduct = function () {
    let value = parseUnary()

    while (isOperator(peek(), `*`) || isOperator(peek(), `/`)) {
      const operator = peek().value
      position += 1
      const right = parseUnary()

      if (operator === `/` && right === 0) {
        throw fail(`Can't divide by zero.`)
      }

      value = operator === `*` ? value * right : value / right
    }

    return value
  }

  // A minus sign applies after powers, so -2^2 is -4. Every level of nesting passes through
  // here, so this is where the depth is counted.
  const parseUnary = function () {
    depth += 1

    if (depth > maxDepth) {
      throw fail(`The expression is nested too deeply.`)
    }

    let value

    if (isOperator(peek(), `-`)) {
      position += 1
      value = -parseUnary()
    } else if (isOperator(peek(), `+`)) {
      position += 1
      value = parseUnary()
    } else {
      value = parsePower()
    }

    depth -= 1

    return value
  }

  // Right to left, so 2^3^2 is 2^9
  const parsePower = function () {
    const base = parsePercent()

    if (isOperator(peek(), `^`)) {
      position += 1
      const exponent = parseUnary()

      return base ** exponent
    }

    return base
  }

  const parsePercent = function () {
    let value = parsePrimary()

    while (isOperator(peek(), `%`)) {
      position += 1
      const next = peek()

      // "17 % 5" is a remainder in most programming languages, which isn't what % means here
      if (next != null && (next.type !== `operator` || next.value === `(`)) {
        throw fail(`% means percent here (15% is 0.15); for a remainder use mod(a, b).`)
      }

      value = value / 100
    }

    return value
  }

  const parsePrimary = function () {
    const token = peek()

    if (token == null) {
      throw unexpected(token)
    }

    if (token.type === `number`) {
      position += 1
      return token.value
    }

    if (isOperator(token, `(`)) {
      position += 1
      const value = parseSum()
      expectClose()
      return value
    }

    if (token.type !== `name`) {
      throw unexpected(token)
    }

    position += 1

    if (token.value === `pi`) {
      return Math.PI
    }

    const definition = Object.hasOwn(functions, token.value) ? functions[token.value] : null

    if (definition == null) {
      throw fail(`There's no function or constant called "${token.value}". The functions are ${functionList}, and the constant is pi.`)
    }

    if (isOperator(peek(), `(`) === false) {
      throw fail(`${token.value} needs its numbers in parentheses, e.g. ${definition.example}.`)
    }

    position += 1

    const args = []

    if (isOperator(peek(), `)`) === false) {
      args.push(parseSum())

      while (isOperator(peek(), `,`)) {
        position += 1
        args.push(parseSum())
      }
    }

    expectClose()

    if (args.length < definition.min || args.length > definition.max) {
      throw fail(`${token.value} takes ${describeArgumentCount(definition)}, e.g. ${definition.example}.`)
    }

    return definition.run(args)
  }

  const value = parseSum()

  if (position < tokens.length) {
    const token = peek()

    if (isOperator(token, `)`)) {
      throw fail(`There's a ) without a ( to match it.`)
    }

    throw unexpected(token)
  }

  if (Number.isNaN(value)) {
    throw fail(`The result isn't a real number.`)
  }

  if (Number.isFinite(value) === false) {
    throw fail(`The result is too large to work out.`)
  }

  return value
}

// A result as the model is shown it, without floating-point noise: 0.1 + 0.2 gives 0.3
export const formatNumber = function (value) {
  const tidied = Number(value.toPrecision(15))

  // Also turns -0 into 0
  if (tidied === 0) {
    return `0`
  }

  return String(tidied)
}

// A date the model gave, as YYYY-MM-DD; "today" is today in `zone`, the user's time zone.
// `label` names the argument, for when it's missing.
export const readDay = function (text, label, zone) {
  if (typeof text !== `string` || text.trim() === ``) {
    throw fail(`${label} is missing. Give dates as YYYY-MM-DD, or today.`)
  }

  const trimmed = text.trim()

  if (trimmed.toLowerCase() === `today`) {
    return tasks.today(zone)
  }

  if (tasks.isValidDay(trimmed) === false) {
    throw fail(`"${trimmed}" isn't a date. Give dates as YYYY-MM-DD, or today.`)
  }

  return trimmed
}

// "Sun 1 Nov 2026", with "(today)" when it is in `zone`, the user's time zone
const describeDay = function (date, zone) {
  const text = date.format(dayFormat)

  if (date.format(`YYYY-MM-DD`) === tasks.today(zone)) {
    return `${text} (today)`
  }

  return text
}

// E.g. "Fri 25 Dec 2026 is 54 days after Sun 1 Nov 2026 (today) (7 weeks and 5 days)." Today is
// in `zone`, the user's time zone, as in the rest of these.
export const daysBetween = function (fromText, toText, zone) {
  // dayjs reads a plain YYYY-MM-DD as a day in the server's time zone, and counts days across
  // a clock change correctly; which zone doesn't matter for whole days
  const from = dayjs(readDay(fromText, `from`, zone))
  const to = dayjs(readDay(toText, `to`, zone))
  const days = to.diff(from, `day`)

  if (days === 0) {
    return `That's the same day: ${describeDay(from, zone)}.`
  }

  const count = Math.abs(days)
  const direction = days > 0 ? `after` : `before`

  let text = `${describeDay(to, zone)} is ${plural(count, `day`)} ${direction} ${describeDay(from, zone)}`

  if (count >= 7) {
    const weeks = Math.floor(count / 7)
    const rest = count % 7

    text = `${text} (${plural(weeks, `week`)}${rest > 0 ? ` and ${plural(rest, `day`)}` : ``})`
  }

  return `${text}.`
}

// E.g. "45 days after Sun 1 Nov 2026 (today) is Wed 16 Dec 2026 (2026-12-16)." `amount` is a whole
// number, negative to go back; `unit` is one of dateUnits, or the same without the s.
export const addToDate = function (dateText, amount, unit, zone) {
  const day = readDay(dateText, `date`, zone)

  // Models sometimes send the number as text
  const count = typeof amount === `string` && amount.trim() !== `` ? Number(amount) : amount

  if (Number.isInteger(count) === false) {
    throw fail(`amount must be a whole number, like 3, or -2 to go back.`)
  }

  let unitName = typeof unit === `string` ? unit.trim().toLowerCase() : ``

  if (unitName !== `` && unitName.endsWith(`s`) === false) {
    unitName = `${unitName}s`
  }

  if (dateUnits.includes(unitName) === false) {
    throw fail(`unit must be days, weeks, months or years.`)
  }

  const start = dayjs(day)
  const result = start.add(count, unitName)

  if (result.isValid() === false || result.year() < 1 || result.year() > 9999) {
    throw fail(`That's too far from ${describeDay(start, zone)} to work out.`)
  }

  const direction = count < 0 ? `before` : `after`
  const singular = unitName.slice(0, -1)

  let text = `${plural(Math.abs(count), singular)} ${direction} ${describeDay(start, zone)} is ${describeDay(result, zone)} (${result.format(`YYYY-MM-DD`)}).`

  // dayjs keeps to the end of a shorter month: 31 Jan + 1 month is 28 Feb
  const isByMonth = unitName === `months` || unitName === `years`

  if (isByMonth && result.date() !== start.date()) {
    text = `${text} ${result.format(`MMMM YYYY`)} has no day ${start.date()}, so that's its last day.`
  }

  return text
}

// The first `weekday` after `fromText` (or before it, when `direction` is "before"), never the
// day itself, and the one after that, since "next Friday" can mean either. E.g. "The next Friday
// after Sun 1 Nov 2026 (today) is Fri 6 Nov 2026 (2026-11-06), 5 days later. The one after that
// is Fri 13 Nov 2026 (2026-11-13)."
export const findWeekday = function (weekdayText, fromText, direction, zone) {
  // "friday", "Fri" or "fridays" all work
  const name = typeof weekdayText === `string` ? weekdayText.trim().toLowerCase().replace(/s$/, ``) : ``
  const position = weekdays.findIndex(function (weekday) {
    return name.length >= 3 && weekday.startsWith(name)
  })

  if (position === -1) {
    throw fail(`weekday must be a day of the week, like friday.`)
  }

  const isMissing = fromText == null || (typeof fromText === `string` && fromText.trim() === ``)
  const from = dayjs(readDay(isMissing ? `today` : fromText, `from`, zone))

  const way = direction == null || direction === `` ? `after` : direction

  if (way !== `after` && way !== `before`) {
    throw fail(`direction must be after or before.`)
  }

  // dayjs numbers the days from Sunday, 0, to Saturday, 6
  const target = (position + 1) % 7
  const step = way === `after` ? 1 : -1

  let gap = way === `after` ? (target - from.day() + 7) % 7 : (from.day() - target + 7) % 7

  if (gap === 0) {
    gap = 7
  }

  const first = from.add(step * gap, `day`)
  const second = first.add(step * 7, `day`)
  const dayName = `${weekdays[position][0].toUpperCase()}${weekdays[position].slice(1)}`

  let text = way === `after`
    ? `The next ${dayName} after ${describeDay(from, zone)} is ${describeDay(first, zone)} (${first.format(`YYYY-MM-DD`)}), ${plural(gap, `day`)} later. The one after that is ${describeDay(second, zone)} (${second.format(`YYYY-MM-DD`)}).`
    : `The last ${dayName} before ${describeDay(from, zone)} is ${describeDay(first, zone)} (${first.format(`YYYY-MM-DD`)}), ${plural(gap, `day`)} earlier. The one before that is ${describeDay(second, zone)} (${second.format(`YYYY-MM-DD`)}).`

  if (from.day() === target) {
    text = `${text} ${describeDay(from, zone)} is itself a ${dayName}.`
  }

  return text
}

export default {
  dateUnits,
  weekdays,
  evaluateExpression,
  formatNumber,
  readDay,
  daysBetween,
  addToDate,
  findWeekday,
}
