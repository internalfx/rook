import _ from 'lodash'
import config from '../configure.js'
import db from '../services/db.js'
import { uniqueId } from '../lib/utils.js'

const cookieName = config.session.sessionCookieName

const selectSession = db.query(`SELECT * FROM sessions WHERE token = $token`)
const insertSession = db.query(`
  INSERT INTO sessions (token, createdAt, lastActive, data)
  VALUES ($token, $now, $now, $data)
`)
const updateSessionData = db.query(`
  UPDATE sessions SET data = $data, lastActive = $now WHERE token = $token
`)
const deleteSession = db.query(`DELETE FROM sessions WHERE token = $token`)

const setSessionCookie = function (ctx, token) {
  ctx.cookies.set(cookieName, token, {
    maxAge: config.session.sessionCookieMaxAge,
    secure: config.isProduction,
    httpOnly: true,
    sameSite: `lax`,
    overwrite: true,
  })
}

// The data column is JSON text; hand the rest of the app a parsed object
const readSession = function (row) {
  const data = JSON.parse(row.data)

  return { ...row, data }
}

const findSession = function (token) {
  const row = selectSession.get({ token })

  if (row == null) {
    return null
  }

  return readSession(row)
}

const createSession = function (token, data) {
  const now = new Date().toISOString()
  const dataText = JSON.stringify(data)

  insertSession.run({ token, now, data: dataText })

  return findSession(token)
}

export default async function (ctx, next) {
  if (ctx.meta.session === true) {
    let token

    const cookieToken = ctx.cookies.get(cookieName)

    if (_.isString(cookieToken) && !_.isEmpty(cookieToken)) {
      token = cookieToken
    }

    let session = null

    if (!_.isEmpty(token) && token.length === 40) {
      session = findSession(token)
    }

    if (session == null) {
      token = uniqueId(40)

      session = createSession(token, {})

      console.log(`WRITING COOKIE -------------------------------------- ${token?.slice(0, 6)}`)
      setSessionCookie(ctx, token)
    }

    ctx.state.token = token
    ctx.state.session = session
    ctx.state.username = session.data.username

    ctx.writeSession = function (key, value) {
      const data = { ...ctx.state.session.data, [key]: value }
      const dataText = JSON.stringify(data)
      const now = new Date().toISOString()

      updateSessionData.run({ token: ctx.state.token, data: dataText, now })

      ctx.state.session = findSession(ctx.state.token)
    }

    // Swap to a new token and delete the old session row, so a token issued
    // before login (or before logout) can't be reused
    ctx.regenerateSession = function ({ keepData = true } = {}) {
      const newToken = uniqueId(40)
      const oldToken = ctx.state.token

      let data = {}

      if (keepData === true) {
        data = ctx.state.session.data ?? {}
      }

      const swapSession = db.transaction(function () {
        const created = createSession(newToken, data)
        deleteSession.run({ token: oldToken })
        return created
      })

      const newSession = swapSession()

      setSessionCookie(ctx, newToken)

      ctx.state.token = newToken
      ctx.state.session = newSession
      ctx.state.username = newSession.data.username
    }
  }

  await next()
}
