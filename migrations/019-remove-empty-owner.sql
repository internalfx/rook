-- 017 made user 1 as an empty row for the first start to fill in from config.js. That's gone:
-- accounts are made with scripts/users.js, and the first one is the admin. A fresh install's
-- empty row goes here; an install whose user 1 was filled in keeps it.

DELETE FROM users WHERE passhash = '';
