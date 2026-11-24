// Shared types for the ReelScope extension + local server.
//
// Server responses use snake_case DB column names verbatim (see the
// `reel_latest` view in server/schema.sql).
export interface ReelStats {
  playCount?: number;
  viewCount?: number;
  likeCount?: number;
  commentCount?: number;
  shareCount?: number;
}

export interface ReelAuthor {
  username: string;
  fullName?: string;
  followers?: number;
}

export type SaveSource = 'api' | 'dom';

/** Where a reel lives. Absent means Instagram. */
export type Platform = 'instagram' | 'youtube';

/**
 * What a channel scan is made of. 'short': reels, or a YouTube channel's
 * Shorts; 'long': a YouTube channel's long-form videos (its Videos tab).
 * Scored apart: a Short and a long video draw such different views that one
 * baseline for both would mean nothing. Absent means 'short'.
 */
export type ScanFormat = 'short' | 'long';

export interface SavePayload {
  /** Absent means Instagram. A YouTube save only needs shortcode (the video id) and url: the server reads the rest. */
  platform?: Platform;
  shortcode: string;
  url: string;
  mediaId?: string;
  author: ReelAuthor;
  caption?: string;
  audioTitle?: string;
  durationSec?: number;
  /** ISO upload time */
  takenAt?: string;
  stats: ReelStats;
  /** ISO capture time */
  capturedAt: string;
  /** Latest raw API payload (kept for later analysis) */
  raw?: unknown;
  source: SaveSource;
  /** Channel-baseline context (profile scan) attached at save time. */
  channel?: ChannelContext;
}

/** Channel-baseline context attached to a save (or backfilled server-side). */
export interface ChannelContext {
  baselineViews: number;
  multiple: number;
  tier: string;
  sampleSize: number;
  /** ISO scan time of the profile scan this was computed from. */
  scannedAt: string;
}

export type ReelStatus = 'new' | 'analyzed' | 'in_report' | 'rejected';

export const REEL_STATUSES: readonly ReelStatus[] = [
  'new',
  'analyzed',
  'in_report',
  'rejected',
];

/** One row of the `reel_latest` SQL view. Column names match the DB. */
export interface ReelLatestRow {
  shortcode: string;
  platform: Platform;
  url: string;
  media_id: string | null;
  author_username: string;
  author_full_name: string | null;
  author_followers: number | null;
  caption: string | null;
  audio_title: string | null;
  duration_sec: number | null;
  taken_at: string | null;
  first_saved_at: string;
  last_saved_at: string;
  status: ReelStatus;
  /** Parsed from the JSON-array TEXT column. */
  tags: string[];
  notes: string | null;
  raw_json: string | null;
  snapshot_id: number;
  snapshot_captured_at: string;
  latest_play_count: number | null;
  latest_view_count: number | null;
  latest_like_count: number | null;
  latest_comment_count: number | null;
  latest_share_count: number | null;
  latest_author_followers: number | null;
  latest_views: number | null;
  age_hours: number | null;
  views_per_follower: number | null;
  views_per_hour: number | null;
  /** Channel baseline attached at save (or backfilled from the latest profile scan). */
  channel_baseline_views: number | null;
  channel_multiple: number | null;
  channel_tier: string | null;
}

export interface SnapshotRow {
  id: number;
  shortcode: string;
  captured_at: string;
  play_count: number | null;
  view_count: number | null;
  like_count: number | null;
  comment_count: number | null;
  share_count: number | null;
  author_followers: number | null;
}

// ---------------------------------------------------------------------------
// Extension messages (content/popup -> background)
// ---------------------------------------------------------------------------

export type ExtensionMessage =
  | { type: 'save'; payload: SavePayload }
  | { type: 'list' }
  | { type: 'status' }
  | { type: 'profileScan'; profile: ProfileInfo; analysis: ProfileAnalysis; format?: ScanFormat }
  | { type: 'profileGet'; username: string; platform?: Platform; format?: ScanFormat }
  | { type: 'savedShortcodes'; shortcodes: string[] }
  | { type: 'ytScanStart'; channel: string; limit: number | null; since: number | null; format?: ScanFormat }
  | { type: 'ytScanGet'; id: string }
  | { type: 'ytScanStop'; id: string }
  | { type: 'ytInfo'; id: string };

/**
 * GET /api/youtube/info/:id: one video's numbers and facts, trimmed from
 * yt-dlp's info JSON (lib/youtube.ts infoSummary) for the stats card.
 */
export interface YtInfoSummary {
  id: string;
  title: string | null;
  description: string | null;
  /** Channel name, and the key its scans are stored under (lib/youtube.ts channelKey). */
  channel: string | null;
  handle: string | null;
  channelId: string | null;
  followers: number | null;
  views: number | null;
  likes: number | null;
  comments: number | null;
  /** ISO upload time; midnight UTC of upload_date when YouTube gave no exact time (`dateOnly`). */
  takenAt: string | null;
  dateOnly: boolean;
  durationSec: number | null;
  categories: string[];
  tags: string[];
  chapters: number;
  width: number | null;
  height: number | null;
  fps: number | null;
  /** yt-dlp's live_status: not_live, is_live, was_live, is_upcoming, post_live. */
  liveStatus: string | null;
  /** A Short rather than a long-form video. */
  short: boolean;
}

/** Background reply to { type: 'ytInfo' }. offline: the library server didn't answer. */
export type YtInfoResult =
  | { ok: true; data: YtInfoSummary }
  | { ok: false; error: string; reason: 'offline' | 'gone' | 'retry' };

export type SaveResult =
  | { ok: true; isNew: boolean; data: ReelLatestRow }
  | { ok: false; queued: boolean; error?: string };

export interface StatusResult {
  serverUp: boolean;
  pending: number;
}

// ---------------------------------------------------------------------------
// Profile scans (channel-baseline outlier analysis)
// ---------------------------------------------------------------------------

/** Creator profile header, from the user objects Instagram's page loaded. */
export interface ProfileInfo {
  /** Instagram's numeric user id or YouTube's UC… channel id; '' when the page never showed it. */
  userId: string;
  /** Absent means Instagram. */
  platform?: Platform;
  username: string;
  fullName?: string;
  followers?: number;
  following?: number;
  postsCount?: number;
  biography?: string;
  isVerified?: boolean;
  profilePicUrl?: string;
}

/** One reel on a creator's profile grid (baseline input). */
export interface ProfileReel {
  shortcode: string;
  mediaId?: string;
  url: string;
  /** ISO upload time */
  takenAt: string;
  views: number;
  likes: number;
  comments: number;
  shares?: number;
  durationSec?: number;
  caption?: string;
  thumbnailUrl?: string;
  /** True when the reel is pinned to the top of the profile grid. */
  pinned: boolean;
  /** takenAt was estimated from the reel's place in the grid (no upload date seen). */
  dateEstimated?: boolean;
  /** Read off the grid tile: views are rounded ("1.9M"), likes/comments unknown. */
  fromGrid?: boolean;
  /** Raw API item. Omit from scan uploads to keep them small. */
  raw?: unknown;
}

export type ProfileTier = 'breakout' | 'strong' | 'outlier' | 'normal' | 'under';

/** A ProfileReel scored against the creator's own baseline. */
export interface ScoredReel extends ProfileReel {
  /** views / baselineViews (0 when there is no baseline). */
  multiple: number;
  /** Robust z-score of ln(views); 0 when MAD is 0 or undefined. */
  logZ: number;
  tier: ProfileTier;
  isOutlier: boolean;
  /** True for reels <72h old: scored but excluded from the baseline. */
  early: boolean;
  viewsPerFollower: number | null;
  engagementRate: number | null;
  commentLikeRatio: number | null;
  commentBait: boolean;
  ageDays: number;
}

export interface ProfileStats {
  followers?: number;
  sampleSize: number;
  matureCount: number;
  dateRange: { from: string | null; to: string | null };
  baselineViews: number;
  meanViews: number;
  medianViewsPerFollower: number | null;
  /** Share of mature reels that are outliers. */
  hitRate: number;
  outlierCount: number;
  breakoutCount: number;
  postsPerWeek: number;
  medianEngagementRate: number | null;
  medianDurationSec: number | null;
  commentBaitShare: number;
  /** Top reel by multiple (null when the sample is empty). */
  best: ScoredReel | null;
  /** Median views of newest 10 mature / median of older mature (null if <15 mature). */
  trend: number | null;
  lowConfidence: boolean;
  threshold: number;
  /** Reels whose upload date was estimated from grid order. */
  datesEstimated?: number;
  /** Reels read off grid tiles instead of Instagram's data. */
  fromGrid?: number;
  /** Mean time between consecutive uploads, in days (pinned reels left out; null under 2 dated). */
  avgIntervalDays: number | null;
  /** Median and longest gap between uploads, in days (null unless most dates are exact). */
  medianIntervalDays: number | null;
  longestGapDays: number | null;
  /** Days from the newest upload to the scan. */
  lastUploadDays: number | null;
  /** Exact uploads per weekday (0 = Sunday) and per hour, viewer's time zone (null when too few are exact). */
  uploadsByWeekday: number[] | null;
  uploadsByHour: number[] | null;
  /** The scan covered the last N days of uploads instead of the last N reels. */
  windowDays?: number;
  /**
   * Set when the sample was scored against a wider yardstick (a time window
   * against the whole channel); baselineViews, matureCount, meanViews and
   * trend then describe it, the rest describe the sample.
   */
  channel?: ChannelBaseline;
}

/** What reels are scored against: a creator's mature reels (lib/outliers.ts channelBaseline). */
export interface ChannelBaseline {
  /** Reels it was built from, and how many of them are older than 72 hours. */
  sampleSize: number;
  matureCount: number;
  /** Median views of the mature reels. */
  views: number;
  meanViews: number;
  /** Median and scaled MAD of ln(views), for the spread check. */
  medLog: number;
  madScaled: number;
  /** Median views of the newest 10 mature over the older ones (null under 15). */
  trend: number | null;
}

export interface ProfileAnalysis {
  stats: ProfileStats;
  /** Scored reels, newest first. */
  reels: ScoredReel[];
}

/** One row of GET /api/profiles (latest scan per username, platform and format). */
export interface ProfileScanSummary {
  username: string;
  platform: Platform;
  format: ScanFormat;
  followers: number | null;
  scanned_at: string;
  baseline_views: number | null;
  outlier_count: number;
  hit_rate: number;
  sample_size: number;
}

/** A YouTube channel scan running on the server (GET /api/youtube/scans/:id). */
export interface YtScanState {
  /** opening: starting yt-dlp; scrolling: listing their Shorts or videos; reading: exact numbers for a few; done / failed. */
  stage: 'opening' | 'scrolling' | 'reading' | 'done' | 'failed';
  /** Shorts (or videos) listed so far. */
  count: number;
  result?: {
    profile: ProfileInfo;
    reels: ProfileReel[];
    /** full: got the limit or every Short (video) they have; stopped: Stop; capped: ran out of time. */
    ended: 'full' | 'stopped' | 'capped';
  };
  error?: string;
}

export interface ProfileScanHistory {
  id: number;
  scanned_at: string;
  baseline_views: number | null;
}

/** GET /api/profiles/:username response. */
export interface ProfileScanDetail {
  id: number;
  username: string;
  platform?: Platform;
  format?: ScanFormat;
  user_id: string | null;
  full_name: string | null;
  followers: number | null;
  scanned_at: string;
  sample_size: number;
  threshold: number;
  baseline_views: number | null;
  stats: ProfileStats;
  reels: ScoredReel[];
  scans: ProfileScanHistory[];
}
