-- Durable data only. Live presence and per-frame input never touch Postgres.
CREATE TABLE IF NOT EXISTS games (
  id            TEXT PRIMARY KEY,
  title         TEXT NOT NULL,
  manifest      JSONB NOT NULL,
  enabled       BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS game_versions (
  game_id       TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  version       TEXT NOT NULL,
  released_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (game_id, version)
);

CREATE TABLE IF NOT EXISTS asset_licences (
  id            BIGSERIAL PRIMARY KEY,
  game_id       TEXT REFERENCES games(id) ON DELETE SET NULL,
  asset_path    TEXT NOT NULL,
  licence       TEXT NOT NULL,          -- e.g. 'original', 'CC0-1.0', 'MIT'
  source        TEXT NOT NULL,
  attribution   TEXT,
  UNIQUE (game_id, asset_path)
);

-- A room's life on the platform (one row per room, no join secrets stored).
CREATE TABLE IF NOT EXISTS sessions (
  id            UUID PRIMARY KEY,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at      TIMESTAMPTZ,
  end_reason    TEXT
);

CREATE TABLE IF NOT EXISTS session_players (
  session_id    UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  player_id     TEXT NOT NULL,
  display_name  TEXT NOT NULL,
  avatar        TEXT NOT NULL,
  joined_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (session_id, player_id)
);

CREATE TABLE IF NOT EXISTS matches (
  id            BIGSERIAL PRIMARY KEY,
  session_id    UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  game_id       TEXT NOT NULL REFERENCES games(id),
  game_version  TEXT NOT NULL,
  started_at    TIMESTAMPTZ NOT NULL,
  finished_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  duration_ms   INTEGER NOT NULL CHECK (duration_ms >= 0)
);
CREATE INDEX IF NOT EXISTS matches_game_finished ON matches (game_id, finished_at DESC);

CREATE TABLE IF NOT EXISTS match_results (
  match_id      BIGINT NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  player_id     TEXT NOT NULL,
  score         DOUBLE PRECISION NOT NULL,
  place         SMALLINT NOT NULL CHECK (place >= 1),
  PRIMARY KEY (match_id, player_id)
);

-- Operational events (errors, rate limiting) for the admin console; pruned after 30 days.
CREATE TABLE IF NOT EXISTS ops_events (
  id            BIGSERIAL PRIMARY KEY,
  at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  kind          TEXT NOT NULL,
  detail        JSONB NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS ops_events_at ON ops_events (at DESC);
