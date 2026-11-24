// Where things are on YouTube's pages. YouTube keeps earlier pages in the DOM
// (hidden) when you move around, so every lookup starts from the page on
// show. Tag names (ytd-*, *-view-model) have survived redesigns far better
// than class names, so these lean on them.
import type { ScanFormat } from '@/lib/types';
import { channelKey, YT_ID_RE } from '@/lib/youtube';

/** The video this URL is about: /watch?v=… or /shorts/…; null elsewhere. */
export function pageVideoId(url: URL | Location = location): string | null {
  const parts = url.pathname.split('/').filter(Boolean);
  const id = parts[0] === 'watch' ? new URLSearchParams(url.search).get('v') : parts[0] === 'shorts' ? parts[1] : null;
  return id && YT_ID_RE.test(id) ? id : null;
}

/**
 * The channel a channel page belongs to (/@handle…, /channel/UC…), as stored
 * (lib/youtube.ts channelKey); null on every other page.
 */
export function channelFromPath(pathname: string): string | null {
  const first = pathname.split('/').filter(Boolean)[0] ?? '';
  if (!first.startsWith('@') && first !== 'channel') return null;
  return channelKey(pathname);
}

/**
 * What a channel tab lists: /videos their long-form videos, /shorts their
 * Shorts; null on every other tab (Home, Podcasts…) and off channel pages.
 */
export function channelTabFormat(pathname: string): ScanFormat | null {
  if (channelFromPath(pathname) === null) return null;
  const parts = pathname.split('/').filter(Boolean);
  const tab = parts[0] === 'channel' ? parts[2] : parts[1];
  return tab === 'videos' ? 'long' : tab === 'shorts' ? 'short' : null;
}

/** The page on show: ytd-watch-flexy, ytd-shorts, ytd-browse… (null when YouTube shows another). */
function activePage(tag: string): HTMLElement | null {
  for (const el of Array.from(document.querySelectorAll<HTMLElement>(`ytd-page-manager > ${tag}`))) {
    if (!el.hidden && !el.hasAttribute('hidden')) return el;
  }
  return null;
}

/**
 * Where Save goes on the watch page: after Subscribe, in the owner
 * row. Not among like/share: YouTube folds those into "…" by measuring its
 * own buttons, so anything added there pushes Share off the edge instead.
 */
export function watchActionRow(): HTMLElement | null {
  return activePage('ytd-watch-flexy')?.querySelector<HTMLElement>('ytd-watch-metadata #owner') ?? null;
}

/** Every Shorts player action column (like, comments, share, remix) on the Shorts page. */
export function shortsActionBars(): HTMLElement[] {
  const page = activePage('ytd-shorts');
  if (!page) return [];
  const bars = Array.from(page.querySelectorAll<HTMLElement>('ytd-reel-video-renderer reel-action-bar-view-model'));
  // Older layout: a plain #actions column.
  return bars.length > 0 ? bars : Array.from(page.querySelectorAll<HTMLElement>('ytd-reel-video-renderer #actions'));
}

/** Where the channel strip goes: above the channel tab's content, under the tabs. */
export function channelContentTop(): HTMLElement | null {
  return activePage('ytd-browse')?.querySelector<HTMLElement>('ytd-two-column-browse-results-renderer > #primary') ?? null;
}

export interface ShortTile {
  /** The thumbnail link: the badge goes inside it. */
  a: HTMLAnchorElement;
  /** What dims in "Outliers only": the whole grid item, title and all. */
  tile: HTMLElement;
  code: string;
}

/** Shorts tiles on the channel page on show (Shorts tab grid, Home tab shelf). */
export function shortTiles(): ShortTile[] {
  const page = activePage('ytd-browse');
  if (!page) return [];
  const out: ShortTile[] = [];
  for (const lockup of Array.from(page.querySelectorAll<HTMLElement>('ytm-shorts-lockup-view-model, ytd-reel-item-renderer'))) {
    if (lockup.parentElement?.closest('ytm-shorts-lockup-view-model')) continue; // the -v2 wrapper holds the real one
    const a = lockup.querySelector<HTMLAnchorElement>('a[href^="/shorts/"]');
    const code = a?.getAttribute('href')?.split('/')[2]?.split('?')[0];
    if (!a || !code || !YT_ID_RE.test(code)) continue;
    const tile = lockup.closest<HTMLElement>('ytd-rich-item-renderer') ?? lockup;
    out.push({ a, tile, code });
  }
  return out;
}

/** The video id a /watch link opens, without a playlist (a playlist tile is not one video). */
function watchCode(a: HTMLAnchorElement): string | null {
  const href = a.getAttribute('href') ?? '';
  if (!href.startsWith('/watch?')) return null;
  const q = new URLSearchParams(href.slice('/watch?'.length));
  const v = q.get('v');
  return v && !q.has('list') && YT_ID_RE.test(v) ? v : null;
}

/**
 * Long-video tiles on the channel page on show (Videos tab grid, Home tab
 * shelves): the thumbnail link of each. yt-lockup-view-model is the 2025+
 * layout; ytd-rich-grid-media / ytd-grid-video-renderer the older ones.
 */
export function videoTiles(): ShortTile[] {
  const page = activePage('ytd-browse');
  if (!page) return [];
  const out: ShortTile[] = [];
  const seen = new Set<HTMLAnchorElement>();
  for (const lockup of Array.from(
    page.querySelectorAll<HTMLElement>('yt-lockup-view-model, ytd-rich-grid-media, ytd-grid-video-renderer, ytd-video-renderer'),
  )) {
    if (lockup.closest('ytd-channel-video-player-renderer')) continue; // the Home tab's featured player
    const a =
      lockup.querySelector<HTMLAnchorElement>('a#thumbnail[href^="/watch?"]') ??
      Array.from(lockup.querySelectorAll<HTMLAnchorElement>('a[href^="/watch?"]')).find((l) =>
        l.querySelector('img, yt-thumbnail-view-model, ytd-thumbnail, yt-image'),
      );
    const code = a ? watchCode(a) : null;
    if (!a || !code || seen.has(a)) continue;
    seen.add(a);
    const tile = lockup.closest<HTMLElement>('ytd-rich-item-renderer') ?? lockup;
    out.push({ a, tile, code });
  }
  return out;
}
