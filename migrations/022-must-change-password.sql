-- Set when an admin picks someone else's password on Admin → Users, whether for a new user or as
-- a reset: that user is made to choose their own the next time they log in (middleware/auth.js),
-- and choosing it clears this. A password the user set themselves leaves it at 0.
ALTER TABLE users ADD COLUMN mustChangePassword INTEGER NOT NULL DEFAULT 0;
