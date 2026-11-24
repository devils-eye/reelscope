// Profile helpers: which page is a profile, and media item -> ProfileReel.
// The reels themselves come from what Instagram's page loads (see
// lib/igCapture.ts and entrypoints/content/reelScan.ts), never from our own
// API calls.
import { getPath, num, str } from './instagram';
import type { ProfileReel } from './types';

/** First path segment that can never be a username. Compared lowercase. */
const RESERVED = new Set([
  'about',
  'accounts',
  'api',
  'ar',
  'business',
  'challenge',
  'checkout',
  'contact',
  'cookies',
  'creator',
  'developer',
  'direct',
  'directory',
  'emails',
  'explore',
  'hashtags',
  'help',
  'i',
  'jobs',
  'legal',
  'live',
  'locations',
  'login',
  'logout',
  'messages',
  'music',
  'n',
  'notifications',
  'oauth',
  'p',
  'press',
  'privacy',
  'qr',
  'qrcode',
  'reel',
  'reels',
  's',
  'sessions',
  'settings',
  'sharedaccounts',
  'shop',
  'static',
  'staticfiles',
  'stories',
  'terms',
  'trusted',
  'tv',
  'v',
  'web',
  'x',
]);

/**
 * Username when the path is a profile (`/<username>/`) or its reels tab
 * (`/<username>/reels/`), else null. Reserved top-level paths (explore,
 * reels, p, direct, accounts, stories, ...) return null.
 */
export function usernameFromPath(pathname: string): string | null {
  const segs = pathname.split('/').filter(Boolean);
  if (segs.length !== 1 && !(segs.length === 2 && segs[1] === 'reels')) return null;
  const name = segs[0];
  if (!name || !/^[A-Za-z0-9._]{1,30}$/.test(name)) return null;
  if (RESERVED.has(name.toLowerCase())) return null;
  return name;
}

/**
 * Playable video URL of a media item: the widest version up to 720px (what
 * the lightbox shows), else the narrowest available.
 */
export function pickVideoUrl(item: Record<string, unknown> | undefined): string | undefined {
  const vv = item?.video_versions;
  if (!Array.isArray(vv)) return undefined;
  let best: { url: string; w: number } | undefined;
  let smallest: { url: string; w: number } | undefined;
  for (const v of vv) {
    if (!v || typeof v !== 'object') continue;
    const url = (v as Record<string, unknown>).url;
    if (typeof url !== 'string' || !url) continue;
    const w = num((v as Record<string, unknown>).width) ?? 0;
    if (w <= 720 && (!best || w > best.w)) best = { url, w };
    if (!smallest || w < smallest.w) smallest = { url, w };
  }
  return (best ?? smallest)?.url;
}

export function pickThumbUrl(item: Record<string, unknown>): string | undefined {
  const iv2 = item.image_versions2;
  if (iv2 && typeof iv2 === 'object') {
    const cands = (iv2 as Record<string, unknown>).candidates;
    if (Array.isArray(cands)) {
      let best: string | undefined;
      let bestDiff = Infinity;
      for (const c of cands) {
        if (!c || typeof c !== 'object') continue;
        const u = (c as Record<string, unknown>).url;
        if (typeof u !== 'string' || u.length === 0) continue;
        if (best === undefined) best = u;
        const w = (c as Record<string, unknown>).width;
        if (typeof w === 'number' && Number.isFinite(w)) {
          const d = Math.abs(w - 640);
          if (d < bestDiff) {
            bestDiff = d;
            best = u;
          }
        }
      }
      if (best !== undefined) return best;
    }
  }
  return str(item.thumbnail_url) ?? str(item.display_uri);
}

/**
 * Map one captured media item (v1 shape, see lib/igCapture.ts) to a
 * ProfileReel, or null when it is not a video.
 */
export function mapMediaItem(raw: unknown): ProfileReel | null {
  if (!raw || typeof raw !== 'object') return null;
  const item = raw as Record<string, unknown>;
  // Keep only videos (media_type 2) / clips.
  if (item.media_type !== 2 && item.product_type !== 'clips') return null;

  const code = str(item.code);
  if (!code) return null;
  const pkRaw = item.pk ?? item.id;
  const mediaId = typeof pkRaw === 'number' ? String(pkRaw) : str(pkRaw);

  const takenAtSec = num(item.taken_at);
  const views = num(item.play_count) ?? num(item.ig_play_count) ?? num(item.view_count) ?? 0;

  const pinned =
    (Array.isArray(item.clips_tab_pinned_user_ids) &&
      (item.clips_tab_pinned_user_ids as unknown[]).length > 0) ||
    (Array.isArray(item.timeline_pinned_user_ids) &&
      (item.timeline_pinned_user_ids as unknown[]).length > 0);

  return {
    shortcode: code,
    mediaId,
    url: `https://www.instagram.com/reel/${code}/`,
    // Missing taken_at is treated as "now" (fresh), which keeps the reel
    // out of the baseline rather than polluting it.
    takenAt:
      takenAtSec !== undefined ? new Date(takenAtSec * 1000).toISOString() : new Date().toISOString(),
    views,
    likes: num(item.like_count) ?? 0,
    comments: num(item.comment_count) ?? 0,
    shares: num(item.reshare_count) ?? num(item.share_count),
    durationSec: num(item.video_duration),
    caption: str(getPath(item, ['caption', 'text'])),
    thumbnailUrl: pickThumbUrl(item),
    pinned,
    raw: item,
  };
}
