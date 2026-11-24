// Display helpers shared by the content script and the popup.
import type { ProfileTier } from './types';

/** 1234 -> "1.2K", 34000 -> "34K", 1200000 -> "1.2M". */
export function compact(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '–';
  const abs = Math.abs(n);
  const fmt = (v: number, suffix: string) =>
    (v >= 100 ? Math.round(v).toString() : v.toFixed(1).replace(/\.0$/, '')) + suffix;
  if (abs >= 1e9) return fmt(n / 1e9, 'B');
  if (abs >= 1e6) return fmt(n / 1e6, 'M');
  if (abs >= 1e3) return fmt(n / 1e3, 'K');
  return Math.round(n).toString();
}

/** views/followers ratio -> "3.4x". */
export function ratio(r: number | null | undefined): string {
  if (r == null || !Number.isFinite(r)) return '–';
  return (r >= 10 ? Math.round(r).toString() : r.toFixed(1)) + 'x';
}

/** Hours -> "45m", "5h", "3d", "7w". */
export function age(hours: number | null | undefined): string {
  if (hours == null || !Number.isFinite(hours) || hours < 0) return '–';
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))}m`;
  if (hours < 48) return `${Math.round(hours)}h`;
  const days = hours / 24;
  if (days < 21) return `${Math.round(days)}d`;
  return `${Math.round(days / 7)}w`;
}

/** Like age(), but months and years past 16 weeks: "45m", "3d", "7w", "5mo", "2.4y", "21y". */
export function longAge(hours: number | null | undefined): string {
  if (hours == null || !Number.isFinite(hours) || hours < 0) return '–';
  const days = hours / 24;
  if (days < 16 * 7) return age(hours);
  if (days < 730) return `${Math.round(days / 30.44)}mo`;
  const years = days / 365.25;
  return `${years < 10 ? years.toFixed(1).replace(/\.0$/, '') : Math.round(years)}y`;
}

/** Days -> "9h", "2.4d", "12d", "5w": how long between uploads. */
export function interval(days: number | null | undefined): string {
  if (days == null || !Number.isFinite(days) || days < 0) return '–';
  if (days < 1) return `${Math.max(1, Math.round(days * 24))}h`;
  if (days < 10) return `${days.toFixed(1).replace(/\.0$/, '')}d`;
  if (days < 42) return `${Math.round(days)}d`;
  return `${Math.round(days / 7)}w`;
}

/** A time window in days -> "the last 30 days", "the last 6 months", "the last year". */
export function windowText(days: number): string {
  if (days === 365) return 'the last year';
  if (days % 365 === 0) return `the last ${days / 365} years`;
  if (days % 30 === 0 && days > 30) return `the last ${days / 30} months`;
  return days === 1 ? 'the last day' : `the last ${days} days`;
}

/** Views-per-follower at or above this counts as a strong outlier. */
export const OUTLIER_RATIO = 3;

/** At or above this, an outlier is exceptional (gets the filled treatment). */
export const BLAZE_RATIO = 10;

export type OutlierTier = 'none' | 'low' | 'mid' | 'hot' | 'blaze';

/** Bucket a views/followers ratio for colour: <1x, 1-3x, 3-10x, 10x+. */
export function outlierTier(r: number | null | undefined): OutlierTier {
  if (r == null || !Number.isFinite(r)) return 'none';
  if (r >= BLAZE_RATIO) return 'blaze';
  if (r >= OUTLIER_RATIO) return 'hot';
  if (r >= 1) return 'mid';
  return 'low';
}

/** 1234567 -> "1,234,567". */
export function full(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '–';
  return Math.round(n).toLocaleString('en-US');
}

/** Seconds -> "0:34", "12:05", "1:02:03". */
export function duration(sec: number | null | undefined): string {
  if (sec == null || !Number.isFinite(sec) || sec < 0) return '–';
  const s = Math.round(sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const pad = (v: number) => v.toString().padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s % 60)}` : `${m}:${pad(s % 60)}`;
}

/** ISO -> "Oct 12, 2026" (or "Oct 12, 14:05" with time). */
export function date(iso: string | null | undefined, withTime = false): string {
  if (!iso) return '–';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '–';
  return withTime
    ? d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })
    : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// ---------------------------------------------------------------------------
// Channel tiers (views vs the creator's own baseline). The palette below is
// the single source of tier colour for the content panel and the library:
// both apply `tierVars(theme)` as CSS custom properties on a root element and
// style `[data-tier]` against `--ct-<tier>-fg|bg|dot`.
// ---------------------------------------------------------------------------

export const TIERS: readonly ProfileTier[] = ['breakout', 'strong', 'outlier', 'normal', 'under'];

export const TIER_LABEL: Record<ProfileTier, string> = {
  breakout: 'Breakout',
  strong: 'Strong',
  outlier: 'Outlier',
  normal: 'Normal',
  under: 'Under',
};

interface TierInk {
  /** Text colour. */
  fg: string;
  /** Fill behind the number for the loudest tiers ('transparent' otherwise). */
  bg: string;
  /** Chart dot fill. */
  dot: string;
}

const MARIGOLD = '#f4b740';
const INK = '#1d1503';

export const TIER_PALETTE: Record<'dark' | 'light', Record<ProfileTier, TierInk>> = {
  dark: {
    breakout: { fg: INK, bg: MARIGOLD, dot: MARIGOLD },
    strong: { fg: MARIGOLD, bg: 'rgba(244, 183, 64, 0.16)', dot: MARIGOLD },
    outlier: { fg: MARIGOLD, bg: 'transparent', dot: MARIGOLD },
    normal: { fg: '#e9eaec', bg: 'transparent', dot: 'rgba(233, 234, 236, 0.42)' },
    under: { fg: '#6b707a', bg: 'transparent', dot: 'rgba(141, 146, 156, 0.32)' },
  },
  light: {
    breakout: { fg: INK, bg: MARIGOLD, dot: '#d99a17' },
    strong: { fg: '#7a4d00', bg: 'rgba(244, 183, 64, 0.34)', dot: '#d99a17' },
    outlier: { fg: '#9a6100', bg: 'transparent', dot: '#d99a17' },
    normal: { fg: '#15171c', bg: 'transparent', dot: 'rgba(21, 23, 28, 0.38)' },
    under: { fg: '#959aa4', bg: 'transparent', dot: 'rgba(92, 97, 107, 0.3)' },
  },
};

/** `--ct-<tier>-fg|bg|dot` custom properties for a theme. */
export function tierVars(theme: 'dark' | 'light'): Record<string, string> {
  const out: Record<string, string> = {};
  for (const t of TIERS) {
    const ink = TIER_PALETTE[theme][t];
    out[`--ct-${t}-fg`] = ink.fg;
    out[`--ct-${t}-bg`] = ink.bg;
    out[`--ct-${t}-dot`] = ink.dot;
  }
  return out;
}

/** Channel multiple -> "5.2x", "12x", "0.3x"; tiny values as "<0.1x". */
export function multiple(m: number | null | undefined): string {
  if (m == null || !Number.isFinite(m) || m <= 0) return '–';
  if (m < 0.1) return '<0.1x';
  return ratio(m).replace('.0x', 'x');
}

/** 0.123 -> "12%", 0.0456 -> "4.6%". */
export function pct(x: number | null | undefined): string {
  if (x == null || !Number.isFinite(x)) return '–';
  const v = x * 100;
  return (v !== 0 && Math.abs(v) < 10 ? v.toFixed(1).replace(/\.0$/, '') : Math.round(v).toString()) + '%';
}

/** A rate per 1,000 -> "0.42", "3.1", "27". */
export function perK(x: number | null | undefined): string {
  if (x == null || !Number.isFinite(x) || x < 0) return '–';
  if (x === 0) return '0';
  if (x < 1) return x.toFixed(2).replace(/0$/, '');
  if (x < 10) return x.toFixed(1).replace(/\.0$/, '');
  return Math.round(x).toString();
}

/** Comments per like -> "1:36" (one comment per 36 likes), "1.4:1" when comments outnumber likes. */
export function oneIn(r: number | null | undefined): string {
  if (r == null || !Number.isFinite(r) || r <= 0) return '–';
  if (r >= 1) return `${r < 10 ? r.toFixed(1).replace(/\.0$/, '') : Math.round(r)}:1`;
  return `1:${Math.round(1 / r)}`;
}

/** ISO -> "3d ago", "5h ago", "just now". */
export function ago(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return '–';
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '–';
  const hours = (now - t) / 3600000;
  if (hours < 1 / 60) return 'just now';
  return `${age(hours)} ago`;
}
