-- Anonymous install ids (random, made by the browser) so the operator can count unique and returning
-- phones and TVs. No IP addresses or fingerprints are stored. Rows from before this migration have none.
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS tv_device TEXT;
ALTER TABLE session_players ADD COLUMN IF NOT EXISTS device TEXT;
CREATE INDEX IF NOT EXISTS sessions_created ON sessions (created_at DESC);
CREATE INDEX IF NOT EXISTS sessions_tv_device ON sessions (tv_device) WHERE tv_device IS NOT NULL;
CREATE INDEX IF NOT EXISTS session_players_joined ON session_players (joined_at DESC);
CREATE INDEX IF NOT EXISTS session_players_device ON session_players (device) WHERE device IS NOT NULL;

-- Highest live counts seen per day (India time), raised by the hub as they happen.
CREATE TABLE IF NOT EXISTS daily_peaks (
  day           DATE PRIMARY KEY,
  tvs           INTEGER NOT NULL DEFAULT 0,
  phones        INTEGER NOT NULL DEFAULT 0,
  rooms         INTEGER NOT NULL DEFAULT 0
);
