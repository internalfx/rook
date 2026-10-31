
import _ from 'lodash'

import db from './db.js'

const selectSetting = db.query(`SELECT * FROM settings WHERE key = $key`)
const upsertSetting = db.query(`
  INSERT INTO settings (key, value, type, updatedAt)
  VALUES ($key, $value, $type, $updatedAt)
  ON CONFLICT (key) DO UPDATE SET
    value = excluded.value,
    type = excluded.type,
    updatedAt = excluded.updatedAt
`)
const deleteSetting = db.query(`DELETE FROM settings WHERE key = $key`)

const get = function (key) {
  const record = selectSetting.get({ key })

  let val = null

  if (record) {
    const value = _.get(JSON.parse(record.value), `v`) || null
    if (record.type === `DateTime`) {
      val = new Date(value)
    } else {
      val = value
    }
  }

  return val
}

const set = function (key, value) {
  const obj = {
    key,
    value: JSON.stringify({ v: value }),
    type: null,
    updatedAt: new Date().toISOString(),
  }

  if (value instanceof Date) {
    obj.type = `DateTime`
  }

  upsertSetting.run(obj)

  return true
}

const unset = function (key) {
  deleteSetting.run({ key })

  return true
}

export default {
  set,
  get,
  unset,
}
