// Per-post metrics: the numbers Instagram and YouTube hide, derived from the
// few they send. Pure (no DOM), unit tested in lib/metrics.test.ts. Used by
// the in-page stats card (entrypoints/content/StatsCard.tsx), the grid-tile
// badges and the library's reel sheet.
//
// Inputs come from three places, each with a mapper below: a media item
// Instagram's page loaded (detailsFromIgItem), the server's yt-dlp summary
// of a YouTube video (detailsFromYtInfo), and a saved library row
// (detailsFromRow). Scoring against a creator's scan reuses lib/outliers.ts.
import { getPath, itemUploadTime, num, str } from './instagram';
import { channelBaseline, scoreViews } from './outliers';
import type { Platform, ProfileReel, ProfileStats, ProfileTier, ReelLatestRow, ScoredReel, SnapshotRow, YtInfoSummary } from './types';
import { infoSummary } from './youtube';

const HOUR_MS = 3600_000;
/** Reels younger than this are still climbing (same rule as the baseline in lib/outliers.ts). */
const MATURE_HOURS = 72;

/** A post's raw numbers and facts. Every field is optional: each source knows a different subset. */
export interface PostInput {
  platform?: Platform;
  shortcode?: string;
  username?: string | null;
  fullName?: string | null;
  /** YouTube's title (Instagram has none). */
  title?: string | null;
  /** Instagram's caption; YouTube's title and description (Shorts keep their hashtags in the title). */
  caption?: string | null;
  views?: number | null;
  likes?: number | null;
  comments?: number | null;
  shares?: number | null;
  followers?: number | null;
  /** ISO upload time. */
  takenAt?: string | null;
  /** takenAt is only the upload day (YouTube without a timestamp). */
  dateOnly?: boolean;
  durationSec?: number | null;
}

/** Facts beyond the numbers, per site. Absent means unknown or not applicable. */
export interface PostExtras {
  /** Instagram: original audio (with its title and owner) or a licensed track. */
  audio?: { original: boolean; title?: string; artist?: string };
  /** Instagram: co-authors of a collab post (not the author). */
  collaborators?: string[];
  /** Instagram: marked as a paid partnership, and with whom. */
  paidPartnership?: boolean;
  sponsors?: string[];
  /** Instagram: the creator hid the like count from viewers. */
  likesHidden?: boolean;
  /** YouTube. */
  category?: string;
  tags?: string[];
  chapters?: number;
  /** "1080p60", "720p". */
  resolution?: string;
  liveStatus?: 'is_live' | 'was_live' | 'is_upcoming' | 'post_live';
  /** YouTube: a Short rather than a long-form video. */
  short?: boolean;
}

export interface PostDetails {
  post: PostInput;
  extras: PostExtras;
}

export interface CaptionStats {
  /** Characters (code points, so an emoji counts once). */
  length: number;
  hashtags: number;
  mentions: number;
}

export interface PostMetrics {
  views: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  followers: number | null;
  /** (likes + comments + shares) / views; shares count only when known (engagementHasShares). */
  engagementRate: number | null;
  engagementHasShares: boolean;
  likeRate: number | null;
  commentsPer1k: number | null;
  sharesPer1k: number | null;
  /** comments / likes. */
  commentLikeRatio: number | null;
  viewsPerFollower: number | null;
  /** Hours since posting. */
  ageHours: number | null;
  /** Average views per hour / per day since posting. */
  viewsPerHour: number | null;
  viewsPerDay: number | null;
  caption: CaptionStats | null;
}

/** A count we can do maths with: finite and not negative. */
function count(v: number | null | undefined): number | null {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null;
}

const HASHTAG_RE = /(^|[^\p{L}\p{N}_&])#[\p{L}\p{N}_]+/gu;
// Not an email: the @ starts the text or follows something that isn't a word character.
const MENTION_RE = /(^|[^\p{L}\p{N}_.@])@[A-Za-z0-9._]{1,30}/gu;

export function captionStats(text: string | null | undefined): CaptionStats | null {
  if (typeof text !== 'string' || text.trim() === '') return null;
  return {
    length: [...text.trim()].length,
    hashtags: text.match(HASHTAG_RE)?.length ?? 0,
    mentions: text.match(MENTION_RE)?.length ?? 0,
  };
}

/** Hours from an ISO time to `now`, or null when it doesn't parse. Never negative. */
export function hoursSince(iso: string | null | undefined, now: number): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : Math.max(0, (now - t) / HOUR_MS);
}

export function computeMetrics(p: PostInput, now = Date.now()): PostMetrics {
  const views = count(p.views);
  const likes = count(p.likes);
  const comments = count(p.comments);
  const shares = count(p.shares);
  const followers = count(p.followers);
  const perView = views !== null && views > 0 ? views : null;
  const ageHours = hoursSince(p.takenAt, now);
  const aged = ageHours !== null && ageHours > 0 && views !== null ? ageHours : null;
  return {
    views,
    likes,
    comments,
    shares,
    followers,
    engagementRate:
      perView !== null && likes !== null && comments !== null ? (likes + comments + (shares ?? 0)) / perView : null,
    engagementHasShares: shares !== null,
    likeRate: perView !== null && likes !== null ? likes / perView : null,
    commentsPer1k: perView !== null && comments !== null ? (comments / perView) * 1000 : null,
    sharesPer1k: perView !== null && shares !== null ? (shares / perView) * 1000 : null,
    commentLikeRatio: likes !== null && likes > 0 && comments !== null ? comments / likes : null,
    viewsPerFollower: views !== null && followers !== null && followers > 0 ? views / followers : null,
    ageHours,
    viewsPerHour: aged !== null ? views! / aged : null,
    viewsPerDay: aged !== null ? views! / (aged / 24) : null,
    caption: captionStats(p.caption),
  };
}

// ---- vs the creator's own scan --------------------------------------------------

/** A creator scan to compare against: a live in-page one or a stored one (ProfileScanDetail). */
export interface ScanRef {
  stats: ProfileStats;
  reels: readonly ScoredReel[];
  /** ISO scan time. */
  scannedAt: string;
  threshold: number;
}

export interface CreatorComparison {
  /** Current views over the scan's baseline. */
  multiple: number;
  tier: ProfileTier;
  /** The post is under 72 hours old: still climbing. */
  early: boolean;
  /** The post was one of the scanned reels. */
  inScan: boolean;
  /** 1 = most viewed, among the scanned reels with this post at its current views. */
  rank: number;
  of: number;
  /** rank / of: 0.04 = top 4%. */
  topShare: number;
  baselineViews: number;
  /** Likes + comments per view (the scan's formula, no shares) and the creator's median of it. */
  engagement: number | null;
  medianEngagement: number | null;
  /** engagement / medianEngagement. */
  engagementVsMedian: number | null;
  scannedAt: string;
  sampleSize: number;
  /** Fewer than 6 scanned reels older than 72 hours: a rough baseline. */
  lowConfidence: boolean;
}

/**
 * Where this post stands among the creator's scanned reels, at its current
 * views. Null without views or without a baseline.
 */
export function compareToScan(shortcode: string | undefined, m: PostMetrics, scan: ScanRef): CreatorComparison | null {
  const views = m.views;
  const baselineViews = scan.stats.baselineViews;
  if (views === null || views <= 0 || !(baselineViews > 0)) return null;
  const scannedMs = Date.parse(scan.scannedAt);
  // A time window was scored against the whole channel (stats.channel); else the scan is its own yardstick.
  const base = scan.stats.channel ?? channelBaseline([...scan.reels], Number.isNaN(scannedMs) ? Date.now() : scannedMs);
  const { multiple, tier } = scoreViews(views, { ...base, views: baselineViews }, scan.threshold);
  const others = scan.reels.filter((r) => r.shortcode !== shortcode);
  const rank = 1 + others.filter((r) => r.views > views).length;
  const of = others.length + 1;
  const engagement =
    m.likes !== null && m.comments !== null ? (m.likes + m.comments) / views : null;
  const medianEngagement = count(scan.stats.medianEngagementRate);
  return {
    multiple,
    tier,
    early: m.ageHours !== null && m.ageHours < MATURE_HOURS,
    inScan: others.length < scan.reels.length,
    rank,
    of,
    topShare: rank / of,
    baselineViews,
    engagement,
    medianEngagement,
    engagementVsMedian: engagement !== null && medianEngagement !== null && medianEngagement > 0 ? engagement / medianEngagement : null,
    scannedAt: scan.scannedAt,
    sampleSize: scan.stats.sampleSize,
    lowConfidence: scan.stats.lowConfidence,
  };
}

// ---- growth between saves ------------------------------------------------------------

export interface Growth {
  from: string;
  to: string;
  days: number;
  views: { delta: number; perDay: number | null } | null;
  likes: { delta: number; perDay: number | null } | null;
  comments: { delta: number; perDay: number | null } | null;
}

/**
 * Change between the first and latest snapshot of a saved reel (one
 * snapshot per save). Null with fewer than two snapshots. Per-day rates need
 * at least an hour between them.
 */
export function snapshotGrowth(snaps: readonly SnapshotRow[]): Growth | null {
  const dated = snaps
    .map((s) => ({ s, t: Date.parse(s.captured_at) }))
    .filter((x) => !Number.isNaN(x.t))
    .sort((a, b) => a.t - b.t || a.s.id - b.s.id);
  if (dated.length < 2) return null;
  const first = dated[0]!;
  const last = dated[dated.length - 1]!;
  const days = (last.t - first.t) / (24 * HOUR_MS);
  const change = (pick: (s: SnapshotRow) => number | null) => {
    const a = count(pick(first.s));
    const b = count(pick(last.s));
    if (a === null || b === null) return null;
    return { delta: b - a, perDay: days >= 1 / 24 ? (b - a) / days : null };
  };
  return {
    from: first.s.captured_at,
    to: last.s.captured_at,
    days,
    views: change((s) => s.play_count ?? s.view_count),
    likes: change((s) => s.like_count),
    comments: change((s) => s.comment_count),
  };
}

// ---- sources -------------------------------------------------------------------------

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => v !== null && typeof v === 'object' && !Array.isArray(v);
const usernames = (list: unknown, path: readonly string[] = ['username']): string[] =>
  Array.isArray(list) ? list.map((x) => str(getPath(x, path))).filter((x): x is string => !!x) : [];

/** Audio of an Instagram reel: a licensed track, or original audio (its title and owner). */
function igAudio(item: Obj): PostExtras['audio'] {
  const music = getPath(item, ['clips_metadata', 'music_info', 'music_asset_info']);
  if (isObj(music) && (str(music.title) || str(music.display_artist))) {
    return { original: false, title: str(music.title), artist: str(music.display_artist) };
  }
  const sound = getPath(item, ['clips_metadata', 'original_sound_info']) ?? item.original_sound_info;
  if (isObj(sound)) {
    return {
      original: true,
      title: str(sound.original_audio_title),
      artist: str(getPath(sound, ['ig_artist', 'username'])),
    };
  }
  const kind = str(getPath(item, ['clips_metadata', 'audio_type']));
  if (kind === 'original_sounds') return { original: true };
  if (kind === 'licensed_music') return { original: false };
  return undefined;
}

/**
 * Details of one Instagram media item (v1 shape, see lib/igCapture.ts):
 * captured from the page or read from /media/info. `followers` is the
 * author's count when known elsewhere (the capture store, the header).
 */
export function detailsFromIgItem(item: Obj, opts: { followers?: number; username?: string } = {}): PostDetails {
  const user = isObj(item.user) ? item.user : isObj(item.owner) ? item.owner : {};
  const username = str(user.username) ?? opts.username;
  const uploadMs = itemUploadTime(item);
  const collaborators = usernames(item.coauthor_producers).filter((u) => u.toLowerCase() !== username?.toLowerCase());
  const sponsors = usernames(item.sponsor_tags, ['sponsor', 'username']);
  const extras: PostExtras = {};
  const audio = igAudio(item);
  if (audio) extras.audio = audio;
  if (collaborators.length > 0) extras.collaborators = collaborators;
  if (item.is_paid_partnership === true || sponsors.length > 0) extras.paidPartnership = true;
  if (sponsors.length > 0) extras.sponsors = sponsors;
  if (item.like_and_view_counts_disabled === true) extras.likesHidden = true;
  return {
    post: {
      platform: 'instagram',
      shortcode: str(item.code),
      username: username ?? null,
      fullName: str(user.full_name) ?? null,
      caption: str(getPath(item, ['caption', 'text'])) ?? null,
      views: num(item.play_count) ?? num(item.ig_play_count) ?? num(item.view_count) ?? null,
      likes: num(item.like_count) ?? null,
      comments: num(item.comment_count) ?? null,
      shares: num(item.reshare_count) ?? num(item.share_count) ?? null,
      followers: opts.followers ?? num(user.follower_count) ?? null,
      takenAt: uploadMs !== undefined ? new Date(uploadMs).toISOString() : null,
      durationSec: num(item.video_duration) ?? null,
    },
    extras,
  };
}

const LIVE = new Set(['is_live', 'was_live', 'is_upcoming', 'post_live']);

/** "1080p60" from a video's size and frame rate (the short side is the p). */
export function resolutionLabel(width: number | null, height: number | null, fps: number | null): string | undefined {
  const side = width && height ? Math.min(width, height) : (height ?? width);
  if (!side) return undefined;
  return `${Math.round(side)}p${fps && fps > 30.5 ? Math.round(fps) : ''}`;
}

/** Details of a YouTube video from the server's summary (GET /api/youtube/info/:id). */
/** A YouTube video's text, as caption stats count it: title, then description (like a save's caption). */
const ytText = (s: Pick<YtInfoSummary, 'title' | 'description'>) => [s.title, s.description].filter(Boolean).join('\n\n') || null;

export function detailsFromYtInfo(s: YtInfoSummary): PostDetails {
  const extras: PostExtras = { short: s.short };
  if (s.categories[0]) extras.category = s.categories[0];
  if (s.tags.length > 0) extras.tags = s.tags;
  if (s.chapters > 0) extras.chapters = s.chapters;
  const res = resolutionLabel(s.width, s.height, s.fps);
  if (res) extras.resolution = res;
  if (s.liveStatus && LIVE.has(s.liveStatus)) extras.liveStatus = s.liveStatus as PostExtras['liveStatus'];
  return {
    post: {
      platform: 'youtube',
      shortcode: s.id,
      username: s.handle,
      fullName: s.channel,
      title: s.title,
      caption: ytText(s),
      views: s.views,
      likes: s.likes,
      comments: s.comments,
      followers: s.followers,
      takenAt: s.takenAt,
      dateOnly: s.dateOnly,
      durationSec: s.durationSec,
    },
    extras,
  };
}

function parseRaw(text: string | null): unknown {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * Details of a saved library row: numbers from its latest snapshot, extras
 * from the raw JSON kept with the save (Instagram's media item, or the
 * trimmed yt-dlp info).
 */
export function detailsFromRow(row: ReelLatestRow): PostDetails {
  const raw = parseRaw(row.raw_json);
  const yt = row.platform === 'youtube';
  let extras: PostExtras = {};
  let title: string | null = null;
  let caption = row.caption;
  if (yt) {
    const s = infoSummary(raw);
    if (s) {
      extras = detailsFromYtInfo(s).extras;
      title = s.title;
      caption = ytText(s);
    }
  } else if (isObj(raw)) {
    extras = detailsFromIgItem(raw).extras;
  }
  return {
    post: {
      platform: yt ? 'youtube' : 'instagram',
      shortcode: row.shortcode,
      username: row.author_username,
      fullName: row.author_full_name,
      title,
      caption,
      views: row.latest_views,
      likes: row.latest_like_count,
      comments: row.latest_comment_count,
      shares: row.latest_share_count,
      followers: row.latest_author_followers ?? row.author_followers,
      takenAt: row.taken_at,
      durationSec: row.duration_sec,
    },
    extras,
  };
}

/** A scanned reel as metrics input. Tiles read off the grid only know their (rounded) views. */
export function postFromScanned(r: ProfileReel): PostInput {
  return {
    shortcode: r.shortcode,
    views: r.views,
    likes: r.fromGrid ? null : r.likes,
    comments: r.fromGrid ? null : r.comments,
    shares: r.shares ?? null,
    takenAt: r.takenAt || null,
    durationSec: r.durationSec ?? null,
    caption: r.caption ?? null,
  };
}
