-- ReelScope schema.
--
-- reels: one row per reel or YouTube video (upserted on every save; first_saved_at
-- is kept, everything else is refreshed from the latest payload).
-- snapshots: one row per save, capturing the stats at that moment.
-- reel_latest: each reel joined with its latest snapshot plus derived columns
-- (age at capture, views-per-follower, views-per-hour).

CREATE TABLE IF NOT EXISTS reels (
  shortcode        TEXT PRIMARY KEY,
  url              TEXT NOT NULL,
  media_id         TEXT,
  author_username  TEXT NOT NULL,
  author_full_name TEXT,
  author_followers INTEGER,
  caption          TEXT,
  audio_title      TEXT,
  duration_sec     REAL,
  taken_at         TEXT,
  first_saved_at   TEXT NOT NULL,
  last_saved_at    TEXT NOT NULL,
  status           TEXT NOT NULL DEFAULT 'new',
  tags             TEXT NOT NULL DEFAULT '[]',
  notes            TEXT,
  raw_json         TEXT,
  -- 'instagram' or 'youtube' (shortcode = the 11-char video id, author_username
  -- = the channel handle without '@'; lib/youtube.ts).
  platform         TEXT NOT NULL DEFAULT 'instagram'
);

CREATE TABLE IF NOT EXISTS snapshots (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  shortcode        TEXT NOT NULL REFERENCES reels(shortcode),
  captured_at      TEXT NOT NULL,
  play_count       INTEGER,
  view_count       INTEGER,
  like_count       INTEGER,
  comment_count    INTEGER,
  share_count      INTEGER,
  author_followers INTEGER,
  channel_baseline_views REAL,
  channel_multiple REAL,
  channel_tier     TEXT
);

CREATE INDEX IF NOT EXISTS idx_snapshots_shortcode ON snapshots(shortcode);
CREATE INDEX IF NOT EXISTS idx_reels_status ON reels(status);

-- Profile scans: one row per analyzed creator profile (channel baseline).
CREATE TABLE IF NOT EXISTS profile_scans (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  username       TEXT NOT NULL,
  user_id        TEXT,
  full_name      TEXT,
  followers      INTEGER,
  scanned_at     TEXT NOT NULL,
  sample_size    INTEGER NOT NULL,
  threshold      REAL NOT NULL DEFAULT 2,
  baseline_views REAL,
  stats_json     TEXT NOT NULL,
  reels_json     TEXT NOT NULL,
  -- A username is only unique per platform: a creator often has the same
  -- handle on Instagram and YouTube.
  platform       TEXT NOT NULL DEFAULT 'instagram',
  -- 'short': reels or a channel's Shorts; 'long': a YouTube channel's
  -- long-form videos. Scored apart, so a channel can have one of each.
  format         TEXT NOT NULL DEFAULT 'short'
);

CREATE INDEX IF NOT EXISTS idx_profile_scans_username ON profile_scans(username);

DROP VIEW IF EXISTS reel_latest;
CREATE VIEW reel_latest AS
SELECT
  r.shortcode,
  r.url,
  r.media_id,
  r.author_username,
  r.author_full_name,
  r.author_followers,
  r.caption,
  r.audio_title,
  r.duration_sec,
  r.taken_at,
  r.first_saved_at,
  r.last_saved_at,
  r.status,
  r.tags,
  r.notes,
  r.raw_json,
  r.platform,
  s.id AS snapshot_id,
  s.captured_at AS snapshot_captured_at,
  s.play_count AS latest_play_count,
  s.view_count AS latest_view_count,
  s.like_count AS latest_like_count,
  s.comment_count AS latest_comment_count,
  s.share_count AS latest_share_count,
  s.author_followers AS latest_author_followers,
  s.channel_baseline_views AS channel_baseline_views,
  s.channel_multiple AS channel_multiple,
  s.channel_tier AS channel_tier,
  COALESCE(s.play_count, s.view_count) AS latest_views,
  CASE
    WHEN r.taken_at IS NOT NULL
    THEN (strftime('%s', s.captured_at) - strftime('%s', r.taken_at)) / 3600.0
  END AS age_hours,
  (COALESCE(s.play_count, s.view_count) * 1.0)
    / NULLIF(COALESCE(s.author_followers, r.author_followers), 0)
    AS views_per_follower,
  (COALESCE(s.play_count, s.view_count) * 1.0)
    / NULLIF(
        (strftime('%s', s.captured_at) - strftime('%s', r.taken_at)) / 3600.0,
        0
      )
    AS views_per_hour
FROM reels r
JOIN snapshots s
  ON s.id = (SELECT MAX(id) FROM snapshots WHERE shortcode = r.shortcode);
