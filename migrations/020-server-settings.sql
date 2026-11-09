-- Settings for the whole server, changed by an admin on Admin → Settings (lib/serverSettings.js):
-- the Lemonade server and its key, which models to use, which tools are on and the sites web pages
-- may be read from, and the briefing schedule. Key/value rows like userSettings, with the value as
-- JSON {"v": ...}. These used to be in config.js; a first start with that file still there copies
-- its values in.

CREATE TABLE serverSettings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);
