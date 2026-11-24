// What Instagram's page has loaded this session: media items by shortcode and
// user objects by username, fed by the page hook (lib/pageHook.ts). Shared by
// saves and profile scans. Pure (no DOM), unit tested in
// lib/captureStore.test.ts.
import type { CapturedUser, Media } from './igCapture';
import { itemUploadTime, str, uploadTimeFromShortcode } from './instagram';
import { mapMediaItem } from './profile';
import type { ProfileReel } from './types';

const COUNT_KEYS = new Set(['play_count', 'ig_play_count', 'view_count', 'like_count', 'comment_count', 'reshare_count', 'share_count']);
const MAX_MEDIA = 2000;
const MAX_USERS = 1500;

export interface MediaEntry {
  item: Media;
  /** ms epoch when the page last loaded this item. */
  seenAt: number;
  /** Order of first sighting (the page loads newest first). */
  seq: number;
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => v !== null && typeof v === 'object' && !Array.isArray(v);

/**
 * Newest sighting wins, except: counts keep their maximum (they only grow,
 * and some shapes omit them), null/missing fields never erase known ones,
 * and `user` is merged field by field (some shapes carry only its pk).
 */
export function mergeMedia(old: Media, next: Media): Media {
  const out: Obj = { ...old };
  for (const [k, v] of Object.entries(next)) {
    if (v === null || v === undefined) continue;
    const prev = out[k];
    if (COUNT_KEYS.has(k) && typeof v === 'number' && typeof prev === 'number') out[k] = Math.max(prev, v);
    else if (k === 'user' && isObj(v) && isObj(prev)) out[k] = mergeUserObj(prev, v);
    else out[k] = v;
  }
  return out as Media;
}

function mergeUserObj(a: Obj, b: Obj): Obj {
  const out: Obj = { ...a };
  for (const [k, v] of Object.entries(b)) if (v !== null && v !== undefined) out[k] = v;
  return out;
}

function mergeUser(a: CapturedUser, b: CapturedUser): CapturedUser {
  return {
    username: b.username,
    id: b.id ?? a.id,
    fullName: b.fullName ?? a.fullName,
    followers: b.followers ?? a.followers,
    isVerified: b.isVerified ?? a.isVerified,
  };
}

export function itemUsername(item: Media): string | undefined {
  const u = item.user ?? item.owner;
  return isObj(u) ? str(u.username) : undefined;
}

export function itemUserId(item: Media): string | undefined {
  const u = item.user ?? item.owner;
  if (!isObj(u)) return undefined;
  const id = u.pk ?? u.pk_id ?? u.id;
  return typeof id === 'string' ? id : typeof id === 'number' ? String(id) : undefined;
}

export class CaptureStore {
  private media = new Map<string, MediaEntry>();
  private users = new Map<string, CapturedUser>();
  private usersById = new Map<string, string>();
  private nextSeq = 0;
  /** Bumps on every ingest (cheap change detection for polling). */
  version = 0;

  constructor(private now: () => number = Date.now) {}

  ingest(media: readonly Media[], users: readonly CapturedUser[]): void {
    const t = this.now();
    for (const m of media) {
      const cur = this.media.get(m.code);
      if (cur) {
        this.media.delete(m.code); // re-insert: Map order doubles as LRU
        this.media.set(m.code, { item: mergeMedia(cur.item, m), seenAt: t, seq: cur.seq });
      } else {
        this.media.set(m.code, { item: m, seenAt: t, seq: this.nextSeq++ });
      }
      // Media items often carry their author; keep it as a user too.
      const name = itemUsername(m);
      const id = itemUserId(m);
      if (name && id) this.addUser({ username: name, id });
    }
    for (const u of users) this.addUser(u);
    while (this.media.size > MAX_MEDIA) this.media.delete(this.media.keys().next().value!);
    while (this.users.size > MAX_USERS) this.users.delete(this.users.keys().next().value!);
    this.version++;
  }

  private addUser(u: CapturedUser) {
    const key = u.username.toLowerCase();
    const cur = this.users.get(key);
    const merged = cur ? mergeUser(cur, u) : u;
    this.users.set(key, merged);
    if (merged.id) this.usersById.set(merged.id, merged.username);
  }

  get(code: string): MediaEntry | undefined {
    return this.media.get(code);
  }

  user(username: string): CapturedUser | undefined {
    return this.users.get(username.toLowerCase());
  }

  usernameForId(id: string): string | undefined {
    return this.usersById.get(id);
  }

  /** Username of an item's author, also when the item only carries the author's pk. */
  authorOf(item: Media): string | undefined {
    const name = itemUsername(item);
    if (name) return name;
    const id = itemUserId(item);
    return id ? this.usernameForId(id) : undefined;
  }

  /**
   * Items by this creator: authored by them (by name or id), or shown on
   * their grid (`gridCodes`: collabs and items whose author field is bare).
   */
  mediaFor(username: string, gridCodes: ReadonlySet<string> = new Set()): MediaEntry[] {
    const lower = username.toLowerCase();
    const id = this.user(username)?.id;
    const out: MediaEntry[] = [];
    for (const e of this.media.values()) {
      if (gridCodes.has(e.item.code)) {
        out.push(e);
        continue;
      }
      const name = itemUsername(e.item);
      if (name ? name.toLowerCase() === lower : id !== undefined && itemUserId(e.item) === id) out.push(e);
    }
    return out.sort((a, b) => a.seq - b.seq);
  }
}

// ---- scan result ------------------------------------------------------------------

export interface GridTile {
  code: string;
  /** Views shown on the tile (reels tab), rounded. */
  views?: number;
  pinned: boolean;
}

export interface BuildOpts {
  /** Captured items for the creator, in first-seen order. */
  entries: readonly MediaEntry[];
  /** Tiles seen on the creator's grid, top to bottom. */
  tiles: readonly GridTile[];
  limit: number;
  now: Date;
}

const HOUR = 3600_000;
const DAY = 24 * HOUR;
/** Newest unpinned tiles treated as under 72h old when no dates exist at all. */
export const FRESH_TILES = 3;

/**
 * ProfileReel[] for a scan, newest (top of the grid) first, at most `limit`.
 * Captured items give exact numbers; tiles without one fall back to the
 * views printed on the tile (`fromGrid`). Upload dates come from taken_at,
 * else from the media id (which encodes it); only reels where neither works
 * get one estimated from their grid position (`dateEstimated`).
 */
export function buildProfileReels(opts: BuildOpts): ProfileReel[] {
  const byCode = new Map(opts.entries.map((e) => [e.item.code, e]));
  const tileBy = new Map(opts.tiles.map((t) => [t.code, t]));
  // Grid order first; captured items never seen as a tile follow in load order.
  const order: string[] = [];
  const seen = new Set<string>();
  for (const t of opts.tiles) if (!seen.has(t.code)) (seen.add(t.code), order.push(t.code));
  for (const e of opts.entries) if (!seen.has(e.item.code)) (seen.add(e.item.code), order.push(e.item.code));

  const out: Array<ProfileReel & { _dated: boolean; _onGrid: boolean }> = [];
  for (const code of order) {
    if (out.length >= opts.limit) break;
    const e = byCode.get(code);
    const tile = tileBy.get(code);
    if (e) {
      const r = mapMediaItem(e.item);
      if (!r) continue; // a photo
      // No taken_at (the reels-tab query omits it): the media id carries the upload time.
      const t = itemUploadTime(e.item, opts.now.getTime());
      const views = r.views > 0 ? r.views : (tile?.views ?? 0);
      out.push({
        ...r,
        takenAt: t !== undefined ? new Date(t).toISOString() : r.takenAt,
        views,
        pinned: r.pinned || !!tile?.pinned,
        raw: e.item,
        _dated: t !== undefined,
        _onGrid: !!tile,
      });
    } else if (tile && tile.views !== undefined) {
      const t = uploadTimeFromShortcode(code, opts.now.getTime());
      out.push({
        shortcode: code,
        url: `https://www.instagram.com/reel/${code}/`,
        takenAt: t !== undefined ? new Date(t).toISOString() : '',
        views: tile.views,
        likes: 0,
        comments: 0,
        pinned: tile.pinned,
        fromGrid: true,
        _dated: t !== undefined,
        _onGrid: true,
      });
    }
  }
  estimateDates(out, opts.now);
  return out.map(({ _dated, _onGrid, ...r }) => r);
}

/**
 * Fill in takenAt for reels without one, in place. `reels` is in grid order
 * (newest first). Dated reels are anchors: a gap between two anchors is
 * spread evenly between their times; reels above the first anchor sit between
 * it and now; reels below the last continue at the typical spacing. With no
 * anchors at all the grid order is all there is: the first FRESH_TILES
 * unpinned reels count as under 72h (kept out of the baseline, as the 72h
 * rule intends) and the rest are spaced a day apart after that. Pinned reels
 * are usually old, so they count as mature. Only reels seen on the grid can
 * be anchors: anything else has no trustworthy position.
 */
export function estimateDates(reels: Array<ProfileReel & { _dated: boolean; _onGrid?: boolean }>, now: Date): void {
  const t0 = now.getTime();
  const anchors = reels
    .map((r, i) => ({ i, t: r._dated ? Date.parse(r.takenAt) : NaN }))
    .filter((a) => Number.isFinite(a.t) && !reels[a.i]!.pinned && reels[a.i]!._onGrid !== false);
  const set = (r: ProfileReel, t: number) => {
    r.takenAt = new Date(t).toISOString();
    r.dateEstimated = true;
  };

  if (anchors.length === 0) {
    let pos = 0;
    let oldest = t0 - 4 * DAY;
    for (const r of reels) {
      if (r.pinned || r._dated) continue;
      // Evenly spaced so exactly FRESH_TILES land under 72h:
      // 12h, 36h, 60h, then 84h, 108h, ... (a day apart with 3).
      const t = t0 - (12 * HOUR + (pos * 72 * HOUR) / FRESH_TILES);
      set(r, t);
      oldest = Math.min(oldest, t);
      pos++;
    }
    for (const r of reels) if (r.pinned && !r._dated) set(r, oldest - DAY);
    return;
  }

  const gaps: number[] = [];
  for (let k = 1; k < anchors.length; k++) {
    const a = anchors[k - 1]!;
    const b = anchors[k]!;
    if (b.i > a.i && a.t >= b.t) gaps.push((a.t - b.t) / (b.i - a.i));
  }
  gaps.sort((x, y) => x - y);
  const step = gaps.length > 0 ? gaps[Math.floor(gaps.length / 2)]! : DAY;

  const first = anchors[0]!;
  const last = anchors[anchors.length - 1]!;
  for (let i = 0; i < reels.length; i++) {
    const r = reels[i]!;
    if (r._dated) continue;
    if (r.pinned) {
      set(r, Math.min(last.t, t0 - 4 * DAY) - DAY);
      continue;
    }
    if (i < first.i) {
      // Between now and the first dated reel.
      set(r, t0 - ((t0 - first.t) * (i + 1)) / (first.i + 1));
    } else if (i > last.i) {
      set(r, last.t - step * (i - last.i));
    } else {
      let k = 0;
      while (anchors[k + 1] && anchors[k + 1]!.i < i) k++;
      const a = anchors[k]!;
      const b = anchors[k + 1]!;
      // Out-of-order anchors (pinned / collabs): don't invent a range.
      const t = a.t >= b.t ? a.t - ((a.t - b.t) * (i - a.i)) / (b.i - a.i) : a.t;
      set(r, t);
    }
  }
}
