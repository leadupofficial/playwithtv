-- Every game that starts, and how it ended: finished (reached its results), quit (the TV or captain left it
-- mid-game) or abandoned (the room closed while it ran). matches only holds finished games, so on its own it
-- cannot tell which games people give up on.
CREATE TABLE IF NOT EXISTS plays (
  id            BIGSERIAL PRIMARY KEY,
  session_id    UUID NOT NULL,
  game_id       TEXT NOT NULL,
  players       INTEGER NOT NULL,
  started_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at      TIMESTAMPTZ,
  outcome       TEXT
);
CREATE INDEX IF NOT EXISTS plays_started ON plays (started_at DESC);
CREATE INDEX IF NOT EXISTS plays_game ON plays (game_id, started_at DESC);
