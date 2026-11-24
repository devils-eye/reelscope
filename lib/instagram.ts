// Instagram helpers for the content script: shortcodes, defensive readers,
// item -> SavePayload, and the /media/info fallback for saves the page never
// loaded (same-origin fetch with the user's cookies).
import type { SavePayload } from './types';

const IG_APP_ID = '936619743392459';

const SHORTCODE_ALPHABET =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/** Accept /reel/X/, /reels/X/, /p/X/ (full URL or bare path). */
export function shortcodeFromUrl(url: string): string | null {
  let pathname: string;
  try {
    pathname = url.startsWith('/') && !url.startsWith('//') ? url : new URL(url).pathname;
  } catch {
    return null;
  }
  const m = pathname.match(/^\/(?:reel|reels|p)\/([A-Za-z0-9_-]+)/);
  return m?.[1] ?? null;
}

/** Decode an Instagram shortcode to its numeric media id (decimal string). */
export function shortcodeToMediaId(shortcode: string): string {
  // Private-share links append extra chars after the first 11; only the
  // first 11 encode the media id.
  const code = shortcode.length > 11 ? shortcode.slice(0, 11) : shortcode;
  let id = 0n;
  for (const ch of code) {
    const idx = SHORTCODE_ALPHABET.indexOf(ch);
    if (idx < 0) throw new Error(`invalid shortcode character: ${ch}`);
    id = id * 64n + BigInt(idx);
  }
  return id.toString();
}

/**
 * Instagram media ids carry their creation time: the top 41 bits are
 * milliseconds since Instagram's id epoch (2011-08-24 21:07:01.721 UTC), the
 * rest are shard and sequence ("Sharding & IDs at Instagram", 2012). For
 * reels that time is the upload, within a minute or two of taken_at. Returns
 * ms since 1970, or undefined when the id doesn't decode to a plausible time.
 */
const ID_EPOCH_MS = 1314220021721n;
const PLAUSIBLE_FROM_MS = Date.UTC(2012, 0, 1);

export function uploadTimeFromMediaId(mediaId: string | bigint, now = Date.now()): number | undefined {
  let id: bigint;
  try {
    id = typeof mediaId === 'bigint' ? mediaId : BigInt(String(mediaId).split('_')[0]!);
  } catch {
    return undefined;
  }
  if (id <= 0n) return undefined;
  const ms = Number((id >> 23n) + ID_EPOCH_MS);
  return ms >= PLAUSIBLE_FROM_MS && ms <= now + 86_400_000 ? ms : undefined;
}

export function uploadTimeFromShortcode(shortcode: string, now = Date.now()): number | undefined {
  try {
    return uploadTimeFromMediaId(shortcodeToMediaId(shortcode), now);
  } catch {
    return undefined;
  }
}

/** Upload time of a media item: taken_at when present, else decoded from its pk or code. */
export function itemUploadTime(item: Record<string, unknown>, now = Date.now()): number | undefined {
  const t = num(item.taken_at);
  if (t !== undefined) return t * 1000;
  const pk = item.pk;
  const fromPk = typeof pk === 'string' || typeof pk === 'number' ? uploadTimeFromMediaId(String(pk), now) : undefined;
  return fromPk ?? (typeof item.code === 'string' ? uploadTimeFromShortcode(item.code, now) : undefined);
}

/** Inverse of shortcodeToMediaId (for tests / debugging). */
export function mediaIdToShortcode(mediaId: string | bigint): string {
  let n = typeof mediaId === 'bigint' ? mediaId : BigInt(mediaId);
  if (n < 0n) throw new Error('media id must be non-negative');
  const zero = SHORTCODE_ALPHABET[0];
  if (zero === undefined) throw new Error('unreachable');
  if (n === 0n) return zero;
  let out = '';
  while (n > 0n) {
    const ch = SHORTCODE_ALPHABET[Number(n % 64n)];
    if (ch === undefined) throw new Error('unreachable');
    out = ch + out;
    n /= 64n;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Defensive readers (field names drift)
// ---------------------------------------------------------------------------

export function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

export function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

export function getPath(obj: unknown, path: readonly string[]): unknown {
  let cur = obj;
  for (const key of path) {
    if (cur === null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[key];
  }
  return cur;
}

function getCsrfToken(): string {
  const m = document.cookie.match(/(?:^|;\s*)csrftoken=([^;]*)/);
  return m?.[1] ? decodeURIComponent(m[1]) : '';
}

/** The claim Instagram's web app keeps in sessionStorage and echoes on API calls. */
function getWwwClaim(): string {
  try {
    return sessionStorage.getItem('www-claim-v2') || '0';
  } catch {
    return '0';
  }
}

/** Headers Instagram's own web app sends; requests without them get 429'd sooner. */
export function apiHeaders(): HeadersInit {
  return {
    'x-ig-app-id': IG_APP_ID,
    'x-asbd-id': '129477',
    'x-ig-www-claim': getWwwClaim(),
    'x-requested-with': 'XMLHttpRequest',
    'x-csrftoken': getCsrfToken(),
  };
}

/** "131K", "1.2M", "4,512" → number. */
export function parseCount(text: string): number | undefined {
  const m = text.trim().match(/^([\d.,]+)\s*([KMB])?$/i);
  if (!m?.[1]) return undefined;
  const suffix = m[2]?.toUpperCase();
  const base = suffix ? Number(m[1].replace(/,/g, '')) : Number(m[1].replace(/[.,]/g, ''));
  if (!Number.isFinite(base)) return undefined;
  const mult = suffix === 'K' ? 1e3 : suffix === 'M' ? 1e6 : suffix === 'B' ? 1e9 : 1;
  return Math.round(base * mult);
}

/**
 * Follower count shown in the profile header, when the page is that profile.
 * The exact figure sits in a title attribute; the visible text is abbreviated.
 */
export function followersFromDom(username: string): number | undefined {
  const header = document.querySelector('main header');
  if (!header) return undefined;
  const link = header.querySelector<HTMLElement>(
    `a[href="/${CSS.escape(username)}/followers/"], a[href$="/followers/"]`,
  );
  const titled = link?.querySelector<HTMLElement>('[title]')?.getAttribute('title');
  if (titled) {
    const n = parseCount(titled);
    if (n !== undefined) return n;
  }
  const m = (header.textContent ?? '').match(/([\d.,]+\s*[KMB]?)\s*followers/i);
  return m?.[1] ? parseCount(m[1]) : undefined;
}

/** Follower counts already looked up this page session, so saves don't re-ask. */
const followerCache = new Map<string, number>();

export function rememberFollowers(username: string, n: number | undefined): void {
  if (n !== undefined) followerCache.set(username.toLowerCase(), n);
}

export function knownFollowers(username: string): number | undefined {
  return followerCache.get(username.toLowerCase());
}

type FirefoxGlobals = {
  content?: { fetch?: typeof fetch };
  cloneInto?: <T>(obj: T, target: unknown) => T;
};

/**
 * fetch() against instagram.com that behaves like the page's own request.
 * Firefox content scripts get an extension-privileged fetch that resolves
 * relative URLs oddly and omits the page's Origin/Referer, which Instagram
 * rejects; `content.fetch` is the page's fetch. Chrome's content-script fetch
 * already acts like the page. The AbortSignal can't cross into the page
 * compartment, so it is only checked before and after.
 */
export async function igFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const url = new URL(path, location.origin).href;
  const { signal, ...rest } = init;
  const { content, cloneInto } = globalThis as unknown as FirefoxGlobals;
  if (content?.fetch && cloneInto) {
    signal?.throwIfAborted();
    const page = await content.fetch(url, cloneInto(rest, window));
    const body = await page.text();
    signal?.throwIfAborted();
    return new Response(body, { status: page.status, statusText: page.statusText });
  }
  return fetch(url, init);
}

/**
 * SavePayload from one v1-shaped media item (captured from the page or read
 * from /media/info). `raw` is the item itself, kept with the save and used for
 * the server's thumbnail/video cache.
 */
export function payloadFromMediaItem(
  item: Record<string, unknown>,
  opts: { shortcode: string; username?: string; followers?: number; capturedAt?: string },
): SavePayload {
  const code = str(item.code) ?? opts.shortcode;
  const user = (item.user ?? {}) as Record<string, unknown>;
  const username = str(user.username) ?? opts.username ?? 'unknown';
  const caption = str(getPath(item, ['caption', 'text']));
  const uploadMs = itemUploadTime(item);
  const audioTitle =
    str(getPath(item, ['clips_metadata', 'music_info', 'music_asset_info', 'title'])) ??
    str(getPath(item, ['clips_metadata', 'original_sound_info', 'original_audio_title'])) ??
    str(getPath(item, ['original_sound_info', 'original_audio_title']));
  const pkRaw = item.pk ?? item.id;
  const mediaId = typeof pkRaw === 'number' ? String(pkRaw) : str(pkRaw);

  return {
    shortcode: code,
    url: `https://www.instagram.com/reel/${code}/`,
    mediaId,
    author: {
      username,
      fullName: str(user.full_name),
      followers: opts.followers,
    },
    caption,
    audioTitle,
    durationSec: num(item.video_duration),
    takenAt: uploadMs !== undefined ? new Date(uploadMs).toISOString() : undefined,
    stats: {
      playCount: num(item.play_count) ?? num(item.ig_play_count),
      viewCount: num(item.view_count),
      likeCount: num(item.like_count),
      commentCount: num(item.comment_count),
      shareCount: num(item.reshare_count) ?? num(item.share_count),
    },
    capturedAt: opts.capturedAt ?? new Date().toISOString(),
    raw: item,
    source: 'api',
  };
}

/** The reel's media item from /media/info (our own request: callers gate it, see lib/capture.ts). */
export async function fetchMediaInfoItem(shortcode: string): Promise<Record<string, unknown>> {
  const mediaId = shortcodeToMediaId(shortcode);
  const res = await igFetch(`/api/v1/media/${mediaId}/info/`, {
    headers: apiHeaders(),
    credentials: 'include',
  });
  if (!res.ok) throw new Error(`media info responded ${res.status}`);
  const body = (await res.json()) as Record<string, unknown>;
  const items = body.items;
  const item = (
    Array.isArray(items) ? (items[0] as unknown) : undefined
  ) as Record<string, unknown> | undefined;
  if (!item || typeof item !== 'object') throw new Error('media info has no items[0]');
  return item;
}

/** Last resort before the DOM: ask /media/info ourselves (rate-limited by Instagram). */
export async function fetchReelFromApi(shortcode: string): Promise<SavePayload> {
  const item = await fetchMediaInfoItem(shortcode);

  const username = str(getPath(item, ['user', 'username'])) ?? 'unknown';
  // Follower failure must not fail the whole save. Cached per creator, since
  // web_profile_info is the endpoint Instagram rate-limits hardest.
  let followers = knownFollowers(username) ?? followersFromDom(username);
  if (followers === undefined) {
    try {
      const fres = await igFetch(
        `/api/v1/users/web_profile_info/?username=${encodeURIComponent(username)}`,
        { headers: apiHeaders(), credentials: 'include' },
      );
      if (fres.ok) {
        const fbody = (await fres.json()) as Record<string, unknown>;
        followers = num(getPath(fbody, ['data', 'user', 'edge_followed_by', 'count']));
      }
    } catch {
      // ignore
    }
  }
  rememberFollowers(username, followers);
  return payloadFromMediaItem(item, { shortcode, followers });
}

function metaContent(property: string): string | undefined {
  const el = document.querySelector(`meta[property="${CSS.escape(property)}"]`);
  const content = el?.getAttribute('content');
  return content && content.length > 0 ? content : undefined;
}

/** Last-resort payload when the private media API is unreachable. Stats may be empty. */
export function domFallbackPayload(shortcode: string, pageUrl: string): SavePayload {
  const description = metaContent('og:description');
  const title = metaContent('og:title');
  // og:title is usually like: '<username> on Instagram: "..."'
  const username = title?.match(/^(.+?) on Instagram/i)?.[1]?.trim() || 'unknown';
  return {
    shortcode,
    url: pageUrl,
    author: { username },
    caption: description,
    stats: {},
    capturedAt: new Date().toISOString(),
    source: 'dom',
  };
}
