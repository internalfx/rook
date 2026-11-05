
import Bun from 'bun'
import joi from '../../services/joi.js'
import users from '../../services/users.js'

// Checked when there's no user with the email given, so the time taken doesn't say which emails
// have accounts
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

  const login = users.findLogin(args.email)
  const passhash = login?.passhash ?? dummyHash

  const isValidPassword = await verifyPassword(args.password, passhash)

  if (login == null || isValidPassword === false) {
    ctx.addFlash(`Invalid email or password.`, `error`)
    return ctx.redirect(`/auth/login?username=${encodeURIComponent(args.email)}`)
  }

  ctx.regenerateSession()
  ctx.writeSession(`userId`, login.id)

  return ctx.redirect(ctx.state.session?.data?.redirectAfterLogin || `/`)
}
