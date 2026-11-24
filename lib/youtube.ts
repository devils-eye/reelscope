// YouTube, pure part: video ids, channel keys and URLs, and yt-dlp's JSON
// mapped onto the library's shapes (a save, a scanned Short, a channel). The
// I/O (spawning yt-dlp) lives in lib/ytdlp.ts. Unit tested in
// lib/youtube.test.ts.
//
// A YouTube video is a row in `reels` like any reel: shortcode = the 11-char
// video id, platform = 'youtube', author_username = the channel handle
// without '@', lowercased (or the UC… channel id when there is no handle).
import { estimateDates } from './captureStore';
import type { ProfileInfo, ProfileReel, ScanFormat, YtInfoSummary } from './types';

export const YT_ID_RE = /^[A-Za-z0-9_-]{11}$/;
const CHANNEL_ID_RE = /^UC[A-Za-z0-9_-]{22}$/;
const HANDLE_RE = /^[A-Za-z0-9._-]{3,30}$/;

export const shortsUrl = (id: string) => `https://www.youtube.com/shorts/${id}`;
export const watchUrl = (id: string) => `https://www.youtube.com/watch?v=${id}`;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => v !== null && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown): string | undefined => (typeof v === 'string' && v.length > 0 ? v : undefined);
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

/** The video id in a YouTube URL (watch, shorts, youtu.be, embed, live), or the id itself. */
export function youtubeId(s: string): string | null {
  const t = s.trim();
  if (YT_ID_RE.test(t)) return t;
  let u: URL;
  try {
    u = new URL(t);
  } catch {
    return null;
  }
  const host = u.hostname.replace(/^(www|m|music)\./, '');
  let id: string | null = null;
  if (host === 'youtu.be') id = u.pathname.split('/')[1] ?? null;
  else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    const [first, second] = u.pathname.split('/').filter(Boolean);
    if (first === 'watch') id = u.searchParams.get('v');
    else if (first && ['shorts', 'embed', 'live', 'v'].includes(first)) id = second ?? null;
  }
  return id && YT_ID_RE.test(id) ? id : null;
}

/**
 * The key a channel is stored under: its handle without '@', lowercased
 * ('@Kallaway', '/@kallaway/shorts' → 'kallaway'), or its UC… id when that is
 * all there is. Null for anything else.
 */
export function channelKey(s: string): string | null {
  let t = s.trim();
  try {
    if (/^https?:/.test(t)) t = new URL(t).pathname;
  } catch {
    return null;
  }
  const parts = t.split('/').filter(Boolean);
  if (parts[0] === 'channel' && parts[1] && CHANNEL_ID_RE.test(parts[1])) return parts[1];
  const first = parts[0] ?? '';
  if (CHANNEL_ID_RE.test(first)) return first;
  // A bare word ('kallaway') is a handle; a path's first segment only with '@' (/watch is not a channel).
  const handle = first.startsWith('@') ? first.slice(1) : !t.includes('/') ? first : '';
  try {
    const h = decodeURIComponent(handle);
    return HANDLE_RE.test(h) ? h.toLowerCase() : null;
  } catch {
    return null;
  }
}

export function channelUrl(key: string): string {
  return CHANNEL_ID_RE.test(key) ? `https://www.youtube.com/channel/${key}` : `https://www.youtube.com/@${key}`;
}

/** yt-dlp's uploader_id ('@kallaway'), else the channel id. */
function authorKey(info: Obj): string | undefined {
  const fromHandle = str(info.uploader_id) ?? str(info.uploader_url) ?? str(info.channel_url);
  const k = fromHandle ? channelKey(fromHandle) : null;
  return k ?? (str(info.channel_id) && CHANNEL_ID_RE.test(info.channel_id as string) ? (info.channel_id as string) : undefined);
}

/** A Short (vertical, short) rather than a long-form video. */
export function isShort(info: Obj): boolean {
  if (info.media_type === 'short') return true;
  if (str(info.webpage_url)?.includes('/shorts/')) return true;
  const w = num(info.width);
  const h = num(info.height);
  const d = num(info.duration);
  return info.media_type === undefined && w !== undefined && h !== undefined && h > w && d !== undefined && d <= 180;
}

const KEEP = [
  'id', 'title', 'description', 'channel', 'channel_id', 'uploader_id', 'uploader_url', 'channel_follower_count',
  'duration', 'view_count', 'like_count', 'comment_count', 'timestamp', 'upload_date', 'media_type', 'categories',
  'tags', 'chapters', 'thumbnail', 'webpage_url', 'width', 'height', 'fps', 'language', 'track', 'artist',
  'live_status', 'availability',
] as const;

/** What of yt-dlp's (≈600 KB) info JSON is worth keeping with a save: no formats, captions or heatmap. */
export function trimInfo(info: Obj): Obj {
  const out: Obj = { platform: 'youtube' };
  for (const k of KEEP) if (info[k] !== undefined && info[k] !== null) out[k] = info[k];
  return out;
}

/** The fields of a save, from one video's full yt-dlp info. Null when it isn't a usable video. */
export interface YtSave {
  shortcode: string;
  url: string;
  username: string;
  fullName: string | null;
  followers: number | null;
  /** Title, then the description. */
  caption: string | null;
  audioTitle: string | null;
  durationSec: number | null;
  takenAt: string | null;
  viewCount: number | null;
  likeCount: number | null;
  commentCount: number | null;
  short: boolean;
  raw: Obj;
}

export function saveFromInfo(info: unknown): YtSave | null {
  if (!isObj(info)) return null;
  const id = str(info.id);
  const username = authorKey(info);
  if (!id || !YT_ID_RE.test(id) || !username) return null;
  const short = isShort(info);
  const title = str(info.title)?.trim();
  const desc = str(info.description)?.trim();
  const caption = [title, desc].filter(Boolean).join('\n\n') || null;
  const ts = num(info.timestamp);
  const track = str(info.track);
  const artist = str(info.artist);
  return {
    shortcode: id,
    url: short ? shortsUrl(id) : watchUrl(id),
    username,
    fullName: str(info.channel) ?? str(info.uploader) ?? null,
    followers: num(info.channel_follower_count) ?? null,
    caption,
    audioTitle: track ? (artist ? `${artist} · ${track}` : track) : null,
    durationSec: num(info.duration) ?? null,
    takenAt: ts !== undefined ? new Date(ts * 1000).toISOString() : null,
    viewCount: num(info.view_count) ?? null,
    likeCount: num(info.like_count) ?? null,
    commentCount: num(info.comment_count) ?? null,
    short,
    raw: trimInfo(info),
  };
}

const strList = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.trim().length > 0).map((x) => x.trim()) : [];

/**
 * What the stats card shows of one video, from yt-dlp's full info (or the
 * trimmed copy kept with a save, trimInfo): numbers, upload time, format
 * facts. Null when it isn't a usable video.
 */
export function infoSummary(info: unknown): YtInfoSummary | null {
  if (!isObj(info)) return null;
  const id = str(info.id);
  if (!id || !YT_ID_RE.test(id)) return null;
  const ts = num(info.timestamp);
  const day = str(info.upload_date)?.match(/^(\d{4})(\d{2})(\d{2})$/);
  const takenAt = ts !== undefined ? new Date(ts * 1000).toISOString() : day ? `${day[1]}-${day[2]}-${day[3]}T00:00:00.000Z` : null;
  const count = (v: unknown) => {
    const n = num(v);
    return n !== undefined && n >= 0 ? n : null;
  };
  return {
    id,
    title: str(info.title)?.trim() ?? null,
    description: str(info.description)?.trim() ?? null,
    channel: str(info.channel) ?? str(info.uploader) ?? null,
    handle: authorKey(info) ?? null,
    channelId: str(info.channel_id) ?? null,
    followers: count(info.channel_follower_count),
    views: count(info.view_count),
    likes: count(info.like_count),
    comments: count(info.comment_count),
    takenAt,
    dateOnly: ts === undefined && takenAt !== null,
    durationSec: count(info.duration),
    categories: strList(info.categories),
    tags: strList(info.tags),
    chapters: Array.isArray(info.chapters) ? info.chapters.length : 0,
    width: count(info.width),
    height: count(info.height),
    fps: count(info.fps),
    liveStatus: str(info.live_status) ?? null,
    short: isShort(info),
  };
}

/** Thumbnail URLs to try, best first: Shorts have a portrait one (oar2, 1080x1920). */
export function thumbCandidates(id: string, short: boolean): string[] {
  const base = `https://i.ytimg.com/vi/${id}`;
  const wide = [`${base}/maxresdefault.jpg`, `${base}/hq720.jpg`, `${base}/hqdefault.jpg`];
  return short ? [`${base}/oar2.jpg`, ...wide] : wide;
}

/**
 * The biggest thumbnail of a listed video: portrait for a Short (flat-playlist
 * entries carry signed oar URLs), landscape for a long video.
 */
function entryThumb(e: Obj, format: ScanFormat): string | undefined {
  const ts = Array.isArray(e.thumbnails) ? e.thumbnails.filter(isObj) : [];
  const fits = ts.filter((t) => ((num(t.height) ?? 0) > (num(t.width) ?? 0)) === (format === 'short'));
  const pick = (fits.length > 0 ? fits : ts).reduce<Obj | undefined>(
    (best, t) => (!best || (num(t.width) ?? 0) > (num(best.width) ?? 0) ? t : best),
    undefined,
  );
  return pick ? str(pick.url) : undefined;
}

/** Not (yet) a video with views that settle: a scheduled premiere or a stream that is live right now. */
const notSettled = (o: Obj) => o.live_status === 'is_upcoming' || o.live_status === 'is_live';

/**
 * One video from a channel's Shorts list, or with format 'long' its Videos
 * list (yt-dlp --flat-playlist entry). YouTube lists both with rounded views
 * ("926K") and no date, so it starts as `fromGrid` with no takenAt; a full
 * lookup (withInfo) makes it exact. Null for a premiere that hasn't aired.
 */
export function reelFromEntry(e: unknown, format: ScanFormat = 'short'): ProfileReel | null {
  if (!isObj(e) || notSettled(e)) return null;
  const id = str(e.id);
  if (!id || !YT_ID_RE.test(id)) return null;
  const long = format === 'long';
  return {
    shortcode: id,
    url: long ? watchUrl(id) : shortsUrl(id),
    takenAt: '',
    views: num(e.view_count) ?? 0,
    likes: 0,
    comments: 0,
    durationSec: num(e.duration),
    caption: str(e.title),
    thumbnailUrl: entryThumb(e, format) ?? `https://i.ytimg.com/vi/${id}/${long ? 'hqdefault' : 'oar2'}.jpg`,
    pinned: false,
    fromGrid: true,
  };
}

/** A listed Short made exact by its full info: views, likes, comments, length, upload time. */
export function withInfo(r: ProfileReel, info: unknown): ProfileReel {
  const s = saveFromInfo(info);
  if (!s || s.shortcode !== r.shortcode) return r;
  return {
    ...r,
    takenAt: s.takenAt ?? r.takenAt,
    views: s.viewCount ?? r.views,
    likes: s.likeCount ?? 0,
    comments: s.commentCount ?? 0,
    durationSec: s.durationSec ?? r.durationSec,
    fromGrid: s.viewCount === null ? r.fromGrid : false,
  };
}

/**
 * List positions worth a full lookup (≈2 s each) for exact upload dates: the
 * newest few, which decide what is still under 72 hours old, then a spread
 * over the rest so the dates in between can be interpolated.
 */
export function anchorPositions(n: number, max = 12, newest = 4): number[] {
  if (n <= 0) return [];
  const out = new Set<number>();
  for (let i = 0; i < Math.min(newest, n); i++) out.add(i);
  const spread = Math.max(0, max - out.size);
  for (let k = 1; k <= spread && n > newest; k++) out.add(Math.min(n - 1, Math.round(newest - 1 + ((n - newest) * k) / spread)));
  return [...out].sort((a, b) => a - b);
}

/**
 * Where a time window ends in a newest-first list: the first position
 * uploaded before `since`, or `n` when none is. A binary search between the
 * positions already looked up (`known`: position → upload ms), so finding it
 * costs a handful of lookups (≈2 s each) however long the list. A failed
 * lookup tries the next position down; after MAX_MISSES the search gives up
 * and keeps everything not yet known to be older.
 */
export async function windowEnd(
  n: number,
  since: number,
  known: ReadonlyMap<number, number>,
  dateAt: (i: number) => Promise<number | undefined>,
): Promise<number> {
  const MAX_MISSES = 4;
  let lo = -1; // newest-first: positions up to lo are inside the window
  let hi = n; // positions from hi on are older
  for (const [i, t] of known) {
    if (i < 0 || i >= n) continue;
    if (t >= since) lo = Math.max(lo, i);
    else hi = Math.min(hi, i);
  }
  lo = Math.min(lo, hi - 1);
  let misses = 0;
  while (hi - lo > 1) {
    let i = (lo + hi) >> 1;
    let t = await dateAt(i);
    while (t === undefined && ++misses <= MAX_MISSES && i + 1 < hi) t = await dateAt(++i);
    if (t === undefined) return hi;
    if (t >= since) lo = i;
    else hi = i;
  }
  return hi;
}

/** Upload time (ms epoch) in one video's full yt-dlp info. */
export function infoUploadMs(info: unknown): number | undefined {
  const t = saveFromInfo(info)?.takenAt;
  return t ? Date.parse(t) : undefined;
}

/**
 * List positions that came without a view count (YouTube's list sometimes
 * leaves it out), so they get a full lookup too rather than scoring 0 views.
 * Up to `max`, newest first.
 */
export function missingViewPositions(entries: unknown[], max = 12): number[] {
  const out: number[] = [];
  for (let i = 0; i < entries.length && out.length < max; i++) {
    const e = entries[i];
    if (isObj(e) && !notSettled(e) && num(e.view_count) === undefined) out.push(i);
  }
  return out;
}

/**
 * The scanned Shorts (or long videos, format 'long'), newest first: exact
 * where a full lookup came back (`infos`, by list position), the rest as
 * listed, with upload dates interpolated between the exact ones
 * (lib/captureStore.ts estimateDates). Premieres that haven't aired and
 * streams that are still live are left out: their views mean nothing yet;
 * so is a video listed without views that no lookup reached.
 */
export function buildChannelScan(
  entries: unknown[],
  infos: ReadonlyMap<number, unknown>,
  now: Date,
  format: ScanFormat = 'short',
): ProfileReel[] {
  const reels: Array<ProfileReel & { _dated: boolean; _onGrid: boolean }> = [];
  entries.forEach((e, i) => {
    const r = reelFromEntry(e, format);
    if (!r) return;
    const info = infos.get(i);
    if (isObj(info) && notSettled(info)) return;
    // Listed without a view count and never looked up: unknown, not 0 (that would score as a flop).
    if (info === undefined && isObj(e) && num(e.view_count) === undefined) return;
    const exact = info === undefined ? r : withInfo(r, info);
    reels.push({ ...exact, _dated: exact.takenAt !== '', _onGrid: true });
  });
  estimateDates(reels, now);
  return reels.map(({ _dated, _onGrid, ...r }) => r);
}

/** The channel behind a Shorts or Videos list (yt-dlp's playlist fields). */
export function profileFromPlaylist(p: unknown, key: string): ProfileInfo {
  const o = isObj(p) ? p : {};
  const thumbs = Array.isArray(o.thumbnails) ? o.thumbnails.filter(isObj) : [];
  const avatar = thumbs.find((t) => t.id === 'avatar_uncropped') ?? thumbs.find((t) => num(t.width) !== undefined && t.width === t.height);
  return {
    userId: str(o.channel_id) ?? '',
    username: authorKey(o) ?? key,
    fullName: str(o.channel) ?? str(o.uploader),
    followers: num(o.channel_follower_count),
    profilePicUrl: avatar ? str(avatar.url) : undefined,
    platform: 'youtube',
  };
}

/** What a yt-dlp failure means: gone for good (private, removed…), no such channel/tab, or worth retrying. */
export function ytErrorKind(stderr: string): 'gone' | 'missing' | 'retry' {
  if (/does not have an? (shorts|videos) tab/i.test(stderr)) return 'missing';
  if (/HTTP Error 404|does not exist|This channel is not available/i.test(stderr)) return 'missing';
  if (/not a bot|try again later|rate.?limit|HTTP Error 429|timed out|Temporary failure|Connection|Unable to download (webpage|API page)/i.test(stderr)) {
    return 'retry';
  }
  if (/unavailable|private video|has been removed|members[- ]only|confirm your age|terminated|copyright/i.test(stderr)) return 'gone';
  return 'retry';
}

/** The last ERROR line of yt-dlp's stderr, without the extractor prefix. */
export function ytErrorText(stderr: string): string {
  const lines = stderr.split('\n').map((l) => l.trim()).filter(Boolean);
  const err = [...lines].reverse().find((l) => l.startsWith('ERROR:')) ?? lines[lines.length - 1] ?? '';
  return err.replace(/^ERROR:\s*(\[[^\]]+\]\s*)?([A-Za-z0-9_@./-]+:\s*)?/, '').slice(0, 300) || 'yt-dlp failed';
}
