// Passive capture of Instagram's own API responses. Pure functions only (no
// DOM, no extension APIs): the page hook (lib/pageHook.ts) runs them in the
// page's world, the content script runs the message validation, and
// lib/igCapture.test.ts covers both.
//
// Instagram ships media in two shapes, and both show up nested anywhere in a
// response (GraphQL connections, v1 feeds, SSR "RelayPrefetchedStreamCache"
// blobs), so the extractor walks the whole JSON tree:
//
//   v1     { code, pk, taken_at, media_type, product_type, play_count,
//            like_count, comment_count, user: { username, pk }, ... }
//   graph  { shortcode, id, taken_at_timestamp, is_video, video_view_count,
//            edge_media_preview_like: { count }, owner: { username, id } }
//
// Graph items are normalised to v1 field names (keeping the originals), so
// everything downstream reads one shape.

export const CHANNEL = '__reelscope_capture_v1__';

const CODE_RE = /^[A-Za-z0-9_-]{5,64}$/;
const USERNAME_RE = /^[A-Za-z0-9._]{1,30}$/;
const COUNT_KEYS = ['play_count', 'ig_play_count', 'view_count', 'like_count', 'comment_count'] as const;
/** Not reels, even when they carry a code (stories, highlights, ads). */
const SKIP_PRODUCT = new Set(['story', 'ad']);

const MAX_NODES = 250_000;
const MAX_DEPTH = 80;
const MAX_MEDIA = 600;
const MAX_USERS = 400;

export type Media = Record<string, unknown> & { code: string };

export interface CapturedUser {
  username: string;
  id?: string;
  fullName?: string;
  followers?: number;
  isVerified?: boolean;
}

export interface Extracted {
  media: Media[];
  users: CapturedUser[];
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => v !== null && typeof v === 'object' && !Array.isArray(v);
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const idStr = (v: unknown): string | undefined =>
  typeof v === 'string' && /^\d+(_\d+)?$/.test(v) ? v : typeof v === 'number' && Number.isFinite(v) ? String(v) : undefined;

function isV1Media(o: Obj): boolean {
  if (typeof o.code !== 'string' || !CODE_RE.test(o.code)) return false;
  if (typeof o.product_type === 'string' && SKIP_PRODUCT.has(o.product_type)) return false;
  const hasTime = num(o.taken_at) !== undefined;
  const hasCount = COUNT_KEYS.some((k) => num(o[k]) !== undefined);
  const hasKind = o.media_type !== undefined || typeof o.product_type === 'string' || o.pk !== undefined;
  return (hasTime || hasCount) && hasKind;
}

function isGraphMedia(o: Obj): boolean {
  if (typeof o.shortcode !== 'string' || !CODE_RE.test(o.shortcode)) return false;
  return (
    num(o.taken_at_timestamp) !== undefined ||
    num(o.video_view_count) !== undefined ||
    isObj(o.edge_media_preview_like) ||
    isObj(o.edge_liked_by)
  );
}

const edgeCount = (o: Obj, key: string): number | undefined => (isObj(o[key]) ? num((o[key] as Obj).count) : undefined);

/** A legacy GraphQL media node in v1 field names (originals kept alongside). */
export function normalizeGraphMedia(o: Obj): Media {
  const owner = isObj(o.owner) ? o.owner : undefined;
  const capEdges = isObj(o.edge_media_to_caption) ? (o.edge_media_to_caption as Obj).edges : undefined;
  const capText =
    Array.isArray(capEdges) && isObj(capEdges[0]) && isObj((capEdges[0] as Obj).node)
      ? ((capEdges[0] as Obj).node as Obj).text
      : undefined;
  const dims = isObj(o.dimensions) ? o.dimensions : undefined;
  const out: Obj = {
    ...o,
    code: o.shortcode as string,
    pk: o.id,
    taken_at: num(o.taken_at_timestamp),
    media_type: o.is_video === true ? 2 : o.__typename === 'GraphSidecar' ? 8 : 1,
    product_type: typeof o.product_type === 'string' ? o.product_type : undefined,
    play_count: num(o.video_play_count),
    view_count: num(o.video_view_count),
    like_count: edgeCount(o, 'edge_media_preview_like') ?? edgeCount(o, 'edge_liked_by'),
    comment_count: edgeCount(o, 'edge_media_to_comment') ?? edgeCount(o, 'edge_media_to_parent_comment'),
    caption: typeof capText === 'string' ? { text: capText } : undefined,
    video_duration: num(o.video_duration),
    user: owner ? { username: owner.username, pk: owner.id, full_name: owner.full_name } : undefined,
    image_versions2:
      typeof o.display_url === 'string'
        ? { candidates: [{ url: o.display_url, width: dims ? num(dims.width) : undefined }] }
        : undefined,
    video_versions:
      typeof o.video_url === 'string' ? [{ url: o.video_url, width: dims ? num(dims.width) : undefined }] : undefined,
  };
  for (const k of Object.keys(out)) if (out[k] === undefined) delete out[k];
  return out as Media;
}

function asUser(o: Obj): CapturedUser | null {
  if (typeof o.username !== 'string' || !USERNAME_RE.test(o.username)) return null;
  const id = idStr(o.pk) ?? idStr(o.pk_id) ?? idStr(o.id);
  const followers = num(o.follower_count) ?? edgeCount(o, 'edge_followed_by');
  // A bare {username} (mentions, facepiles) carries nothing worth keeping.
  if (id === undefined && followers === undefined) return null;
  const u: CapturedUser = { username: o.username };
  if (id !== undefined) u.id = id;
  if (typeof o.full_name === 'string' && o.full_name) u.fullName = o.full_name;
  if (followers !== undefined) u.followers = followers;
  if (typeof o.is_verified === 'boolean') u.isVerified = o.is_verified;
  return u;
}

/** Every media item and user object anywhere in a parsed response. */
export function extractCaptures(root: unknown): Extracted {
  const media: Media[] = [];
  const users: CapturedUser[] = [];
  const stack: Array<[unknown, number]> = [[root, 0]];
  let nodes = 0;
  while (stack.length > 0) {
    const [v, depth] = stack.pop()!;
    if (++nodes > MAX_NODES) break;
    if (v === null || typeof v !== 'object' || depth > MAX_DEPTH) continue;
    if (Array.isArray(v)) {
      for (let i = v.length - 1; i >= 0; i--) stack.push([v[i], depth + 1]);
      continue;
    }
    const o = v as Obj;
    if (media.length < MAX_MEDIA) {
      if (isV1Media(o)) media.push(o as Media);
      else if (isGraphMedia(o)) media.push(normalizeGraphMedia(o));
    }
    if (users.length < MAX_USERS) {
      const u = asUser(o);
      if (u) users.push(u);
    }
    const keys = Object.keys(o);
    for (let i = keys.length - 1; i >= 0; i--) {
      const child = o[keys[i]!];
      if (child !== null && typeof child === 'object') stack.push([child, depth + 1]);
    }
  }
  return { media, users };
}

/**
 * Parse a response body. Handles Instagram's `for (;;);` guard prefix and
 * streamed (@defer / @stream) GraphQL responses, which are several JSON
 * documents separated by newlines. Returns [] when nothing parses.
 */
export function parseResponseText(text: string): unknown[] {
  let t = text.trimStart();
  if (t.startsWith('for (;;);')) t = t.slice('for (;;);'.length);
  if (!t.startsWith('{') && !t.startsWith('[')) return [];
  try {
    return [JSON.parse(t)];
  } catch {
    const out: unknown[] = [];
    for (const line of t.split(/\r?\n/)) {
      const l = line.trim();
      if (!l.startsWith('{')) continue;
      try {
        out.push(JSON.parse(l));
      } catch {
        // partial chunk: skip
      }
    }
    return out;
  }
}

/** Cheap pre-check before parsing an SSR JSON blob (they can be large). */
export function mayHoldCaptures(text: string): boolean {
  return (
    text.includes('"taken_at') ||
    text.includes('"follower_count"') ||
    text.includes('"edge_followed_by"') ||
    text.includes('"play_count"')
  );
}

/** Responses worth reading: Instagram's GraphQL and the v1 media/user feeds. */
export function isCaptureUrl(url: string, pageOrigin: string): boolean {
  let u: URL;
  try {
    u = new URL(url, pageOrigin);
  } catch {
    return false;
  }
  if (u.origin !== pageOrigin && !/(^|\.)instagram\.com$/.test(u.hostname)) return false;
  return /^\/(?:graphql\/query|api\/graphql)\/?$/.test(u.pathname) ||
    /^\/api\/v1\/(?:feed|clips|media|users|discover)\//.test(u.pathname);
}

// ---- page <-> content-script messages ----------------------------------------
// Messages are strings (CHANNEL + JSON): primitives cross Firefox's
// compartment boundary without Xray wrappers, and anything else on the page
// that uses postMessage can't be mistaken for ours.

export type PageMessage =
  | { kind: 'capture'; media: Media[]; users: CapturedUser[] }
  | { kind: 'replay' };

export function encodeMessage(m: PageMessage): string {
  return CHANNEL + JSON.stringify(m);
}

/** Validates everything: the page (or another extension) can post anything. */
export function decodeMessage(data: unknown): PageMessage | null {
  if (typeof data !== 'string' || !data.startsWith(CHANNEL)) return null;
  let m: unknown;
  try {
    m = JSON.parse(data.slice(CHANNEL.length));
  } catch {
    return null;
  }
  if (!isObj(m)) return null;
  if (m.kind === 'replay') return { kind: 'replay' };
  if (m.kind !== 'capture' || !Array.isArray(m.media) || !Array.isArray(m.users)) return null;
  const media = m.media
    .slice(0, MAX_MEDIA * 4)
    .filter((x): x is Media => isObj(x) && typeof x.code === 'string' && CODE_RE.test(x.code));
  const users = m.users.slice(0, MAX_USERS * 4).flatMap((x) => {
    if (!isObj(x) || typeof x.username !== 'string' || !USERNAME_RE.test(x.username)) return [];
    const u: CapturedUser = { username: x.username };
    if (typeof x.id === 'string' && /^\d+(_\d+)?$/.test(x.id)) u.id = x.id;
    if (typeof x.fullName === 'string') u.fullName = x.fullName;
    if (num(x.followers) !== undefined && (x.followers as number) >= 0) u.followers = x.followers as number;
    if (typeof x.isVerified === 'boolean') u.isVerified = x.isVerified;
    return [u];
  });
  return { kind: 'capture', media, users };
}
