
export const GET = async function (ctx) {
  ctx.regenerateSession({ keepData: false })

  ctx.addFlash(`Logged Out!`, `success`)
  return ctx.redirect(`/auth/login`)
}
