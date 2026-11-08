-- Notifications the model sent the owner (briefings only, for now), kept in rook and pushed to
-- their phone through ntfy when it's set up in Settings (see lib/notifications.js)

CREATE TABLE notifications (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  -- high is pushed with ntfy's high priority, which makes the phone more insistent
  priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('normal', 'high')),
  -- The briefing that sent it; kept when old briefings are deleted
  briefingId TEXT REFERENCES briefings (id) ON DELETE SET NULL,
  -- How pushing it went: 'sent', 'failed' (see pushError), or 'off' when ntfy isn't set up
  pushStatus TEXT NOT NULL CHECK (pushStatus IN ('sent', 'failed', 'off')),
  pushError TEXT,
  createdAt TEXT NOT NULL
);

CREATE INDEX notifications_createdAt ON notifications (createdAt);
CREATE INDEX notifications_briefingId ON notifications (briefingId);
