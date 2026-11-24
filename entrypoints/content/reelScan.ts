// Profile scan by scrolling: Instagram's own page loads the reels (the page
// hook captures every response), we only scroll the reels tab like a person
// would and read what arrived. No request of ours touches Instagram.
//
//   1. open the creator's Reels tab through Instagram's own tab link (SPA),
//      so the grid holds reels with their view counts;
//   2. scroll in uneven steps (about two thirds of a screen, 1.0-1.8 s apart,
//      unhurried so Instagram keeps up) until enough reels are in, the grid
//      stops growing for STALL_STEPS steps, or the viewer hits Stop;
//   3. put the scroll position back and build ProfileReel[] from the
//      captured items, falling back to the numbers printed on grid tiles.
import { buildProfileReels, itemUserId, itemUsername, type CaptureStore, type GridTile } from '@/lib/captureStore';
import { followersFromDom, rememberFollowers } from '@/lib/instagram';
import { usernameFromPath } from '@/lib/profile';
import type { ProfileInfo, ProfileReel, ScanFormat } from '@/lib/types';
import { gridTiles, pageIsLoading, reelsTabLink, tileInfo } from './dom';

export type ScanStage = 'opening' | 'scrolling' | 'reading';

export interface ScanProgress {
  stage: ScanStage;
  count: number;
}

export interface ScanOpts {
  limit: number;
  /**
   * Time-window scans (ms epoch): the caller keeps the reels uploaded since
   * this, but scores them against everything, so the scan still reads the
   * whole channel (limit Infinity). Instagram dates are exact anyway; the
   * YouTube scan uses it to look up exact dates around the window's edge.
   */
  since?: number;
  /** YouTube: 'long' lists the channel's long-form videos instead of its Shorts. */
  format?: ScanFormat;
  /** Aborting means Stop: scrolling ends and what loaded so far is returned. */
  signal: AbortSignal;
  onProgress?: (p: ScanProgress) => void;
}

export interface ScanOutcome {
  profile: ProfileInfo;
  reels: ProfileReel[];
  /**
   * full: reached the limit; stalled: the grid stopped growing (for a whole-profile scan, the end of
   * their reels); capped: hit the time or step ceiling; stopped: Stop; left:
   * navigated away.
   */
  ended: 'full' | 'stalled' | 'capped' | 'stopped' | 'left';
}

export const STEP_MIN_MS = 1000;
export const STEP_JITTER_MS = 800;
/** Step height as a share of the viewport: uneven, under a screen. */
export const STEP_MIN = 0.55;
export const STEP_JITTER = 0.3;
/** Steps without new reels before giving up (each one nudges the loader). */
export const STALL_STEPS = 5;
/** Extra patience while Instagram shows its loading spinner. */
export const SPINNER_STEPS = 10;
const MAX_STEPS = 400;
/** Hard ceiling on one scan, however slowly the grid loads. */
const MAX_SCAN_MS = 8 * 60_000;
/** Whole-profile scans (limit Infinity, time windows too), and custom samples past 150, run within these. */
export const MAX_STEPS_ALL = 2000;
export const MAX_SCAN_MS_ALL = 40 * 60_000;
const NAV_TIMEOUT_MS = 5000;

export function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const t = setTimeout(done, ms);
    function done() {
      clearTimeout(t);
      signal.removeEventListener('abort', done);
      resolve();
    }
    signal.addEventListener('abort', done, { once: true });
  });
}

async function waitFor(cond: () => boolean, timeoutMs: number, signal: AbortSignal): Promise<boolean> {
  const end = Date.now() + timeoutMs;
  while (!signal.aborted && Date.now() < end) {
    if (cond()) return true;
    await sleep(100, signal);
  }
  return cond();
}

export function whenVisible(signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (!document.hidden || signal.aborted) return resolve();
    const done = () => {
      document.removeEventListener('visibilitychange', check);
      signal.removeEventListener('abort', done);
      resolve();
    };
    const check = () => !document.hidden && done();
    document.addEventListener('visibilitychange', check);
    signal.addEventListener('abort', done, { once: true });
  });
}

export const scrollTo = (top: number) => window.scrollTo({ top, behavior: 'instant' });
export const atBottom = () => window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 4;
const isReelsTab = (username: string) =>
  location.pathname.toLowerCase().replace(/\/?$/, '/') === `/${username.toLowerCase()}/reels/`;

export async function scanByScrolling(username: string, store: CaptureStore, opts: ScanOpts): Promise<ScanOutcome> {
  const { signal } = opts;
  const onProfile = () => usernameFromPath(location.pathname)?.toLowerCase() === username.toLowerCase();
  const startY = window.scrollY;

  // ---- 1. reels tab -------------------------------------------------------------
  opts.onProgress?.({ stage: 'opening', count: 0 });
  if (!isReelsTab(username)) {
    const link = reelsTabLink(username);
    if (link) {
      const before = gridTiles()[0]?.a;
      link.click();
      await waitFor(() => isReelsTab(username), NAV_TIMEOUT_MS, signal);
      // Let the reels grid replace the posts grid before reading tiles (the
      // first tile is often the same reel, but never the same element).
      await waitFor(() => {
        const first = gridTiles()[0]?.a;
        return first !== undefined && first !== before && !before?.isConnected;
      }, NAV_TIMEOUT_MS, signal);
    }
  }

  // ---- 2. scroll ----------------------------------------------------------------------
  const tiles: GridTile[] = [];
  const tileIndex = new Map<string, number>();
  const collect = () => {
    for (const { a, code } of gridTiles()) {
      const info = tileInfo(a, code);
      const at = tileIndex.get(code);
      if (at === undefined) {
        tileIndex.set(code, tiles.length);
        tiles.push(info);
      } else if (tiles[at]!.views === undefined && info.views !== undefined) {
        tiles[at] = info;
      }
    }
  };
  const tileCodes = () => new Set(tileIndex.keys());
  const build = (limit: number) =>
    buildProfileReels({ entries: store.mediaFor(username, tileCodes()), tiles, limit, now: new Date() });

  collect();
  let count = build(Infinity).length;
  opts.onProgress?.({ stage: 'scrolling', count: Math.min(count, opts.limit) });
  let ended: ScanOutcome['ended'] = 'full';
  let stalls = 0;
  let spinnerWaits = 0;
  const startedAt = Date.now();
  const long = opts.limit > 150;
  const maxSteps = long ? MAX_STEPS_ALL : MAX_STEPS;
  const maxMs = long ? MAX_SCAN_MS_ALL : MAX_SCAN_MS;
  for (let step = 0; count < opts.limit; step++) {
    if (signal.aborted) {
      ended = 'stopped';
      break;
    }
    if (!onProfile()) {
      ended = 'left';
      break;
    }
    if (step >= maxSteps || Date.now() - startedAt > maxMs) {
      ended = 'capped';
      break;
    }
    // Background tabs don't render, so Instagram loads nothing: wait it out.
    await whenVisible(signal);
    if (stalls > 0 || atBottom()) {
      // Nudge: a little up, then all the way down, so Instagram's
      // load-more sentinel re-enters the viewport.
      window.scrollBy({ top: -Math.round(window.innerHeight * 0.3), behavior: 'instant' });
      await sleep(250 + Math.random() * 250, signal);
      scrollTo(document.documentElement.scrollHeight);
    } else window.scrollBy({ top: Math.round(window.innerHeight * (STEP_MIN + Math.random() * STEP_JITTER)), behavior: 'instant' });
    await sleep(STEP_MIN_MS + Math.random() * STEP_JITTER_MS, signal);
    collect();
    const next = build(Infinity).length;
    if (next > count) {
      stalls = 0;
      spinnerWaits = 0;
    } else if (pageIsLoading() && spinnerWaits < SPINNER_STEPS) {
      spinnerWaits++;
    } else if (++stalls >= STALL_STEPS) {
      count = next;
      ended = 'stalled';
      break;
    }
    count = next;
    if (!signal.aborted) opts.onProgress?.({ stage: 'scrolling', count: Math.min(count, opts.limit) });
  }
  if (count >= opts.limit) ended = 'full';

  // ---- 3. read ---------------------------------------------------------------------------
  opts.onProgress?.({ stage: 'reading', count: Math.min(count, opts.limit) });
  if (onProfile()) scrollTo(startY);
  const reels = build(opts.limit);

  const lower = username.toLowerCase();
  const u = store.user(username);
  const ownId =
    u?.id ??
    store
      .mediaFor(username)
      .map((e) => (itemUsername(e.item)?.toLowerCase() === lower ? itemUserId(e.item) : undefined))
      .find((id) => id !== undefined);
  const followers = u?.followers ?? (onProfile() ? followersFromDom(username) : undefined);
  rememberFollowers(username, followers);
  const profile: ProfileInfo = {
    userId: ownId ?? '',
    username: u?.username ?? username,
    fullName: u?.fullName,
    followers,
    isVerified: u?.isVerified,
  };
  return { profile, reels, ended };
}
