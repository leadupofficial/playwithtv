-- Sponsors shown on TVs, and daily impression counts per sponsor and placement (no viewer data at all).
CREATE TABLE IF NOT EXISTS ad_creatives (
  id            UUID PRIMARY KEY,
  advertiser    TEXT NOT NULL,
  title         TEXT NOT NULL,
  line          TEXT NOT NULL DEFAULT '',
  placements    TEXT[] NOT NULL,
  starts_on     DATE NOT NULL,
  ends_on       DATE NOT NULL,
  enabled       BOOLEAN NOT NULL DEFAULT TRUE,
  image         BYTEA,
  image_type    TEXT,
  image_version INT NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ad_impressions (
  creative_id   UUID NOT NULL REFERENCES ad_creatives(id) ON DELETE CASCADE,
  placement     TEXT NOT NULL,
  day           DATE NOT NULL,
  count         BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY (creative_id, placement, day)
);
