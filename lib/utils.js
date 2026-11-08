import _ from 'lodash'
import config from '../configure.js'
import crypto from 'crypto'
import fsp from 'fs/promises'
import path from 'node:path'

const dataDelimiter = `-=DO NOT EDIT BELOW=-`

export const to = function (promise) {
  return promise.then(function (val) {
    return val || {}
  }).catch(function (err) {
    err.isError = true
    return err
  })
}

export const uniqueId = function (length = 10) {
  const chars = `1234567890BCDFGHJKMNPQRSTVWXYZ`
  const bytes = Array.from(crypto.randomBytes(length))

  const value = bytes.map(function (byte, idx) {
    return chars[byte % chars.length].toString()
  })

  return value.join(``)
}

export const createId = function () {
  return `${Date.now()}X${uniqueId(10).toLowerCase()}`
}

export const errMsg = function (err) {
  if (config.env !== `production`) {
    console.log(JSON.stringify(err))
  }

  const messagePaths = [
    `message`,
    `response.data`,
  ]
  let message = null

  for (const path of messagePaths) {
    message = _.get(err, path)

    if (message != null) {
      break
    }
  }

  return message
}

export const getDeferred = function () {
  const defObj = {
    resolved: false,
    rejected: false,
  }

  defObj.promise = new Promise(function (resolve, reject) {
    defObj.resolve = function (...args) {
      defObj.resolved = true
      resolve(...args)
    }
    defObj.reject = function (error) {
      defObj.rejected = true
      reject(error)
    }
  })
  return defObj
}

export const collapse = function (obj, depth, delimiter = `/`) {
  const output = {}
  depth = depth || []
  Object.keys(obj).forEach(function (key) {
    const val = obj[key]
    if (_.isFunction(val) || _.isString(val) || _.isArray(val) || _.isBoolean(val)) {
      Object.assign(output, { [depth.concat([key]).join(delimiter)]: val })
    } else if (_.isObject(val)) {
      Object.assign(output, collapse(val, depth.concat([key]), delimiter))
    }
  })
  return output
}

export const importDirectory = async function (dir, filter) {
  const output = {}

  const scanDir = async function (dir, obj) {
    const list = await fsp.readdir(dir, { withFileTypes: true })

    let files = list.filter(function (item) {
      return item.isDirectory() === false
    })

    if (filter) {
      files = files.filter(function (item) {
        return item.name.match(filter)
      })
    }

    const dirs = list.filter(function (item) {
      return item.isDirectory()
    })

    await Promise.all(files.map(async function (item) {
      const name = _.last(item.name.match(filter))
      obj[name] = path.join(dir, item.name)
    }))

    await Promise.all(dirs.map(async function (subDir) {
      obj[subDir.name] = {}
      await scanDir(path.join(dir, subDir.name), obj[subDir.name])
    }))
  }

  await scanDir(dir, output)

  return output
}

export const getData = function (rawText) {
  const result = { text: ``, data: {} }
  if (_.isString(rawText) === false) {
    return result
  }

  const [text, json] = rawText.split(dataDelimiter)

  if (_.isString(text)) {
    result.text = text.trim()
  }

  try {
    result.data = JSON.parse(json)
  } catch (e) {}

  return result
}

export const setData = function (text, data) {
  if (_.isString(text) === false) {
    text = ``
  }
  return [text.trim(), JSON.stringify(data, null, `  `)].join(`\n\n` + dataDelimiter + `\n`)
}

export default {
  to,
  uniqueId,
  createId,
  errMsg,
  getDeferred,
  collapse,
  importDirectory,
  getData,
  setData,
}
