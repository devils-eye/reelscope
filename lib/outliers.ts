// Channel-baseline outlier analysis. Pure functions, no DOM — unit tested
// in lib/outliers.test.ts. Also imported by server/index.ts (via
// tierForMultiple) to backfill channel tiers on plain reel saves.
import type { ChannelBaseline, ProfileAnalysis, ProfileReel, ProfileStats, ProfileTier, ScoredReel } from './types';

/** Matches captions that bait a keyword comment / DM / bio-link click. */
export const COMMENT_BAIT_RE =
  /\bcomment\s+["“'‘]?[\w-]+["”'’]?\b|\bdm me\b|link in (my )?bio/i;

const MATURE_AGE_MS = 72 * 3600 * 1000;
const MAD_SCALE = 1.4826;
const DAY_MS = 86400000;
/** Posting days and hours need this many exact upload times (and most of the sample exact). */
const MIN_RHYTHM = 10;

/** Tier for a views/baseline multiple. Shared with the server backfill. */
export function tierForMultiple(multiple: number, threshold = 2): ProfileTier {
  if (!Number.isFinite(multiple)) return 'normal';
  if (multiple >= 10) return 'breakout';
  if (multiple >= 5) return 'strong';
  if (multiple <= 0.5) return 'under';
  if (multiple >= threshold) return 'outlier';
  return 'normal';
}

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? (s[mid] as number) : ((s[mid - 1] as number) + (s[mid] as number)) / 2;
}

function mean(xs: number[]): number {
  if (xs.length === 0) return 0;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function parseTime(iso: string): number | null {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : t;
}

export interface AnalyzeOpts {
  threshold?: number;
  now?: Date;
  /** The sample is the last N days of uploads (echoed into the stats). */
  windowDays?: number;
  /**
   * Score against this yardstick instead of the sample's own (a time window
   * is scored against the whole channel). Kept in the stats as `channel`.
   */
  baseline?: ChannelBaseline;
}

/**
 * A creator's yardstick: the median views of their reels older than 72
 * hours, the spread of log views around it, and the trend (median views of
 * the newest 10 mature reels over the older ones, needs 15).
 */
export function channelBaseline(reels: ProfileReel[], nowMs: number): ChannelBaseline {
  // Reels without a parseable takenAt are treated as fresh (safe direction:
  // excluded from the baseline instead of polluting it).
  const mature = reels
    .map((r) => ({ r, t: parseTime(r.takenAt) }))
    .filter((w): w is { r: ProfileReel; t: number } => w.t !== null && nowMs - w.t > MATURE_AGE_MS && w.r.views > 0)
    .sort((a, b) => b.t - a.t);
  const views = mature.map((w) => w.r.views);
  const logs = views.map((v) => Math.log(v));
  const medLog = median(logs);
  let trend: number | null = null;
  if (views.length >= 15) {
    const medOlder = median(views.slice(10));
    trend = medOlder > 0 ? median(views.slice(0, 10)) / medOlder : null;
  }
  return {
    sampleSize: reels.length,
    matureCount: mature.length,
    views: median(views),
    meanViews: mean(views),
    medLog,
    madScaled: MAD_SCALE * median(logs.map((x) => Math.abs(x - medLog))),
    trend,
  };
}

/**
 * One view count scored against a creator's yardstick: multiple, robust
 * z-score of ln(views) and tier. An 'outlier' by multiple also needs logZ >= 1
 * when the creator's views have real spread (with MAD = 0 every mature reel
 * has identical views, so the threshold alone decides and logZ stays 0).
 */
export function scoreViews(
  views: number,
  base: Pick<ChannelBaseline, 'views' | 'medLog' | 'madScaled'>,
  threshold = 2,
): { multiple: number; logZ: number; tier: ProfileTier } {
  const multiple = base.views > 0 && views > 0 ? views / base.views : 0;
  const logZ = base.madScaled > 0 && views > 0 ? (Math.log(views) - base.medLog) / base.madScaled : 0;
  let tier: ProfileTier = tierForMultiple(multiple, threshold);
  if (tier === 'outlier' && base.madScaled > 0 && !(logZ >= 1)) tier = 'normal';
  return { multiple, logZ, tier };
}

/** Share of upload gaps that must have exact dates on both sides for median/longest gap. */
const EXACT_GAPS = 0.75;

/**
 * Posting rhythm from upload times. Pinned reels are left out: they sit at
 * the top of the grid whatever their age. Gap sizes only count between
 * neighbours whose dates are both exact (estimated dates are evenly spaced,
 * so their gaps say nothing); weekday and hour are in the viewer's time zone.
 */
export function cadence(reels: ProfileReel[], nowMs: number) {
  const dated = reels
    .filter((r) => !r.pinned)
    .map((r) => ({ t: parseTime(r.takenAt), exact: !r.dateEstimated }))
    .filter((d): d is { t: number; exact: boolean } => d.t !== null)
    .sort((a, b) => a.t - b.t);
  const n = dated.length;
  const newest = n > 0 ? dated[n - 1]!.t : null;
  const spanDays = n > 1 ? (newest! - dated[0]!.t) / DAY_MS : 0;
  const gaps: number[] = [];
  for (let i = 1; i < n; i++) if (dated[i]!.exact && dated[i - 1]!.exact) gaps.push((dated[i]!.t - dated[i - 1]!.t) / DAY_MS);
  const gapsOk = gaps.length >= 3 && gaps.length >= (n - 1) * EXACT_GAPS;
  const exact = dated.filter((d) => d.exact);
  const rhythm = exact.length >= MIN_RHYTHM && exact.length * 2 >= n;
  const byWeekday = rhythm ? Array.from({ length: 7 }, () => 0) : null;
  const byHour = rhythm ? Array.from({ length: 24 }, () => 0) : null;
  if (byWeekday && byHour) {
    for (const { t } of exact) {
      const d = new Date(t);
      byWeekday[d.getDay()]!++;
      byHour[d.getHours()]!++;
    }
  }
  return {
    count: n,
    spanDays,
    avgIntervalDays: n > 1 ? spanDays / (n - 1) : null,
    medianIntervalDays: gapsOk ? median(gaps) : null,
    longestGapDays: gapsOk ? Math.max(...gaps) : null,
    lastUploadDays: newest !== null ? Math.max(0, (nowMs - newest) / DAY_MS) : null,
    uploadsByWeekday: byWeekday,
    uploadsByHour: byHour,
  };
}

export function analyzeProfile(
  reels: ProfileReel[],
  profile: { followers?: number },
  opts: AnalyzeOpts = {},
): ProfileAnalysis {
  const threshold = opts.threshold ?? 2;
  const nowMs = opts.now ? opts.now.getTime() : Date.now();
  const followers = profile.followers;

  const withAge = reels.map((r) => {
    const t = parseTime(r.takenAt);
    return { reel: r, takenMs: t, ageMs: t === null ? null : nowMs - t };
  });
  const base = opts.baseline ?? channelBaseline(reels, nowMs);
  const baselineViews = base.views;

  const score = (w: (typeof withAge)[number]): ScoredReel => {
    const { reel } = w;
    const early = !(w.ageMs !== null && w.ageMs > MATURE_AGE_MS);
    const { multiple, logZ, tier } = scoreViews(reel.views, base, threshold);
    const likes = reel.likes ?? 0;
    const comments = reel.comments ?? 0;
    const ageDays = w.ageMs !== null ? w.ageMs / 86400000 : 0;
    return {
      ...reel,
      multiple,
      logZ,
      tier,
      isOutlier: tier === 'outlier' || tier === 'strong' || tier === 'breakout',
      early,
      viewsPerFollower:
        followers !== undefined && followers > 0 && reel.views > 0
          ? reel.views / followers
          : null,
      // Grid tiles only show views, so likes/comments there are unknown, not 0.
      engagementRate: reel.views > 0 && !reel.fromGrid ? (likes + comments) / reel.views : null,
      commentLikeRatio: likes > 0 && !reel.fromGrid ? comments / likes : null,
      commentBait: COMMENT_BAIT_RE.test(reel.caption ?? ''),
      ageDays,
    };
  };

  const scored = withAge.map(score);
  // Newest first; unparseable dates sink to the bottom.
  scored.sort((a, b) => {
    const ta = parseTime(a.takenAt);
    const tb = parseTime(b.takenAt);
    if (ta === null && tb === null) return 0;
    if (ta === null) return 1;
    if (tb === null) return -1;
    return tb - ta;
  });

  const scoredMature = scored.filter((s) => !s.early && s.views > 0);
  const outliers = scored.filter((s) => s.isOutlier);
  const matureOutliers = scoredMature.filter((s) => s.isOutlier);
  const best = scored.reduce<ScoredReel | null>(
    (top, s) => (top === null || s.multiple > top.multiple ? s : top),
    null,
  );

  const times = withAge
    .map((w) => w.takenMs)
    .filter((t): t is number => t !== null)
    .sort((a, b) => a - b);
  const from = times.length > 0 ? new Date(times[0] as number).toISOString() : null;
  const to = times.length > 0 ? new Date(times[times.length - 1] as number).toISOString() : null;
  // Pinned reels are left out of the rate: an old pinned one would stretch the span.
  const rhythm = cadence(reels, nowMs);
  const postsPerWeek = rhythm.count === 0 ? 0 : rhythm.count / (Math.max(rhythm.spanDays, 1) / 7);

  const engagementRates = scored
    .map((s) => s.engagementRate)
    .filter((v): v is number => v !== null);
  const durations = scored
    .map((s) => s.durationSec)
    .filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  const vpf = scoredMature
    .map((s) => s.viewsPerFollower)
    .filter((v): v is number => v !== null);

  const stats: ProfileStats = {
    followers,
    sampleSize: reels.length,
    matureCount: base.matureCount,
    dateRange: { from, to },
    baselineViews,
    meanViews: base.meanViews,
    medianViewsPerFollower: vpf.length > 0 ? median(vpf) : null,
    hitRate: scoredMature.length > 0 ? matureOutliers.length / scoredMature.length : 0,
    outlierCount: outliers.length,
    breakoutCount: scored.filter((s) => s.tier === 'breakout').length,
    postsPerWeek,
    medianEngagementRate: engagementRates.length > 0 ? median(engagementRates) : null,
    medianDurationSec: durations.length > 0 ? median(durations) : null,
    commentBaitShare: scored.length > 0 ? scored.filter((s) => s.commentBait).length / scored.length : 0,
    best,
    trend: base.trend,
    lowConfidence: base.matureCount < 6,
    threshold,
    datesEstimated: reels.filter((r) => r.dateEstimated).length,
    fromGrid: reels.filter((r) => r.fromGrid).length,
    avgIntervalDays: rhythm.avgIntervalDays,
    medianIntervalDays: rhythm.medianIntervalDays,
    longestGapDays: rhythm.longestGapDays,
    lastUploadDays: rhythm.lastUploadDays,
    uploadsByWeekday: rhythm.uploadsByWeekday,
    uploadsByHour: rhythm.uploadsByHour,
    ...(opts.windowDays !== undefined ? { windowDays: opts.windowDays } : {}),
    ...(opts.baseline ? { channel: opts.baseline } : {}),
  };

  return { stats, reels: scored };
}
