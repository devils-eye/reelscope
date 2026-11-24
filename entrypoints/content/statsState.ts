// Which post's stats card is open, shared by the Instagram and YouTube
// runtimes. The Stats button sits in each post's own shadow host
// (InlineSave.tsx); the card itself renders in the body-level overlay
// (ContentApp → StatsCard.tsx), positioned against that button, so no
// overflow or transform in the site's DOM can clip it.
import { createSignal, type Accessor } from 'solid-js';
import type { ScanRef } from '@/lib/metrics';
import type { ProfileScanDetail } from '@/lib/types';
import type { Mounted } from './hosts';
import type { SaveVariant } from './InlineSave';
import type { ProfileStore } from './profileStore';

export interface StatsTarget {
  /** New per open, so the card remounts (and refetches) for each. */
  id: number;
  code: string;
  /** The Stats button it opened from; null when no button for the post is on screen (shortcut). */
  anchor: HTMLElement | null;
  variant: SaveVariant;
}

export interface StatsControl {
  target: Accessor<StatsTarget | null>;
  /** Open for this post, or close when it is already open from this button. */
  toggle(code: string, anchor: HTMLElement | null, variant: SaveVariant): void;
  /** Close; with restoreFocus, focus goes back to the Stats button (Esc). */
  close(restoreFocus?: boolean): void;
}

export function createStatsControl(): StatsControl {
  const [target, setTarget] = createSignal<StatsTarget | null>(null);
  let seq = 0;
  return {
    target,
    toggle(code, anchor, variant) {
      const cur = target();
      if (cur && cur.code === code && cur.anchor === anchor) setTarget(null);
      else setTarget({ id: ++seq, code, anchor, variant });
    },
    close(restoreFocus = false) {
      const cur = target();
      setTarget(null);
      if (restoreFocus && cur?.anchor?.isConnected) cur.anchor.focus({ preventScroll: true });
    },
  };
}

/** A post's host as the runtimes keep it: what it saves, and how it is laid out. */
export type SaveHost = Mounted & { code: Accessor<string | null>; variant: SaveVariant };

/**
 * The Stats button of the post in view (the shortcut opens the card there):
 * among hosts bound to `code`, the visible one nearest the viewport's middle.
 */
export function statsButtonFor(hosts: Iterable<SaveHost>, code: string): { anchor: HTMLElement; variant: SaveVariant } | null {
  const mid = window.innerHeight / 2;
  let best: { anchor: HTMLElement; variant: SaveVariant; d: number } | null = null;
  for (const h of hosts) {
    if (h.code() !== code || !h.host.isConnected) continue;
    const btn = h.host.shadowRoot?.querySelector<HTMLElement>('.rs-statbtn');
    if (!btn) continue;
    const r = btn.getBoundingClientRect();
    if (r.width === 0 || r.bottom < 0 || r.top > window.innerHeight) continue;
    const d = Math.abs(r.top + r.height / 2 - mid);
    if (!best || d < best.d) best = { anchor: btn, variant: h.variant, d };
  }
  return best && { anchor: best.anchor, variant: best.variant };
}

/** A live in-page scan, as the card compares against it. */
export function scanRefFromStore(s: ProfileStore): ScanRef | null {
  const a = s.analysis();
  const scan = s.scan();
  return a && scan ? { stats: a.stats, reels: a.reels, scannedAt: scan.scannedAt, threshold: s.threshold() } : null;
}

export function scanRefFromDetail(d: ProfileScanDetail): ScanRef {
  return { stats: d.stats, reels: d.reels ?? [], scannedAt: d.scanned_at, threshold: d.threshold ?? 2 };
}

/**
 * Opens the card for the post in view. Not Alt+D: Chrome and Firefox both
 * use it to focus the address bar. N for numbers.
 */
export const STATS_KEY = { code: 'KeyN', label: 'Alt+N' } as const;
