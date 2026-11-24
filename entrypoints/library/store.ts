// Everything the library shows, loaded once from the local server and kept
// fresh: on focus, and every few seconds while the server is unreachable.
import { createMemo, createRoot, createSignal } from 'solid-js';
import { ApiError, listProfiles, listReels, ServerDownError, type LibraryReel } from '@/lib/api';
import { platformOf } from '@/lib/platform';
import type { ProfileScanSummary } from '@/lib/types';

export type LoadState = 'loading' | 'ready' | 'down' | 'error';

const [state, setState] = createSignal<LoadState>('loading');
const [errorText, setErrorText] = createSignal('');
const [reels, setReels] = createSignal<LibraryReel[]>([]);
const [profiles, setProfiles] = createSignal<ProfileScanSummary[]>([]);

export { state, errorText, reels, profiles };

/**
 * Reuse the previous object for rows that didn't change, so a refresh (every
 * time the tab regains focus) doesn't rebuild every card and reload its cover.
 */
function keepSame<T>(prev: T[], next: T[], key: (row: T) => string | number, sig: (row: T) => string = (r) => JSON.stringify(r)): T[] {
  if (prev.length === 0) return next;
  const old = new Map(prev.map((r) => [key(r), r]));
  let changed = prev.length !== next.length;
  const out = next.map((r, i) => {
    const o = old.get(key(r));
    if (o && sig(o) === sig(r)) {
      if (prev[i] !== o) changed = true;
      return o;
    }
    changed = true;
    return r;
  });
  return changed ? out : prev;
}

let inflight: Promise<void> | null = null;
let retry: ReturnType<typeof setInterval> | undefined;

export function refresh(): Promise<void> {
  inflight ??= (async () => {
    try {
      const [r, p] = await Promise.all([listReels({ limit: 1000, sort: 'saved' }), listProfiles()]);
      // Reels carry their raw Instagram JSON; compare what can change instead.
      setReels((prev) =>
        keepSame(prev, r, (x) => x.shortcode, (x) =>
          [x.snapshot_id, x.last_saved_at, x.status, x.notes, x.tags.join(','), x.has_thumb, x.channel_multiple, x.has_video].join('|'),
        ),
      );
      setProfiles((prev) => keepSame(prev, p, (x) => `${x.platform}:${x.format}:${x.username}`));
      setState('ready');
      clearInterval(retry);
      retry = undefined;
    } catch (e) {
      if (e instanceof ServerDownError) {
        setState('down');
        retry ??= setInterval(() => void refresh(), 4000);
      } else {
        setErrorText(e instanceof ApiError ? e.message : String(e));
        setState('error');
      }
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

/** Swap in an updated reel row (after a PATCH). */
export function updateReel(row: LibraryReel): void {
  setReels((rs) => rs.map((r) => (r.shortcode === row.shortcode ? { ...r, ...row } : r)));
}

// Lookups, built once per data change.
const derived = createRoot(() => {
  const reelBy = createMemo(() => new Map(reels().map((r) => [r.shortcode, r])));
  /** Saved reels per site + creator. */
  const reelsByAuthor = createMemo(() => {
    const m = new Map<string, number>();
    for (const r of reels()) {
      const key = `${platformOf(r.platform)}:${r.author_username.toLowerCase()}`;
      m.set(key, (m.get(key) ?? 0) + 1);
    }
    return m;
  });
  return { reelBy, reelsByAuthor };
});

export const reelBy = (code: string) => derived.reelBy().get(code);
/** How many of a creator's reels are saved. */
export const savedCountFor = (platform: unknown, username: string) =>
  derived.reelsByAuthor().get(`${platformOf(platform)}:${username.toLowerCase()}`) ?? 0;
