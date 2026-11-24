// Instagram DOM heuristics. Class names are obfuscated and change weekly, so
// everything here keys off accessible labels, links and element roles:
//
//   action row   svg[aria-label="Comment"] -> nearest ancestor that also holds
//                svg[aria-label="Like"|"Unlike"] (the like/comment/share group
//                in the feed and modal, the right-hand column in /reels/).
//                Comment-row hearts are skipped because they have no Comment
//                icon next to them.
//   shortcode    the post's own link (a[href*="/p/"|"/reel/"], preferring the
//                one wrapping <time>), else the URL for modals, the /reels/
//                viewer and single post pages.
//   grid tile    main a[href] that parses as a post link and holds an image.
//   profile hdr  main header.
//
// English labels only. When no labelled action row exists (another UI
// language), posts with a <video> get an overlay button on the video instead.
import { countFromTileText, pageCode, postCodeFromHref } from '@/lib/igdom';
import type { GridTile } from '@/lib/captureStore';

export const COMMENT_SEL = 'svg[aria-label="Comment"]';
const LIKE_SEL = 'svg[aria-label="Like"], svg[aria-label="Unlike"]';
const SHARE_SEL = 'svg[aria-label="Share"], svg[aria-label="Share Post"], svg[aria-label="Send"]';
export const HOST_ATTR = 'data-rs-host';

const isOurs = (el: Element) => el.closest(`[${HOST_ATTR}]`) != null;

/** The like/comment/share group (or reels column) a Comment icon belongs to. */
export function actionRowFor(commentSvg: Element): Element | null {
  let el = commentSvg.parentElement;
  for (let i = 0; el && i < 10; i++, el = el.parentElement) {
    if (el.querySelector(LIKE_SEL)) return el;
  }
  return null;
}

/** Child of `row` that contains `el`. */
function slotOf(row: Element, el: Element | null): Element | null {
  let n: Element | null = el;
  while (n && n.parentElement !== row) n = n.parentElement;
  return n;
}

export interface RowPlacement {
  row: Element;
  /** Insert our host before this node (null = append). */
  before: Node | null;
  vertical: boolean;
}

/** Where our button goes: right after Share (or Comment) in the same group. */
export function placementFor(row: Element, commentSvg: Element): RowPlacement | null {
  const commentSlot = slotOf(row, commentSvg);
  if (!commentSlot) return null;
  const likeSlot = slotOf(row, row.querySelector(LIKE_SEL));
  const shareSlot = slotOf(row, row.querySelector(SHARE_SEL));
  const after = shareSlot ?? commentSlot;
  let vertical = false;
  const a = likeSlot?.getBoundingClientRect();
  const b = commentSlot.getBoundingClientRect();
  if (a && a.height > 0 && b.height > 0 && likeSlot !== commentSlot) {
    vertical = Math.abs(b.top - a.top) > Math.abs(b.left - a.left);
  } else {
    const cs = getComputedStyle(row);
    vertical = cs.display.includes('flex') && cs.flexDirection.startsWith('column');
  }
  return { row, before: after.nextSibling, vertical };
}

/** Best post shortcode among the links inside `scope`. */
export function bestCodeIn(scope: Element): string | null {
  const counts = new Map<string, number>();
  for (const a of Array.from(scope.querySelectorAll('a[href]'))) {
    if (isOurs(a)) continue;
    const code = postCodeFromHref(a.getAttribute('href'));
    if (!code) continue;
    if (a.querySelector('time')) return code; // the post's own timestamp link
    counts.set(code, (counts.get(code) ?? 0) + 1);
  }
  let best: string | null = null;
  let n = 0;
  for (const [code, c] of counts) if (c > n) [best, n] = [code, c];
  return best;
}

function uniqueCodesIn(el: Element, limit = 2): Set<string> {
  const out = new Set<string>();
  for (const a of Array.from(el.querySelectorAll('a[href]'))) {
    const code = postCodeFromHref(a.getAttribute('href'));
    if (code) out.add(code);
    if (out.size >= limit) break;
  }
  return out;
}

export function postContainer(el: Element): Element | null {
  return el.closest('article') ?? el.closest('[role="dialog"]');
}

/**
 * Which reel a row belongs to. `dynamic` means "whatever the URL says" (the
 * /reels/ viewer and single pages, where the URL tracks the reel in view).
 */
export function resolveCode(row: Element): { code: string | null; dynamic: boolean } {
  const own = pageCode(location.pathname);
  if (own && row.closest('[role="dialog"]')) return { code: own, dynamic: false };
  const container = postContainer(row);
  if (container) {
    const c = bestCodeIn(container);
    if (c) return { code: c, dynamic: false };
  }
  let el = row.parentElement;
  for (let i = 0; el && el !== document.body && i < 14; i++, el = el.parentElement) {
    const codes = uniqueCodesIn(el);
    if (codes.size === 1) return { code: [...codes][0]!, dynamic: false };
    if (codes.size > 1) break;
  }
  return own ? { code: null, dynamic: true } : { code: null, dynamic: false };
}

/** Reels can't be photos: only posts with a video (or a reel link / reel page). */
export function looksLikeVideoPost(row: Element): boolean {
  if (/^\/reels?\//.test(location.pathname)) return true;
  let scope: Element | null = postContainer(row);
  if (!scope) {
    scope = row;
    for (let i = 0; i < 6 && scope.parentElement; i++) scope = scope.parentElement;
  }
  return scope.querySelector('video, a[href*="/reel/"]') != null;
}

/** Shortcode of the reel in view (Alt+S). */
export function reelInViewShortcode(): string | null {
  const own = pageCode(location.pathname);
  if (own) return own;
  let best: { score: number; el: Element } | null = null;
  for (const article of Array.from(document.querySelectorAll('article'))) {
    const video = article.querySelector('video');
    if (!video) continue;
    const rect = video.getBoundingClientRect();
    const visibleH = Math.max(0, Math.min(rect.bottom, window.innerHeight) - Math.max(rect.top, 0));
    const visibleW = Math.max(0, Math.min(rect.right, window.innerWidth) - Math.max(rect.left, 0));
    const score = visibleH * visibleW;
    if (score > 0 && (!best || score > best.score)) best = { score, el: article };
  }
  return best ? bestCodeIn(best.el) : null;
}

/** Profile-grid tiles currently in the DOM, with their shortcodes. */
export function gridTiles(): Array<{ a: HTMLAnchorElement; code: string }> {
  const out: Array<{ a: HTMLAnchorElement; code: string }> = [];
  for (const a of Array.from(document.querySelectorAll<HTMLAnchorElement>('main a[href]'))) {
    if (a.closest('[role="dialog"], header, nav') || isOurs(a)) continue;
    const code = postCodeFromHref(a.getAttribute('href'));
    if (!code || !a.querySelector('img, video, [style*="background-image"]')) continue;
    out.push({ a, code });
  }
  return out;
}

/**
 * What a grid tile itself shows: the view count printed on reels-tab tiles
 * and the pin icon. Text inside our own badge host is in its shadow root, so
 * it never leaks into textContent here.
 */
export function tileInfo(a: HTMLAnchorElement, code: string): GridTile {
  const pinned = a.querySelector('svg[aria-label*="pinned" i], [aria-label*="pinned" i]') != null;
  return { code, views: countFromTileText(a.textContent ?? ''), pinned };
}

/**
 * Any link of Instagram's that points at this reel (grid tile, feed
 * timestamp, …), so clicking it opens Instagram's own modal. Grid tiles first.
 */
export function pageLinkFor(code: string): HTMLAnchorElement | null {
  let fallback: HTMLAnchorElement | null = null;
  for (const a of Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href]'))) {
    if (isOurs(a) || a.closest('[role="dialog"]')) continue;
    if (postCodeFromHref(a.getAttribute('href')) !== code) continue;
    if (a.closest('main') && a.querySelector('img, video, [style*="background-image"]')) return a;
    fallback ??= a;
  }
  return fallback;
}

/** Instagram's own Reels tab link on a profile (a[href="/<user>/reels/"]). */
export function reelsTabLink(username: string): HTMLAnchorElement | null {
  const want = `/${username.toLowerCase()}/reels/`;
  for (const a of Array.from(document.querySelectorAll<HTMLAnchorElement>('main a[href]'))) {
    if (isOurs(a)) continue;
    const href = (a.getAttribute('href') ?? '').toLowerCase().split(/[?#]/)[0];
    if (href === want) return a;
  }
  return null;
}

/** Instagram's loading spinner (more grid rows on the way). */
export function pageIsLoading(): boolean {
  return document.querySelector('main [aria-label="Loading..."], main [role="progressbar"]') != null;
}

/** The profile header (avatar, counts, bio). */
export function profileHeader(): Element | null {
  return document.querySelector('main header');
}

/** Make `el` a containing block for an absolutely positioned child. */
export function ensurePositioned(el: HTMLElement): void {
  if (getComputedStyle(el).position === 'static') {
    el.style.position = 'relative';
    el.setAttribute('data-rs-pos', '');
  }
}

export function restorePositioned(el: HTMLElement): void {
  if (el.hasAttribute('data-rs-pos')) {
    el.style.position = '';
    el.removeAttribute('data-rs-pos');
  }
}
