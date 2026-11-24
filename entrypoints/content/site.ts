// The site the content script runs on, and every word that differs between
// Instagram and YouTube. The shared UI (strip, panel, pill, rows, buttons,
// toast, lightbox) reads `site` instead of saying "reel" itself. Each content
// script is its own bundle, so one module-level value per page is enough:
// the YouTube entry calls useSite(YOUTUBE) before it renders anything.
//
// A channel scan says its own words (ProfileStore.site): on YouTube the same
// page can show a scan of their Shorts (YOUTUBE) or of their long-form videos
// (YOUTUBE_VIDEOS), so the strip, panel and pill read the store's.
import type { Platform, ProfileStats, ScanFormat } from '@/lib/types';
import type { ScanTarget } from './profileStore';
import type { ScanStage } from './reelScan';
import { windowText } from '@/lib/format';

export interface Site {
  platform: Platform;
  /** What a channel scan of these words lists: short-form (reels, Shorts) or long-form videos. */
  format: ScanFormat;
  name: string;
  /** What a channel scan is made of (singular / plural / plural at a sentence start). */
  item: string;
  items: string;
  Items: string;
  /** What a Save button saves. */
  video: string;
  Video: string;
  /** The Save button's label in a row of actions. */
  saveLabel: string;
  followers: string;
  /** "the whole profile" / "the whole channel". */
  whole: string;
  stage: Record<ScanStage, string>;
  /** Under the running count, when the page is about to move by itself. */
  runNote: string | null;
  stopTitle: string;
  rescanTitle(target: ScanTarget): string;
  /** When most upload dates are estimated: where the ages come from. */
  estimatedAges: string;
  /** Tooltip on an estimated age. */
  estimatedTitle: string;
  /**
   * Estimated dates sit between exact ones (the newest and oldest are looked
   * up), so date ranges and posting rates still hold.
   */
  datesAnchored: boolean;
  emptyNote: string;
  ctaBody: string;
  sampleNote: string;
  dimTitle: string;
  cappedNote(of: string): string;
  approxNote(st: ProfileStats): string | null;
  profileUrl(username: string): string;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export const INSTAGRAM: Site = {
  platform: 'instagram',
  format: 'short',
  name: 'Instagram',
  item: 'reel',
  items: 'reels',
  Items: 'Reels',
  video: 'reel',
  Video: 'Reel',
  saveLabel: 'Save reel',
  followers: 'followers',
  whole: 'the whole profile',
  stage: {
    opening: 'Opening the reels tab…',
    scrolling: 'Scrolling the reels tab…',
    reading: 'Scoring what loaded…',
  },
  runNote: 'The page scrolls by itself, then comes back here.',
  stopTitle: 'Stop scrolling and score what loaded',
  rescanTitle: (t) =>
    t.kind === 'days'
      ? `Scroll their whole reels tab again and score the reels from ${windowText(t.days)}`
      : t.n === Infinity
        ? 'Scroll their whole reels tab again'
        : `Scroll the reels tab again for the last ${t.n} reels`,
  estimatedAges: 'ages from grid order',
  estimatedTitle: 'Estimated from grid order',
  datesAnchored: false,
  emptyNote: 'No reels loaded. The account may be private or have no reels yet.',
  ctaBody:
    'Scores their latest reels against their own median and marks the outliers on the grid below. Scanning scrolls their reels tab and reads what Instagram loads; nothing extra is requested.',
  sampleNote:
    'Larger samples give a steadier baseline but take longer; All keeps going until their grid ends. A time window also scrolls the whole grid, so its reels are scored against everything they have posted. The scan scrolls their reels tab every second or two and reads what Instagram loads.',
  dimTitle: "Dim every tile in the grid below that isn't an outlier",
  cappedNote: (of) => `Stopped at ${of}: a long scan runs for 40 minutes at most. Stats use what loaded.`,
  approxNote(st) {
    const n = st.sampleSize;
    const grid = st.fromGrid ?? 0;
    const est = st.datesEstimated ?? 0;
    if (n === 0 || (grid === 0 && est === 0)) return null;
    if (grid >= n) return 'Approximate: read off the grid, so views are rounded and ages come from grid order.';
    const parts: string[] = [];
    if (est > 0) parts.push(`${est === n ? 'no upload dates came through' : `${est} of ${n} reels had no upload date`}, so ages come from grid order`);
    if (grid > 0) parts.push(`${grid} ${grid === 1 ? 'reel was' : 'reels were'} read off the grid with rounded views`);
    return `Approximate: ${parts.join('; ')}.`;
  },
  profileUrl: (u) => `https://www.instagram.com/${u}/`,
};

export const YOUTUBE: Site = {
  platform: 'youtube',
  format: 'short',
  name: 'YouTube',
  item: 'Short',
  items: 'Shorts',
  Items: 'Shorts',
  video: 'video',
  Video: 'Video',
  saveLabel: 'Save video',
  followers: 'subscribers',
  whole: 'the whole channel',
  stage: {
    opening: 'Asking YouTube for their Shorts…',
    scrolling: 'Listing their Shorts…',
    reading: 'Looking up exact numbers and dates…',
  },
  runNote: null,
  stopTitle: 'Stop and score what came in',
  rescanTitle: (t) =>
    t.kind === 'days'
      ? `List all their Shorts again and score the ones from ${windowText(t.days)}`
      : t.n === Infinity
        ? 'List all their Shorts again'
        : `Scan the last ${t.n} Shorts again`,
  estimatedAges: 'ages from list order',
  estimatedTitle: 'Estimated from list order, between Shorts with exact dates',
  datesAnchored: true,
  emptyNote: "No Shorts came back. The channel may not post Shorts.",
  ctaBody:
    "Scores their latest Shorts against their own median and marks the outliers wherever their Shorts show. Your library server asks YouTube for the list (signed out); this page doesn't move.",
  sampleNote:
    'Larger samples give a steadier baseline but take a little longer; All lists every Short they have. A time window also lists them all, so its Shorts are scored against the whole channel. YouTube rounds views in the list, so a few dozen Shorts are looked up for exact numbers and dates.',
  dimTitle: "Dim every Short on this page that isn't an outlier",
  cappedNote: (of) => `Stopped at ${of}: a channel scan runs for 15 minutes at most. Stats use what came in.`,
  approxNote(st) {
    const n = st.sampleSize;
    const grid = st.fromGrid ?? 0;
    if (n === 0 || grid === 0) return null;
    const exact = n - grid;
    return exact > 0
      ? `Approximate: YouTube lists Shorts with rounded views and no dates. ${plural(exact, 'Short')} got exact numbers; the other dates are estimated from list order.`
      : 'Approximate: YouTube lists Shorts with rounded views and no dates, and the exact lookups failed, so ages are guesses.';
  },
  profileUrl: (u) => (/^UC[\w-]{22}$/.test(u) ? `https://www.youtube.com/channel/${u}` : `https://www.youtube.com/@${u}`),
};

/** A YouTube channel's long-form videos (its Videos tab): same site, its own words. */
export const YOUTUBE_VIDEOS: Site = {
  ...YOUTUBE,
  format: 'long',
  item: 'video',
  items: 'videos',
  Items: 'Videos',
  stage: {
    opening: 'Asking YouTube for their videos…',
    scrolling: 'Listing their videos…',
    reading: 'Looking up exact numbers and dates…',
  },
  rescanTitle: (t) =>
    t.kind === 'days'
      ? `List all their videos again and score the ones from ${windowText(t.days)}`
      : t.n === Infinity
        ? 'List all their videos again'
        : `Scan the last ${t.n} videos again`,
  estimatedTitle: 'Estimated from list order, between videos with exact dates',
  emptyNote: 'No long-form videos came back. The channel may only post Shorts or live streams.',
  ctaBody:
    "Scores their latest long-form videos against their own median, apart from their Shorts, and marks the outliers wherever their videos show. Your library server asks YouTube for the list (signed out); this page doesn't move.",
  sampleNote:
    'Larger samples give a steadier baseline but take a little longer; All lists every video they have. A time window also lists them all, so its videos are scored against the whole channel. YouTube rounds views in the list, so a few dozen videos are looked up for exact numbers and dates. Shorts and live streams are not part of it.',
  dimTitle: "Dim every video on this page that isn't an outlier",
  approxNote(st) {
    const n = st.sampleSize;
    const grid = st.fromGrid ?? 0;
    if (n === 0 || grid === 0) return null;
    const exact = n - grid;
    return exact > 0
      ? `Approximate: YouTube lists videos with rounded views and no dates. ${plural(exact, 'video')} got exact numbers; the other dates are estimated from list order.`
      : 'Approximate: YouTube lists videos with rounded views and no dates, and the exact lookups failed, so ages are guesses.';
  },
};

/** The words for a scan of this format on this site (long-form only exists on YouTube). */
export const siteFor = (base: Site, format: ScanFormat): Site => (format === 'long' && base.platform === 'youtube' ? YOUTUBE_VIDEOS : base);

/** The site this page is on. Instagram unless the entry said otherwise. */
export let site: Site = INSTAGRAM;

export function useSite(s: Site): void {
  site = s;
}
