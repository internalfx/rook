import calculator from './calculator.js'
import { parseArguments } from './arguments.js'
import prompts from '../prompts.js'

// calculate, days_between, add_to_date and find_weekday: sums and dates worked out exactly, by
// calculator.js

// Small models often get sums wrong in their heads, so they're given ways to work them out
// exactly (see calculator.js)
const calculateTool = {
  type: `function`,
  function: {
    name: `calculate`,
    description: prompts.tools.calculate.description,
    parameters: {
      type: `object`,
      properties: {
        expression: {
          type: `string`,
          description: prompts.tools.calculate.parameters.expression,
        },
      },
      required: [`expression`],
    },
  },
}

const daysBetweenTool = {
  type: `function`,
  function: {
    name: `days_between`,
    description: prompts.tools.days_between.description,
    parameters: {
      type: `object`,
      properties: {
        from: {
          type: `string`,
          description: prompts.tools.days_between.parameters.from,
        },
        to: {
          type: `string`,
          description: prompts.tools.days_between.parameters.to,
        },
      },
      required: [`from`, `to`],
    },
  },
}

const addToDateTool = {
  type: `function`,
  function: {
    name: `add_to_date`,
    description: prompts.tools.add_to_date.description,
    parameters: {
      type: `object`,
      properties: {
        date: {
          type: `string`,
          description: prompts.tools.add_to_date.parameters.date,
        },
        amount: {
          type: `integer`,
          description: prompts.tools.add_to_date.parameters.amount,
        },
        unit: {
          type: `string`,
          enum: calculator.dateUnits,
        },
      },
      required: [`date`, `amount`, `unit`],
    },
  },
}

const findWeekdayTool = {
  type: `function`,
  function: {
    name: `find_weekday`,
    description: prompts.tools.find_weekday.description,
    parameters: {
      type: `object`,
      properties: {
        weekday: {
          type: `string`,
          enum: calculator.weekdays,
        },
        from: {
          type: `string`,
          description: prompts.tools.find_weekday.parameters.from,
        },
        direction: {
          type: `string`,
          enum: [`after`, `before`],
          description: prompts.tools.find_weekday.parameters.direction,
        },
      },
      required: [`weekday`],
    },
  },
}

// Runs one of calculator.js's sums. A mistake in the call is told to the model, so it can fix it;
// anything else is a bug, and goes on to runTool to be logged.
const runCalculation = function (work, describeMistake = (message) => message) {
  try {
    return { content: work(), imageId: null }
  } catch (err) {
    if (err instanceof calculator.CalculationError) {
      return { content: describeMistake(err.message), imageId: null }
    }

    throw err
  }
}

// "(84.50 * 1.15) / 3 = 32.3916666666667", so the model can check what it asked for
const runCalculate = function ({ argumentsText }) {
  const args = parseArguments(argumentsText) ?? {}
  const expression = typeof args.expression === `string` ? args.expression.trim() : ``

  const result = runCalculation(function () {
    const value = calculator.evaluateExpression(expression)
    return `${expression} = ${calculator.formatNumber(value)}`
  }, function (message) {
    return expression === `` ? message : `Couldn't work out ${expression}: ${message}`
  })

  return result
}

const runDaysBetween = function ({ argumentsText }) {
  const args = parseArguments(argumentsText) ?? {}

  return runCalculation(function () {
    return calculator.daysBetween(args.from, args.to)
  })
}

const runAddToDate = function ({ argumentsText }) {
  const args = parseArguments(argumentsText) ?? {}

  return runCalculation(function () {
    return calculator.addToDate(args.date, args.amount, args.unit)
  })
}

const runFindWeekday = function ({ argumentsText }) {
  const args = parseArguments(argumentsText) ?? {}

  return runCalculation(function () {
    return calculator.findWeekday(args.weekday, args.from, args.direction)
  })
}

// Always offered; they have nothing to set up
export const tools = [
  {
    name: `calculate`,
    settings: () => ({}),
    definition: () => calculateTool,
    run: runCalculate,
  },
  {
    name: `days_between`,
    settings: () => ({}),
    definition: () => daysBetweenTool,
    run: runDaysBetween,
  },
  {
    name: `add_to_date`,
    settings: () => ({}),
    definition: () => addToDateTool,
    run: runAddToDate,
  },
  {
    name: `find_weekday`,
    settings: () => ({}),
    definition: () => findWeekdayTool,
    run: runFindWeekday,
  },
]

export default {
  tools,
}
