// Local ReelScope server. Zero npm deps; run with `bun server/index.ts`
// (or `bun run server`). DB lives at data/reelscope.db.
import { Database } from 'bun:sqlite';
import { existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import schemaSql from './schema.sql' with { type: 'text' };
import { tierForMultiple } from '../lib/outliers';
import { pickThumbUrl, pickVideoUrl } from '../lib/profile';
import {
  buildChannelScan,
  anchorPositions,
  channelKey,
  channelUrl,
  infoSummary,
  infoUploadMs,
  missingViewPositions,
  profileFromPlaylist,
  saveFromInfo,
  thumbCandidates,
  windowEnd,
  YT_ID_RE,
} from '../lib/youtube';
import { YtError, ytDownload, ytInfo, ytListChannel } from '../lib/ytdlp';
import type { Platform, ProfileReel, ScanFormat, YtInfoSummary, YtScanState } from '../lib/types';

const PORT = Number(Bun.env.PORT ?? '8788');
// DB_PATH override exists for tests; default (and documented) location below.
const DB_PATH = Bun.env.DB_PATH ?? 'data/reelscope.db';
// THUMBS_DIR override exists for tests; cached reel thumbnails live here.
const THUMBS_DIR = Bun.env.THUMBS_DIR ?? 'data/thumbs';
// VIDEOS_DIR override exists for tests; full saved reel videos live here.
const VIDEOS_DIR = Bun.env.VIDEOS_DIR ?? 'data/videos';
// ffmpeg that yt-dlp merges YouTube video + audio with (stream copy, no
// re-encode). Unset: whatever ffmpeg is on PATH.
const FFMPEG = Bun.env.FFMPEG || undefined;

const STATUSES = new Set(['new', 'analyzed', 'in_report', 'rejected']);
const SHORTCODE_RE = /^[A-Za-z0-9_-]{1,64}$/;
const THUMB_RE = /^[A-Za-z0-9_-]+$/;

function dirOf(path: string): string {
  const i = path.replace(/\\/g, '/').lastIndexOf('/');
  return i < 0 ? '.' : path.slice(0, i) || '.';
}
mkdirSync(dirOf(DB_PATH), { recursive: true });
mkdirSync(THUMBS_DIR, { recursive: true });
mkdirSync(VIDEOS_DIR, { recursive: true });

const db = new Database(DB_PATH, { create: true });
db.exec('PRAGMA journal_mode = WAL;');
// CREATE ... IF NOT EXISTS + the reel_latest view: safe to run on every start.
db.exec(schemaSql);

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function isFiniteNum(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function isIsoDate(v: unknown): v is string {
  return typeof v === 'string' && !Number.isNaN(Date.parse(v));
}

interface ValidSave {
  platform: Platform;
  shortcode: string;
  url: string;
  mediaId: string | null;
  username: string;
  fullName: string | null;
  followers: number | null;
  caption: string | null;
  audioTitle: string | null;
  durationSec: number | null;
  takenAt: string | null;
  playCount: number | null;
  viewCount: number | null;
  likeCount: number | null;
  commentCount: number | null;
  shareCount: number | null;
  capturedAt: string;
  rawJson: string | null;
  /** Unstringified raw payload (Instagram media item), used for thumb caching. */
  raw: unknown;
  /** YouTube: a Short (portrait thumbnail) rather than a long-form video. */
  short?: boolean;
  /** Channel-baseline context, when the client attached one. */
  channel: {
    baselineViews: number;
    multiple: number;
    tier: string;
    sampleSize: number;
    scannedAt: string;
  } | null;
}

type Validation = { ok: true; value: ValidSave } | { ok: false; error: string };

function optStr(v: unknown): string | null {
  return typeof v === 'string' ? v : null;
}

function optNum(v: unknown): number | null {
  return isFiniteNum(v) ? v : null;
}

/** Channel-baseline context attached to a save (absent or null: none). */
function validateChannel(v: unknown): { ok: true; value: ValidSave['channel'] } | { ok: false; error: string } {
  if (v === undefined || v === null) return { ok: true, value: null };
  if (typeof v !== 'object') return { ok: false, error: 'channel must be an object' };
  const c = v as Record<string, unknown>;
  if (
    !isFiniteNum(c.baselineViews) ||
    !isFiniteNum(c.multiple) ||
    typeof c.tier !== 'string' ||
    !isFiniteNum(c.sampleSize) ||
    !isIsoDate(c.scannedAt)
  ) {
    return {
      ok: false,
      error: 'channel must have numeric baselineViews/multiple/sampleSize, string tier, ISO scannedAt',
    };
  }
  return {
    ok: true,
    value: {
      baselineViews: c.baselineViews as number,
      multiple: c.multiple as number,
      tier: c.tier as string,
      sampleSize: c.sampleSize as number,
      scannedAt: c.scannedAt as string,
    },
  };
}

function validateSave(body: unknown): Validation {
  if (!body || typeof body !== 'object') {
    return { ok: false, error: 'body must be a JSON object' };
  }
  const b = body as Record<string, unknown>;

  if (typeof b.shortcode !== 'string' || !SHORTCODE_RE.test(b.shortcode)) {
    return { ok: false, error: 'shortcode is required (letters, digits, -, _)' };
  }
  if (typeof b.url !== 'string' || b.url.length === 0) {
    return { ok: false, error: 'url is required' };
  }
  const author = b.author;
  if (!author || typeof author !== 'object') {
    return { ok: false, error: 'author is required' };
  }
  const arec = author as Record<string, unknown>;
  if (typeof arec.username !== 'string' || arec.username.length === 0) {
    return { ok: false, error: 'author.username is required' };
  }
  if (!isIsoDate(b.capturedAt)) {
    return { ok: false, error: 'capturedAt must be an ISO date string' };
  }
  const stats = b.stats;
  if (!stats || typeof stats !== 'object') {
    return { ok: false, error: 'stats is required' };
  }
  const srec = stats as Record<string, unknown>;
  for (const key of ['playCount', 'viewCount', 'likeCount', 'commentCount', 'shareCount']) {
    const v = srec[key];
    if (v !== undefined && v !== null && !isFiniteNum(v)) {
      return { ok: false, error: `stats.${key} must be a number` };
    }
  }
  if (b.takenAt !== undefined && b.takenAt !== null && !isIsoDate(b.takenAt)) {
    return { ok: false, error: 'takenAt must be an ISO date string' };
  }
  if (b.source !== undefined && b.source !== 'api' && b.source !== 'dom') {
    return { ok: false, error: "source must be 'api' or 'dom'" };
  }

  let rawJson: string | null = null;
  if (b.raw !== undefined) {
    try {
      rawJson = JSON.stringify(b.raw) ?? null;
    } catch {
      rawJson = null;
    }
  }

  const ch = validateChannel(b.channel);
  if (!ch.ok) return ch;
  const channel = ch.value;

  return {
    ok: true,
    value: {
      platform: 'instagram',
      shortcode: b.shortcode,
      url: b.url,
      mediaId: optStr(b.mediaId),
      username: arec.username,
      fullName: optStr(arec.fullName),
      followers: optNum(arec.followers),
      caption: optStr(b.caption),
      audioTitle: optStr(b.audioTitle),
      durationSec: optNum(b.durationSec),
      takenAt: typeof b.takenAt === 'string' ? b.takenAt : null,
      playCount: optNum(srec.playCount),
      viewCount: optNum(srec.viewCount),
      likeCount: optNum(srec.likeCount),
      commentCount: optNum(srec.commentCount),
      shareCount: optNum(srec.shareCount),
      capturedAt: b.capturedAt,
      rawJson,
      raw: b.raw,
      channel,
    },
  };
}

/**
 * A YouTube save only names the video; the numbers come from YouTube itself
 * (yt-dlp, about 2 s), not from the page.
 */
async function youtubeSave(body: Record<string, unknown>): Promise<Validation & { status?: number }> {
  if (typeof body.shortcode !== 'string' || !YT_ID_RE.test(body.shortcode)) {
    return { ok: false, error: 'shortcode must be an 11-character YouTube video id', status: 400 };
  }
  const ch = validateChannel(body.channel);
  if (!ch.ok) return { ...ch, status: 400 };
  let info: Record<string, unknown>;
  try {
    info = await ytInfo(body.shortcode);
  } catch (e) {
    // Private, removed, …: saying so beats queueing it forever. Anything else may pass.
    const gone = e instanceof YtError && e.kind !== 'retry';
    return { ok: false, error: `YouTube: ${e instanceof Error ? e.message : String(e)}`, status: gone ? 422 : 503 };
  }
  const y = saveFromInfo(info);
  if (!y) return { ok: false, error: "YouTube: couldn't read this video's channel", status: 422 };
  const capturedAt = isIsoDate(body.capturedAt) ? body.capturedAt : new Date().toISOString();
  return {
    ok: true,
    value: {
      platform: 'youtube',
      shortcode: y.shortcode,
      url: y.url,
      mediaId: null,
      username: y.username,
      fullName: y.fullName,
      followers: y.followers,
      caption: y.caption,
      audioTitle: y.audioTitle,
      durationSec: y.durationSec,
      takenAt: y.takenAt,
      playCount: null,
      viewCount: y.viewCount,
      likeCount: y.likeCount,
      commentCount: y.commentCount,
      shareCount: null,
      capturedAt,
      rawJson: JSON.stringify(y.raw),
      raw: y.raw,
      short: y.short,
      channel: ch.value,
    },
  };
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>;

const existsStmt = db.query<Row>('SELECT shortcode FROM reels WHERE shortcode = ?');
const latestStmt = db.query<Row>('SELECT * FROM reel_latest WHERE shortcode = ?');
const allSnapshotsStmt = db.query<Row>(
  'SELECT * FROM snapshots WHERE shortcode = ? ORDER BY captured_at ASC, id ASC',
);

const upsertStmt = db.query(`
  INSERT INTO reels (
    shortcode, url, media_id, author_username, author_full_name, author_followers,
    caption, audio_title, duration_sec, taken_at,
    first_saved_at, last_saved_at, status, tags, notes, raw_json, platform
  ) VALUES (
    ?, ?, ?, ?, ?, ?,
    ?, ?, ?, ?,
    ?, ?, 'new', '[]', NULL, ?, ?
  )
  ON CONFLICT(shortcode) DO UPDATE SET
    url = excluded.url,
    media_id = COALESCE(excluded.media_id, reels.media_id),
    author_username = excluded.author_username,
    author_full_name = COALESCE(excluded.author_full_name, reels.author_full_name),
    author_followers = COALESCE(excluded.author_followers, reels.author_followers),
    caption = COALESCE(excluded.caption, reels.caption),
    audio_title = COALESCE(excluded.audio_title, reels.audio_title),
    duration_sec = COALESCE(excluded.duration_sec, reels.duration_sec),
    taken_at = COALESCE(excluded.taken_at, reels.taken_at),
    last_saved_at = excluded.last_saved_at,
    raw_json = COALESCE(excluded.raw_json, reels.raw_json)
`);

const insertSnapshotStmt = db.query(`
  INSERT INTO snapshots (
    shortcode, captured_at, play_count, view_count, like_count,
    comment_count, share_count, author_followers,
    channel_baseline_views, channel_multiple, channel_tier
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const latestScanForUserStmt = db.query<Row>(
  'SELECT baseline_views, threshold FROM profile_scans WHERE username = ? AND platform = ? AND format = ? ORDER BY id DESC LIMIT 1',
);

/** Parse the JSON-array tags column for API output, and say what is cached on disk. */
function presentReel(row: Row): Row {
  let tags: unknown = [];
  try {
    tags = JSON.parse(typeof row.tags === 'string' ? row.tags : '[]');
  } catch {
    tags = [];
  }
  if (!Array.isArray(tags)) tags = [];
  const video = savedVideo(row.shortcode);
  return {
    ...row,
    tags,
    has_thumb: hasThumb(row.shortcode),
    // The full video cached at save time (absolute path on this machine).
    has_video: video !== null,
    video_file: video,
  };
}

// ---------------------------------------------------------------------------
// Thumbnails (cached Instagram CDN images; CDN URLs expire after a few days)
// ---------------------------------------------------------------------------

function thumbPath(shortcode: string): string {
  return `${THUMBS_DIR}/${shortcode}.jpg`;
}

/** Absolute path of the reel's cached video, or null when it wasn't downloaded. */
function savedVideo(shortcode: unknown): string | null {
  if (typeof shortcode !== 'string' || !SHORTCODE_RE.test(shortcode)) return null;
  const p = videoPath(shortcode);
  try {
    return existsSync(p) ? resolve(p) : null;
  } catch {
    return null;
  }
}

function hasThumb(shortcode: unknown): boolean {
  if (typeof shortcode !== 'string' || !SHORTCODE_RE.test(shortcode)) return false;
  try {
    return existsSync(thumbPath(shortcode));
  } catch {
    return false;
  }
}

/**
 * Download the reel thumbnail into THUMBS_DIR. Never throws; callers must
 * fire-and-forget it so it can't fail or delay the save response.
 */
async function cacheThumbnail(shortcode: string, raw: unknown): Promise<void> {
  try {
    if (!SHORTCODE_RE.test(shortcode)) return;
    const dest = thumbPath(shortcode);
    if (existsSync(dest)) return;
    const thumbUrl = isRecord(raw) ? pickThumbUrl(raw) : undefined;
    if (!thumbUrl) return;
    const res = await fetch(thumbUrl, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) {
      console.error(`thumb download failed for ${shortcode}: HTTP ${res.status}`);
      return;
    }
    const buf = await res.arrayBuffer();
    await Bun.write(Bun.file(dest), buf);
  } catch (e) {
    console.error(`thumb download failed for ${shortcode}:`, e);
  }
}

function videoPath(shortcode: string): string {
  return `${VIDEOS_DIR}/${shortcode}.mp4`;
}

/**
 * Download the reel video into VIDEOS_DIR. Never throws; callers must
 * fire-and-forget it so it can't fail or delay the save response.
 * CDN URLs are signed and expire — which is why we grab the video immediately.
 */
async function cacheVideo(shortcode: string, raw: unknown): Promise<void> {
  try {
    if (!SHORTCODE_RE.test(shortcode)) return;
    const dest = videoPath(shortcode);
    if (existsSync(dest)) return;
    const videoUrl = isRecord(raw) ? pickVideoUrl(raw) : undefined;
    if (!videoUrl) return;
    const res = await fetch(videoUrl, { signal: AbortSignal.timeout(60_000) });
    if (!res.ok) {
      console.error(`video download failed for ${shortcode}: HTTP ${res.status}`);
      return;
    }
    const buf = await res.arrayBuffer();
    await Bun.write(Bun.file(dest), buf);
  } catch (e) {
    console.error(`video download failed for ${shortcode}:`, e);
  }
}

/** A YouTube thumbnail: the portrait one for a Short, else the widest there is. Never throws. */
async function cacheYoutubeThumb(id: string, short: boolean): Promise<void> {
  const dest = thumbPath(id);
  if (existsSync(dest)) return;
  for (const u of thumbCandidates(id, short)) {
    try {
      const res = await fetch(u, { signal: AbortSignal.timeout(10_000) });
      if (!res.ok) continue;
      await Bun.write(Bun.file(dest), await res.arrayBuffer());
      return;
    } catch {
      // next candidate
    }
  }
  console.error(`thumb download failed for youtube ${id}`);
}

/**
 * YouTube videos come through yt-dlp, one at a time (a bulk save of 40
 * outliers queues 40 downloads, not 40 processes).
 */
let ytQueue: Promise<void> = Promise.resolve();
const ytQueued = new Set<string>();
function cacheYoutubeVideo(id: string): void {
  if (ytQueued.has(id) || existsSync(videoPath(id))) return;
  ytQueued.add(id);
  ytQueue = ytQueue.then(async () => {
    try {
      await ytDownload(id, VIDEOS_DIR, FFMPEG);
    } catch (e) {
      console.error(`video download failed for youtube ${id}:`, e instanceof Error ? e.message : e);
    } finally {
      ytQueued.delete(id);
    }
  });
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

function json(data: unknown, status: number, cors: Record<string, string>): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
}

function handlePostSave(v: ValidSave, cors: Record<string, string>): Response {
  const isNew = existsStmt.get(v.shortcode) === null;
  // Channel context: prefer the client's, else backfill from the latest
  // profile scan for this author (same tier thresholds as lib/outliers).
  let chBaseline: number | null = v.channel?.baselineViews ?? null;
  let chMultiple: number | null = v.channel?.multiple ?? null;
  let chTier: string | null = v.channel?.tier ?? null;
  if (!v.channel) {
    // A long YouTube video is measured against their long videos, a Short against their Shorts.
    const format: ScanFormat = v.platform === 'youtube' && v.short === false ? 'long' : 'short';
    const scan = latestScanForUserStmt.get(v.username, v.platform, format) as Row | null;
    const baseline = scan ? Number(scan.baseline_views) : NaN;
    const views = v.playCount ?? v.viewCount;
    if (scan && Number.isFinite(baseline) && baseline > 0 && views !== null) {
      chBaseline = baseline;
      chMultiple = (views as number) / baseline;
      chTier = tierForMultiple(chMultiple, Number(scan.threshold) || 2);
    }
  }
  upsertStmt.run(
    v.shortcode,
    v.url,
    v.mediaId,
    v.username,
    v.fullName,
    v.followers,
    v.caption,
    v.audioTitle,
    v.durationSec,
    v.takenAt,
    v.capturedAt, // first_saved_at (kept on conflict)
    v.capturedAt, // last_saved_at
    v.rawJson,
    v.platform,
  );
  insertSnapshotStmt.run(
    v.shortcode,
    v.capturedAt,
    v.playCount,
    v.viewCount,
    v.likeCount,
    v.commentCount,
    v.shareCount,
    v.followers,
    chBaseline,
    chMultiple,
    chTier,
  );
  // Fire-and-forget: must never fail or delay the save response.
  if (v.platform === 'youtube') {
    void cacheYoutubeThumb(v.shortcode, v.short ?? false);
    cacheYoutubeVideo(v.shortcode);
  } else {
    void cacheThumbnail(v.shortcode, v.raw);
    void cacheVideo(v.shortcode, v.raw);
  }
  const row = latestStmt.get(v.shortcode);
  return json({ ok: true, isNew, data: row ? presentReel(row) : null }, 200, cors);
}

const SORTS: Record<string, string> = {
  saved: 'last_saved_at DESC',
  views: 'latest_views IS NULL, latest_views DESC',
  outlier: 'views_per_follower IS NULL, views_per_follower DESC',
  velocity: 'views_per_hour IS NULL, views_per_hour DESC',
  newest_upload: 'taken_at IS NULL, taken_at DESC',
};

/** Escape LIKE wildcards so q= does a literal substring match. */
function likePattern(q: string): string {
  return `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
}

function handleList(url: URL, cors: Record<string, string>): Response {
  const status = url.searchParams.get('status');
  if (status !== null && !STATUSES.has(status)) {
    return json(
      { ok: false, error: `status must be one of: ${[...STATUSES].join(', ')}` },
      400,
      cors,
    );
  }
  let limit = Number(url.searchParams.get('limit') ?? '50');
  if (!Number.isFinite(limit)) {
    return json({ ok: false, error: 'limit must be a number' }, 400, cors);
  }
  limit = Math.min(Math.max(Math.floor(limit), 1), 1000);

  const sortKey = url.searchParams.get('sort') ?? 'saved';
  const orderBy = SORTS[sortKey];
  if (!orderBy) {
    return json(
      { ok: false, error: `sort must be one of: ${Object.keys(SORTS).join(', ')}` },
      400,
      cors,
    );
  }

  const q = url.searchParams.get('q');
  const where: string[] = [];
  const params: unknown[] = [];
  if (status) {
    where.push('status = ?');
    params.push(status);
  }
  const platform = url.searchParams.get('platform');
  if (platform === 'instagram' || platform === 'youtube') {
    where.push('platform = ?');
    params.push(platform);
  }
  const author = url.searchParams.get('author');
  if (author) {
    where.push('author_username = ? COLLATE NOCASE');
    params.push(author);
  }
  if (q !== null && q !== '') {
    where.push(
      '(author_username LIKE ? ESCAPE \'\\\' COLLATE NOCASE OR caption LIKE ? ESCAPE \'\\\' COLLATE NOCASE OR notes LIKE ? ESCAPE \'\\\' COLLATE NOCASE)',
    );
    const pat = likePattern(q);
    params.push(pat, pat, pat);
  }
  const sql =
    `SELECT * FROM reel_latest` +
    (where.length > 0 ? ` WHERE ${where.join(' AND ')}` : '') +
    ` ORDER BY ${orderBy} LIMIT ?`;
  params.push(limit);
  const rows = db.query<Row>(sql).all(...params);
  return json({ ok: true, data: rows.map(presentReel) }, 200, cors);
}

function handleThumb(shortcode: string, cors: Record<string, string>): Response {
  if (!THUMB_RE.test(shortcode)) {
    return json({ ok: false, error: 'not found' }, 404, cors);
  }
  const p = thumbPath(shortcode);
  let found = false;
  try {
    found = existsSync(p);
  } catch {
    found = false;
  }
  if (!found) return json({ ok: false, error: 'not found' }, 404, cors);
  return new Response(Bun.file(p), {
    status: 200,
    headers: {
      ...cors,
      'Content-Type': 'image/jpeg',
      'Cache-Control': 'max-age=86400',
    },
  });
}

function handleGetOne(shortcode: string, cors: Record<string, string>): Response {
  const row = latestStmt.get(shortcode);
  if (!row) return json({ ok: false, error: 'not found' }, 404, cors);
  const snapshots = allSnapshotsStmt.all(shortcode);
  return json({ ok: true, data: { reel: presentReel(row), snapshots } }, 200, cors);
}

/** Serve an mp4 with HTTP Range support (video elements seek with Range). */
function serveVideoFile(req: Request, path: string, cors: Record<string, string>): Response {
  const file = Bun.file(path);
  const size = file.size;
  const baseHeaders: Record<string, string> = {
    ...cors,
    'Content-Type': 'video/mp4',
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'max-age=86400',
  };
  const range = req.headers.get('range');
  if (!range) {
    return new Response(file, { status: 200, headers: baseHeaders });
  }
  const m = range.match(/bytes=(\d*)-(\d*)/);
  if (!m) {
    return new Response(null, {
      status: 416,
      headers: { ...baseHeaders, 'Content-Range': `bytes */${size}` },
    });
  }
  let start = m[1] === '' ? NaN : Number(m[1]);
  let end = m[2] === '' ? NaN : Number(m[2]);
  if (Number.isNaN(start) && Number.isNaN(end)) {
    return new Response(null, {
      status: 416,
      headers: { ...baseHeaders, 'Content-Range': `bytes */${size}` },
    });
  }
  if (Number.isNaN(start)) {
    // Suffix range: last N bytes.
    start = Math.max(0, size - end);
    end = size - 1;
  } else if (Number.isNaN(end)) {
    end = size - 1;
  }
  if (start < 0 || end < start || start >= size) {
    return new Response(null, {
      status: 416,
      headers: { ...baseHeaders, 'Content-Range': `bytes */${size}` },
    });
  }
  end = Math.min(end, size - 1);
  return new Response(file.slice(start, end + 1), {
    status: 206,
    headers: {
      ...baseHeaders,
      'Content-Range': `bytes ${start}-${end}/${size}`,
      'Content-Length': String(end - start + 1),
    },
  });
}

/** GET /api/videos/:shortcode: the full reel video cached at save time (Range). */
function handleVideo(req: Request, shortcode: string, cors: Record<string, string>): Response {
  const found = savedVideo(shortcode);
  if (!found) return json({ ok: false, error: 'not found' }, 404, cors);
  return serveVideoFile(req, found, cors);
}

/** GET /api/summary: library counts (the popup's one-glance view). */
function handleSummary(cors: Record<string, string>): Response {
  const row = db
    .query<Row>(
      `SELECT
         (SELECT COUNT(*) FROM reels) AS reels,
         (SELECT COUNT(*) FROM reels WHERE platform = 'instagram') AS instagram,
         (SELECT COUNT(*) FROM reels WHERE platform = 'youtube') AS youtube,
         (SELECT COUNT(DISTINCT platform || ':' || username || ':' || format) FROM profile_scans) AS creators,
         (SELECT MAX(last_saved_at) FROM reels) AS last_saved_at`,
    )
    .get() as Row;
  const n = (v: unknown) => Number(v ?? 0);
  return json(
    {
      ok: true,
      data: {
        reels: n(row.reels),
        instagram: n(row.instagram),
        youtube: n(row.youtube),
        creators: n(row.creators),
        last_saved_at: typeof row.last_saved_at === 'string' ? row.last_saved_at : null,
      },
    },
    200,
    cors,
  );
}

function handleExists(url: URL, cors: Record<string, string>): Response {
  const codes = (url.searchParams.get('codes') ?? '')
    .split(',')
    .map((c) => c.trim())
    .filter((c) => c.length > 0 && SHORTCODE_RE.test(c));
  if (codes.length === 0) return json({ ok: true, saved: [] }, 200, cors);
  const placeholders = codes.map(() => '?').join(',');
  const rows = db.query<Row>(`SELECT shortcode FROM reels WHERE shortcode IN (${placeholders})`).all(...codes);
  return json({ ok: true, saved: rows.map((r) => String(r.shortcode)) }, 200, cors);
}

// ---------------------------------------------------------------------------
// Profile scans (channel baselines)
// ---------------------------------------------------------------------------

const insertScanStmt = db.query(`
  INSERT INTO profile_scans (
    username, user_id, full_name, followers, scanned_at,
    sample_size, threshold, baseline_views, stats_json, reels_json, platform, format
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const latestScanStmt = db.query<Row>(
  'SELECT * FROM profile_scans WHERE username = ? AND platform = ? AND format = ? ORDER BY id DESC LIMIT 1',
);

const scanHistoryStmt = db.query<Row>(
  'SELECT id, scanned_at, baseline_views FROM profile_scans WHERE username = ? AND platform = ? AND format = ? ORDER BY id DESC',
);

const latestScansStmt = db.query<Row>(`
  SELECT * FROM profile_scans
  WHERE id IN (SELECT MAX(id) FROM profile_scans GROUP BY platform, username, format)
  ORDER BY scanned_at DESC, id DESC
`);

const asPlatform = (v: unknown): Platform => (v === 'youtube' ? 'youtube' : 'instagram');
/** Long-form videos only exist on YouTube; everything else is short-form. */
const asFormat = (v: unknown, platform: Platform): ScanFormat => (v === 'long' && platform === 'youtube' ? 'long' : 'short');

function parseJsonObject(text: unknown): Record<string, unknown> {
  if (typeof text !== 'string') return {};
  try {
    const v: unknown = JSON.parse(text);
    return v && typeof v === 'object' && !Array.isArray(v)
      ? (v as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function parseJsonArray(text: unknown): unknown[] {
  if (typeof text !== 'string') return [];
  try {
    const v: unknown = JSON.parse(text);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

function handlePostProfileScan(body: unknown, cors: Record<string, string>): Response {
  if (!body || typeof body !== 'object') {
    return json({ ok: false, error: 'body must be a JSON object' }, 400, cors);
  }
  const b = body as Record<string, unknown>;
  const profile = b.profile;
  const analysis = b.analysis;
  if (!profile || typeof profile !== 'object') {
    return json({ ok: false, error: 'profile is required' }, 400, cors);
  }
  if (!analysis || typeof analysis !== 'object') {
    return json({ ok: false, error: 'analysis is required' }, 400, cors);
  }
  const p = profile as Record<string, unknown>;
  const a = analysis as Record<string, unknown>;
  if (typeof p.username !== 'string' || p.username.length === 0) {
    return json({ ok: false, error: 'profile.username is required' }, 400, cors);
  }
  if (!a.stats || typeof a.stats !== 'object') {
    return json({ ok: false, error: 'analysis.stats is required' }, 400, cors);
  }
  if (!Array.isArray(a.reels)) {
    return json({ ok: false, error: 'analysis.reels must be an array' }, 400, cors);
  }
  const stats = a.stats as Record<string, unknown>;
  const sampleSize = isFiniteNum(stats.sampleSize)
    ? (stats.sampleSize as number)
    : (a.reels as unknown[]).length;
  const threshold = isFiniteNum(stats.threshold) ? (stats.threshold as number) : 2;
  const baselineViews = isFiniteNum(stats.baselineViews) ? (stats.baselineViews as number) : null;
  const scannedAt = new Date().toISOString();
  const platform = asPlatform(p.platform);
  const result = insertScanStmt.run(
    p.username,
    typeof p.userId === 'string' ? p.userId : null,
    typeof p.fullName === 'string' ? p.fullName : null,
    isFiniteNum(p.followers) ? p.followers : null,
    scannedAt,
    Math.floor(sampleSize),
    threshold,
    baselineViews,
    JSON.stringify(stats),
    JSON.stringify(a.reels),
    platform,
    asFormat(b.format, platform),
  );
  return json({ ok: true, id: Number(result.lastInsertRowid) }, 200, cors);
}

function handleListProfiles(cors: Record<string, string>): Response {
  const rows = latestScansStmt.all();
  const data = rows.map((row) => {
    const stats = parseJsonObject(row.stats_json);
    return {
      username: String(row.username),
      platform: asPlatform(row.platform),
      format: asFormat(row.format, asPlatform(row.platform)),
      followers: isFiniteNum(row.followers) ? (row.followers as number) : null,
      scanned_at: String(row.scanned_at),
      baseline_views: isFiniteNum(row.baseline_views) ? (row.baseline_views as number) : null,
      outlier_count: isFiniteNum(stats.outlierCount) ? (stats.outlierCount as number) : 0,
      hit_rate: isFiniteNum(stats.hitRate) ? (stats.hitRate as number) : 0,
      sample_size: isFiniteNum(row.sample_size) ? (row.sample_size as number) : 0,
    };
  });
  return json({ ok: true, data }, 200, cors);
}

function handleGetProfile(username: string, platform: Platform, format: ScanFormat, cors: Record<string, string>): Response {
  const row = latestScanStmt.get(username, platform, format) as Row | null;
  if (!row) return json({ ok: false, error: 'not found' }, 404, cors);
  const history = scanHistoryStmt.all(username, platform, format);
  return json(
    {
      ok: true,
      data: {
        id: Number(row.id),
        username: String(row.username),
        platform,
        format,
        user_id: typeof row.user_id === 'string' ? row.user_id : null,
        full_name: typeof row.full_name === 'string' ? row.full_name : null,
        followers: isFiniteNum(row.followers) ? (row.followers as number) : null,
        scanned_at: String(row.scanned_at),
        sample_size: Number(row.sample_size ?? 0),
        threshold: Number(row.threshold ?? 2),
        baseline_views: isFiniteNum(row.baseline_views) ? (row.baseline_views as number) : null,
        stats: parseJsonObject(row.stats_json),
        reels: parseJsonArray(row.reels_json),
        scans: history.map((h) => ({
          id: Number(h.id),
          scanned_at: String(h.scanned_at),
          baseline_views: isFiniteNum(h.baseline_views) ? (h.baseline_views as number) : null,
        })),
      },
    },
    200,
    cors,
  );
}

// ---------------------------------------------------------------------------
// YouTube channel scans: yt-dlp lists their Shorts, or their long-form videos
// (the Videos tab), with rounded views and no dates; then a few get a full
// lookup for exact numbers and upload dates, and the dates in between are
// interpolated. Runs here, not in the page: YouTube
// lists a whole channel in seconds without scrolling anything. The client
// starts a job, polls it, and scores the result itself (lib/outliers.ts),
// exactly like an Instagram scan.
// ---------------------------------------------------------------------------

interface YtScanJob {
  state: YtScanState;
  ctl: AbortController;
}
const ytScans = new Map<string, YtScanJob>();
const YT_SCAN_MAX_MS = 15 * 60_000;
const YT_SCAN_KEEP_MS = 30 * 60_000;
const YT_ANCHOR_CONCURRENCY = 3;

/**
 * `since` (ms epoch, a time window): the client scores the videos uploaded
 * since then against the whole channel, so every one is still listed. The
 * list carries no dates, so a binary search (windowEnd) finds where the
 * window ends, and the lookups are spread over the window as well as over
 * the whole list: the window's dates are interpolated between exact ones.
 */
async function runYtScan(
  id: string,
  job: YtScanJob,
  key: string,
  format: ScanFormat,
  limit: number,
  since: number | null,
): Promise<void> {
  const { state, ctl } = job;
  let capped = false;
  const capTimer = setTimeout(() => ((capped = true), ctl.abort()), YT_SCAN_MAX_MS);
  const infos = new Map<number, unknown>();
  const lookup = async (i: number, vid: unknown): Promise<number | undefined> => {
    if (typeof vid !== 'string' || ctl.signal.aborted) return undefined;
    try {
      const info = await ytInfo(vid, 30_000);
      infos.set(i, info);
      return infoUploadMs(info);
    } catch {
      return undefined; // that one stays approximate
    }
  };
  try {
    state.stage = 'scrolling';
    const list = await ytListChannel(channelUrl(key), format, since === null ? limit : Infinity, {
      signal: ctl.signal,
      onEntry: (n) => (state.count = n),
    });
    const stopped = ctl.signal.aborted;
    const { entries } = list;
    // Exact numbers and dates for a handful (skipped after Stop: score what came in).
    if (!stopped && entries.length > 0) {
      state.stage = 'reading';
      const todo = new Set([...anchorPositions(entries.length), ...missingViewPositions(entries)]);
      if (since !== null) {
        const end = await windowEnd(entries.length, since, new Map(), (i) => lookup(i, entries[i]?.id));
        for (const i of anchorPositions(end)) todo.add(i);
      }
      const queue = [...todo].filter((i) => !infos.has(i)).sort((x, y) => x - y);
      const worker = async () => {
        for (let i = queue.shift(); i !== undefined && !ctl.signal.aborted; i = queue.shift()) await lookup(i, entries[i]?.id);
      };
      await Promise.all(Array.from({ length: YT_ANCHOR_CONCURRENCY }, worker));
    }
    const reels: ProfileReel[] = buildChannelScan(entries, infos, new Date(), format);
    state.result = {
      profile: profileFromPlaylist(list.channel, key),
      reels,
      ended: capped ? 'capped' : stopped ? 'stopped' : 'full',
    };
    state.count = reels.length;
    state.stage = 'done';
  } catch (e) {
    state.stage = 'failed';
    const missing = e instanceof YtError && e.kind === 'missing';
    state.error = missing ? `YouTube has no channel at ${channelUrl(key)}` : e instanceof Error ? e.message : String(e);
  } finally {
    clearTimeout(capTimer);
    setTimeout(() => ytScans.delete(id), YT_SCAN_KEEP_MS);
  }
}

function handleStartYtScan(body: unknown, cors: Record<string, string>): Response {
  const b = (body && typeof body === 'object' ? body : {}) as Row;
  const key = typeof b.channel === 'string' ? channelKey(b.channel) : null;
  if (!key) return json({ ok: false, error: 'channel must be a YouTube handle (@name) or channel id (UC…)' }, 400, cors);
  const limit = b.limit === null || b.limit === undefined ? Infinity : Number(b.limit);
  if (!(limit === Infinity || (Number.isInteger(limit) && limit > 0))) {
    return json({ ok: false, error: 'limit must be a positive integer or null (all)' }, 400, cors);
  }
  const since = b.since === null || b.since === undefined ? null : Number(b.since);
  if (since !== null && !(Number.isFinite(since) && since > 0)) {
    return json({ ok: false, error: 'since must be an upload time in ms since the epoch, or null' }, 400, cors);
  }
  if (b.format !== undefined && b.format !== null && b.format !== 'short' && b.format !== 'long') {
    return json({ ok: false, error: "format must be 'short' (their Shorts) or 'long' (their videos)" }, 400, cors);
  }
  const format: ScanFormat = b.format === 'long' ? 'long' : 'short';
  const id = crypto.randomUUID();
  const job: YtScanJob = { state: { stage: 'opening', count: 0 }, ctl: new AbortController() };
  ytScans.set(id, job);
  void runYtScan(id, job, key, format, limit, since);
  return json({ ok: true, id }, 200, cors);
}

function handleGetYtScan(id: string, cors: Record<string, string>): Response {
  const job = ytScans.get(id);
  if (!job) return json({ ok: false, error: 'not found' }, 404, cors);
  return json({ ok: true, data: job.state }, 200, cors);
}

/** Stop: listing ends, nothing more is looked up, and what came in is scored. */
function handleStopYtScan(id: string, cors: Record<string, string>): Response {
  const job = ytScans.get(id);
  if (!job) return json({ ok: false, error: 'not found' }, 404, cors);
  job.ctl.abort();
  return json({ ok: true }, 200, cors);
}

// ---- one video's numbers for the stats card (GET /api/youtube/info/:id) -------
// yt-dlp takes 2–4 s, and the card is opened and closed a lot: answers are
// kept for 10 minutes, and a second ask while one runs waits for the same one.

const INFO_TTL_MS = 10 * 60_000;
const INFO_MAX = 300;
const infoCache = new Map<string, { at: number; data: YtInfoSummary }>();
const infoInflight = new Map<string, Promise<YtInfoSummary>>();

async function lookupInfo(id: string): Promise<YtInfoSummary> {
  const hit = infoCache.get(id);
  if (hit && Date.now() - hit.at < INFO_TTL_MS) return hit.data;
  let p = infoInflight.get(id);
  if (!p) {
    p = (async () => {
      const s = infoSummary(await ytInfo(id, 30_000));
      if (!s) throw new YtError("couldn't read this video", 'gone');
      infoCache.delete(id);
      infoCache.set(id, { at: Date.now(), data: s });
      for (const k of infoCache.keys()) {
        if (infoCache.size <= INFO_MAX) break;
        infoCache.delete(k);
      }
      return s;
    })().finally(() => infoInflight.delete(id));
    infoInflight.set(id, p);
  }
  return p;
}

/** Same error semantics as a YouTube save: 422 the video is gone, 503 try again later. */
async function handleYtInfo(id: string, cors: Record<string, string>): Promise<Response> {
  if (!YT_ID_RE.test(id)) return json({ ok: false, error: 'id must be an 11-character YouTube video id' }, 400, cors);
  try {
    return json({ ok: true, data: await lookupInfo(id) }, 200, cors);
  } catch (e) {
    const gone = e instanceof YtError && e.kind !== 'retry';
    return json({ ok: false, error: `YouTube: ${e instanceof Error ? e.message : String(e)}` }, gone ? 422 : 503, cors);
  }
}

async function handlePatch(
  req: Request,
  shortcode: string,
  cors: Record<string, string>,
): Promise<Response> {
  if (existsStmt.get(shortcode) === null) {
    return json({ ok: false, error: 'not found' }, 404, cors);
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: 'body must be valid JSON' }, 400, cors);
  }
  if (!body || typeof body !== 'object') {
    return json({ ok: false, error: 'body must be a JSON object' }, 400, cors);
  }
  const b = body as Record<string, unknown>;
  const sets: string[] = [];
  const params: unknown[] = [];
  if ('notes' in b) {
    if (typeof b.notes !== 'string' && b.notes !== null) {
      return json({ ok: false, error: 'notes must be a string or null' }, 400, cors);
    }
    sets.push('notes = ?');
    params.push(b.notes);
  }
  if ('tags' in b) {
    if (
      !Array.isArray(b.tags) ||
      !b.tags.every((t): t is string => typeof t === 'string')
    ) {
      return json({ ok: false, error: 'tags must be an array of strings' }, 400, cors);
    }
    sets.push('tags = ?');
    params.push(JSON.stringify(b.tags));
  }
  if ('status' in b) {
    if (typeof b.status !== 'string' || !STATUSES.has(b.status)) {
      return json(
        { ok: false, error: `status must be one of: ${[...STATUSES].join(', ')}` },
        400,
        cors,
      );
    }
    sets.push('status = ?');
    params.push(b.status);
  }
  if (sets.length === 0) {
    return json({ ok: false, error: 'nothing to update (notes, tags, status)' }, 400, cors);
  }
  params.push(shortcode);
  db.query(`UPDATE reels SET ${sets.join(', ')} WHERE shortcode = ?`).run(...params);
  const row = latestStmt.get(shortcode);
  return json({ ok: true, data: row ? presentReel(row) : null }, 200, cors);
}

async function route(req: Request, cors: Record<string, string>): Promise<Response> {
  const url = new URL(req.url);
  const parts = url.pathname.split('/').filter(Boolean);

  if (parts[0] === 'api' && parts[1] === 'health' && parts.length === 2 && req.method === 'GET') {
    return json({ ok: true }, 200, cors);
  }
  if (parts[0] === 'api' && parts[1] === 'summary' && parts.length === 2 && req.method === 'GET') {
    return handleSummary(cors);
  }
  if (parts[0] === 'api' && parts[1] === 'thumbs') {
    if (parts.length === 3 && req.method === 'GET') {
      return handleThumb(decodeURIComponent(parts[2] ?? ''), cors);
    }
  }
  if (parts[0] === 'api' && parts[1] === 'reels') {
    if (parts.length === 2 && req.method === 'POST') {
      let body: unknown;
      try {
        body = await req.json();
      } catch {
        return json({ ok: false, error: 'body must be valid JSON' }, 400, cors);
      }
      if (body && typeof body === 'object' && (body as Row).platform === 'youtube') {
        const y = await youtubeSave(body as Row);
        if (!y.ok) return json({ ok: false, error: y.error }, y.status ?? 400, cors);
        return handlePostSave(y.value, cors);
      }
      const v = validateSave(body);
      if (!v.ok) return json({ ok: false, error: v.error }, 400, cors);
      return handlePostSave(v.value, cors);
    }
    if (parts.length === 2 && req.method === 'GET') {
      return handleList(url, cors);
    }
    if (parts.length === 3 && req.method === 'GET') {
      if (decodeURIComponent(parts[2] ?? '') === 'exists') {
        return handleExists(url, cors);
      }
      return handleGetOne(decodeURIComponent(parts[2] ?? ''), cors);
    }
    if (parts.length === 3 && req.method === 'PATCH') {
      return handlePatch(req, decodeURIComponent(parts[2] ?? ''), cors);
    }
  }
  if (parts[0] === 'api' && parts[1] === 'videos' && parts.length === 3 && req.method === 'GET') {
    return handleVideo(req, decodeURIComponent(parts[2] ?? ''), cors);
  }
  if (parts[0] === 'api' && parts[1] === 'profiles') {
    if (parts.length === 2 && req.method === 'GET') {
      return handleListProfiles(cors);
    }
    if (parts.length === 3 && req.method === 'POST' && parts[2] === 'scans') {
      let body: unknown;
      try {
        body = await req.json();
      } catch {
        return json({ ok: false, error: 'body must be valid JSON' }, 400, cors);
      }
      return handlePostProfileScan(body, cors);
    }
    if (parts.length === 3 && req.method === 'GET') {
      const platform = asPlatform(url.searchParams.get('platform'));
      return handleGetProfile(decodeURIComponent(parts[2] ?? ''), platform, asFormat(url.searchParams.get('format'), platform), cors);
    }
  }
  if (parts[0] === 'api' && parts[1] === 'youtube' && parts[2] === 'info' && parts.length === 4 && req.method === 'GET') {
    return handleYtInfo(decodeURIComponent(parts[3] ?? ''), cors);
  }
  if (parts[0] === 'api' && parts[1] === 'youtube' && parts[2] === 'scans') {
    if (parts.length === 3 && req.method === 'POST') {
      let body: unknown;
      try {
        body = await req.json();
      } catch {
        return json({ ok: false, error: 'body must be valid JSON' }, 400, cors);
      }
      return handleStartYtScan(body, cors);
    }
    const id = decodeURIComponent(parts[3] ?? '');
    if (parts.length === 4 && req.method === 'GET') return handleGetYtScan(id, cors);
    if (parts.length === 4 && req.method === 'DELETE') return handleStopYtScan(id, cors);
  }
  return json({ ok: false, error: 'not found' }, 404, cors);
}

// ---------------------------------------------------------------------------
// Serve
// ---------------------------------------------------------------------------

const server = Bun.serve({
  port: PORT,
  async fetch(req) {
    // Allow any origin: extension origins vary between
    // chrome-extension:// and moz-extension://.
    const cors = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Range',
    };
    if (req.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }
    try {
      return await route(req, cors);
    } catch (e) {
      console.error(e);
      return json({ ok: false, error: 'internal error' }, 500, cors);
    }
  },
});

console.log(`reelscope server listening on http://localhost:${server.port} (db: ${DB_PATH})`);
