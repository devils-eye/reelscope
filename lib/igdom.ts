// URL helpers for the in-page UI. Pure (no DOM, no extension APIs) so the
// dev harness can import them and lib/igdom.test.ts can cover them.

const CODE_RE = /^[A-Za-z0-9_-]{5,64}$/;

/** Path segments after /reels/ that are sub-pages, not shortcodes. */
const NOT_CODES = new Set(['audio', 'comments', 'liked_by', 'tagged', 'embed']);

/**
 * Shortcode from any post/reel link Instagram renders:
 * `/p/X/`, `/reel/X/`, `/reels/X/`, and the profile-grid forms
 * `/<username>/p/X/` and `/<username>/reel/X/`. Absolute URLs and query
 * strings are fine. Returns null for everything else (profiles, `/reels/`
 * on its own, `/reels/audio/…`, comment-permalink pages are handled by
 * taking the post code before them).
 */
export function postCodeFromHref(href: string | null | undefined): string | null {
  if (!href) return null;
  let path: string;
  try {
    path = href.startsWith('/') && !href.startsWith('//') ? href : new URL(href).pathname;
  } catch {
    return null;
  }
  const segs = path.split(/[?#]/)[0]!.split('/').filter(Boolean);
  // Kind is the first segment, or the second when the first is a username.
  for (const i of [0, 1]) {
    const kind = segs[i];
    const code = segs[i + 1];
    if (kind !== 'p' && kind !== 'reel' && kind !== 'reels') continue;
    if (i === 1 && /^(?:p|reel|reels|explore|stories)$/.test(segs[0] ?? '')) continue;
    if (!code || NOT_CODES.has(code) || !CODE_RE.test(code)) return null;
    return code;
  }
  return null;
}

/** Shortcode when the page itself is a post / reel (incl. the /reels/ viewer and modals). */
export function pageCode(pathname: string): string | null {
  return postCodeFromHref(pathname);
}

/** True when the page is a post or reel URL (a modal over a profile counts). */
export function isPostPath(pathname: string): boolean {
  return pageCode(pathname) != null;
}

/**
 * The first count in a grid tile's overlay text ("▶ 1.9M", "41.2K", "1,204"),
 * else undefined. Tiles on the reels tab print the view count; locales that
 * write counts differently ("1,9 Mio.") give undefined, never a wrong number.
 */
export function countFromTileText(text: string): number | undefined {
  for (const m of text.matchAll(/(?:^|[^\w.,])(\d[\d.,]*\s*[KMB]?)(?![\w])/gi)) {
    const raw = m[1]!.trim();
    const suffix = /[KMB]$/i.test(raw);
    const digits = suffix ? raw.slice(0, -1).trim() : raw;
    // "1.9" + suffix, or an integer with thousands separators ("1,204").
    if (suffix ? !/^\d+(?:\.\d+)?$/.test(digits) : !/^\d{1,3}(?:,\d{3})*$|^\d+$/.test(digits)) continue;
    const base = Number(digits.replace(/,/g, ''));
    if (!Number.isFinite(base)) continue;
    const mult = !suffix ? 1 : /k$/i.test(raw) ? 1e3 : /m$/i.test(raw) ? 1e6 : 1e9;
    return Math.round(base * mult);
  }
  return undefined;
}
