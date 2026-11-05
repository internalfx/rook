// import config from '../configure.js'
import { createRouter, addRoute, findRoute } from 'rou3'

const defaultMeta = {
  session: true,
  secure: true,
}

const metaRouter = createRouter({})
addRoute(metaRouter, null, `/**`, { ...defaultMeta })

// META ROUTES
addRoute(metaRouter, null, `/auth/**`, { ...defaultMeta, secure: false })

// Only admins (users.isAdmin); the rest get a 404 (see middleware/auth.js)
addRoute(metaRouter, null, `/admin/**`, { ...defaultMeta, admin: true })

addRoute(metaRouter, null, `/static/**`, { ...defaultMeta, session: false, secure: false })
addRoute(metaRouter, null, `/dist/**`, { ...defaultMeta, session: false, secure: false })
addRoute(metaRouter, null, `/favicon.ico`, { ...defaultMeta, session: false, secure: false })
addRoute(metaRouter, null, `/favicon.svg`, { ...defaultMeta, session: false, secure: false })

export default async function (ctx, next) {
  const metaRoute = findRoute(metaRouter, null, ctx.path)

  ctx.meta = metaRoute.data

  await next()
}
