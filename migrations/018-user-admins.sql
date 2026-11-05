-- Admins: users who will get rook's administrative features, when there are some. Set when an
-- account is made with scripts/users.js, or changed there. User 1, the owner, is one.

ALTER TABLE users ADD COLUMN isAdmin INTEGER NOT NULL DEFAULT 0;

UPDATE users SET isAdmin = 1 WHERE id = 1;
