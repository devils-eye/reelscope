// Which site a saved row came from, for the library's and popup's links and
// words. (The content scripts carry their own: entrypoints/content/site.ts.)
import type { Platform } from './types';

/** Anything not marked YouTube is Instagram. */
export const platformOf = (p: unknown): Platform => (p === 'youtube' ? 'youtube' : 'instagram');

export const siteName = (p: unknown) => (platformOf(p) === 'youtube' ? 'YouTube' : 'Instagram');

/** "followers" / "subscribers". */
export const followersWord = (p: unknown) => (platformOf(p) === 'youtube' ? 'subscribers' : 'followers');

export function profileUrl(p: unknown, username: string): string {
  if (platformOf(p) !== 'youtube') return `https://www.instagram.com/${encodeURIComponent(username)}/`;
  return /^UC[\w-]{22}$/.test(username)
    ? `https://www.youtube.com/channel/${username}`
    : `https://www.youtube.com/@${encodeURIComponent(username)}`;
}

/** A YouTube long-form video (a /watch link), as opposed to a reel or a Short. */
export const isLongVideo = (r: { platform?: unknown; url?: unknown }): boolean =>
  platformOf(r.platform) === 'youtube' && typeof r.url === 'string' && !r.url.includes('/shorts/');
