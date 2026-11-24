// Words for scan progress and scan caveats, shared by the profile strip, the
// floating scan pill and the side panel so they never disagree. Each takes
// the words of the scan it is about (ProfileStore.site: Shorts or long
// videos on YouTube), the page's by default.
import { ago, windowText } from '@/lib/format';
import type { ProfileStats } from '@/lib/types';
import type { BulkScope, BulkSummary, Scan, ScanTarget } from './profileStore';
import type { ScanStage } from './reelScan';
import { site as pageSite, type Site } from './site';

export const stageText = (stage: ScanStage, site: Site = pageSite) => site.stage[stage];

/** "against all 160" after a time window's count: what its baseline was built from. */
export const baselineFrom = (s: Scan) => (s.baseline ? `scored against all ${s.baseline.sampleSize}` : null);

/** "scanned 2h ago", "scanned just now", "not stored, server offline". */
export function whenText(s: Scan, stored: boolean | null): string {
  if (s.stored) return `scanned ${ago(s.scannedAt)}`;
  return stored === false ? 'not stored, server offline' : 'scanned just now';
}

/** "36", or "All" for a whole-profile scan. */
export const sizeLabel = (size: number) => (size === Infinity ? 'All' : String(size));
/** "7d", "6mo", "1y": a time window on a compact picker. */
export const daysLabel = (days: number) => (days % 365 === 0 ? `${days / 365}y` : days % 30 === 0 && days > 30 ? `${days / 30}mo` : `${days}d`);
export const scanLabel = (t: ScanTarget, site: Site = pageSite) =>
  t.kind === 'days'
    ? `Scan ${windowText(t.days).replace('the ', '')}`
    : t.n === Infinity
      ? `Scan all ${site.items}`
      : `Scan last ${t.n} ${site.items}`;
/** " / 36" after a running count, or nothing when the total is open (whole profile, time window). */
export const ofSize = (t: ScanTarget) => (t.kind === 'count' && t.n !== Infinity ? ` / ${t.n}` : '');
/** Progress bar width in %, or null when the total is unknown (whole profile, time window). */
export const progressPct = (count: number, t: ScanTarget) =>
  t.kind === 'count' && t.n !== Infinity ? Math.min(100, (count / t.n) * 100) : null;

/** While a time-window scan runs: why it reads the whole channel. */
export const windowRunNote = (t: ScanTarget, site: Site = pageSite) =>
  t.kind === 'days' ? `Reading ${site.whole} for the baseline, then scoring ${windowText(t.days)}.` : null;

/** Nothing to score: the account has no reels, or none in the window. */
export function emptyNote(s: Scan, site: Site = pageSite): string {
  if (s.target.kind !== 'days' || !s.baseline?.sampleSize) return site.emptyNote;
  return `No ${site.items} uploaded in ${windowText(s.target.days)}. Pick a longer window.`;
}

/** Why the scan fell short of its target, or null. */
export function endedNote(s: Scan, site: Site = pageSite): string | null {
  const t = s.target;
  // A window's reels are all in by then; what fell short is the channel behind the baseline.
  const n = s.baseline?.sampleSize ?? s.reels.length;
  const of = t.kind === 'count' && t.n !== Infinity ? `${n} of ${t.n} ${site.items}` : `${n} ${site.items}`;
  const use = t.kind === 'days' ? 'The baseline uses what loaded.' : 'Stats use what loaded.';
  switch (s.ended) {
    case 'stalled':
      return `The grid stopped loading at ${of}. ${use}`;
    case 'capped':
      return t.kind === 'count' && t.n !== Infinity ? `The scan ran out of time at ${of}. ${use}` : site.cappedNote(of);
    case 'stopped':
      return `Stopped at ${of}. ${use}`;
    case 'left':
      return `You left the ${site.platform === 'youtube' ? 'channel' : 'profile'} at ${of}. ${use}`;
    default:
      return null;
  }
}

/** Most of the sample has no real upload dates (and no exact ones around them): date-based stats are guesses. */
export const datesMostlyEstimated = (st: ProfileStats, site: Site = pageSite) =>
  (st.datesEstimated ?? 0) > st.sampleSize / 2 && !(site.datesAnchored && (st.datesEstimated ?? 0) < st.sampleSize);

/** Caveat for approximate scans (rounded views, estimated ages), or null. */
export const approxNote = (st: ProfileStats, site: Site = pageSite): string | null => site.approxNote(st);

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Label for the "Save all outliers" button; `disabled` when there's nothing to do. */
export function saveAllLabel(outliers: number, unsaved: number, queued = 0): { text: string; disabled: boolean } {
  if (outliers === 0) return { text: 'No outliers', disabled: true };
  if (unsaved === 0) {
    if (queued > 0) return { text: `${queued} queued, server offline`, disabled: true };
    return { text: 'All outliers saved', disabled: true };
  }
  if (unsaved === outliers && queued === 0) {
    return { text: outliers === 1 ? 'Save 1 outlier' : `Save all ${plural(outliers, 'outlier')}`, disabled: false };
  }
  return { text: `Save ${unsaved} unsaved`, disabled: false };
}

/** A row of the bulk-save menu: one scope's button. */
export function bulkScopeLabel(
  scope: BulkScope,
  total: number,
  unsaved: number,
  queued = 0,
  site: Site = pageSite,
): { text: string; disabled: boolean } {
  if (total === 0) return { text: scope === 'outliers' ? 'No outliers' : `No ${site.items}`, disabled: true };
  if (unsaved === 0) {
    if (queued > 0) return { text: `${queued} queued`, disabled: true };
    return { text: 'All saved', disabled: true };
  }
  return { text: `Save ${unsaved}`, disabled: false };
}

export const bulkProgressText = (b: { done: number; total: number }) => `Saving ${Math.min(b.done + 1, b.total)} / ${b.total}`;

/** "Saved 25 · 2 already saved · 1 failed" (zero parts left out). */
export function bulkSummaryText(s: BulkSummary): string {
  const parts = [`Saved ${s.saved}`];
  if (s.already) parts.push(`${s.already} already saved`);
  if (s.queued) parts.push(`${s.queued} queued (server offline)`);
  if (s.failed) parts.push(`${s.failed} failed`);
  if (s.cancelled) parts.push(`${s.cancelled} left (cancelled)`);
  return parts.join(' · ');
}
