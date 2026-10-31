
import Bun from 'bun'
import config from '../../configure.js'
import joi from '../../services/joi.js'

// Checked when no owner password is configured, so a missing passhash never lets anyone in
const dummyHash = await Bun.password.hash(`not-a-real-password`)

const verifyPassword = async function (password, passhash) {
  try {
    // Accepts both argon2 and bcrypt hashes
    return await Bun.password.verify(password, passhash)
  } catch (e) {
    return false
  }
}

export const GET = async function (ctx) {
  ctx.body = ctx.nunjucks(`auth/login`)
}

export const POST = async function (ctx) {
  let args

  try {
    args = await joi.object({
      email: joi.string().trim().required(),
      password: joi.string().required(),
    }).validateAsync(ctx.request.body)
  } catch (e) {
    ctx.addFlash(e.message, `error`)
    return ctx.redirect(`/auth/login`)
  }

  const owner = config.owner ?? {}
  const ownerEmail = owner.email ?? ``
  const passhash = owner.passhash ?? dummyHash

  const isOwnerEmail = args.email.toLowerCase() === ownerEmail.toLowerCase()
  const isValidPassword = await verifyPassword(args.password, passhash)

  if (isOwnerEmail === false || isValidPassword === false) {
    ctx.addFlash(`Invalid email or password.`, `error`)
    return ctx.redirect(`/auth/login?username=${encodeURIComponent(args.email)}`)
  }

  ctx.regenerateSession()
  ctx.writeSession(`loggedIn`, true)
  ctx.writeSession(`username`, ownerEmail)

  return ctx.redirect(ctx.state.session?.data?.redirectAfterLogin || `/`)
}
