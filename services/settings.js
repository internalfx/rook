
import _ from 'lodash'

import db from './db.js'

// Each user's own settings, as key/value rows in userSettings: their ntfy topic, Slack token and
// picks, time zone, and when they last saw the Briefing and Notifications pages. What applies to
// everyone (the models, tools and briefing schedule) is in config.js.

const selectSetting = db.query(`SELECT * FROM userSettings WHERE userId = $userId AND key = $key`)
const upsertSetting = db.query(`
  INSERT INTO userSettings (userId, key, value, type, updatedAt)
  VALUES ($userId, $key, $value, $type, $updatedAt)
  ON CONFLICT (userId, key) DO UPDATE SET
    value = excluded.value,
    type = excluded.type,
    updatedAt = excluded.updatedAt
`)
const deleteSetting = db.query(`DELETE FROM userSettings WHERE userId = $userId AND key = $key`)

const get = function (userId, key) {
  const record = selectSetting.get({ userId, key })

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

const set = function (userId, key, value) {
  const obj = {
    userId,
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

const unset = function (userId, key) {
  deleteSetting.run({ userId, key })

  return true
}

export default {
  set,
  get,
  unset,
}
