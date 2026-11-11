// What the Settings pages share (routes/settings/): each is a page of its own in the Settings group
// of the sidebar, with one form and a Save bar.

// Where a Settings page goes once it has saved: back to itself (`page`), or on to `returnTo`,
// the link its "Save your changes?" dialog was opened by (see
// templates/partials/settingsFormScript.njk). Only a page in rook: browsers read "//example.com"
// and "/\example.com" as another site.
export const readDestination = function (returnTo, page) {
  const target = returnTo ?? ``
  const isRookPath = target.startsWith(`/`) && target.startsWith(`//`) === false && target.includes(`\\`) === false

  return isRookPath ? target : page
}

export default {
  readDestination,
}
