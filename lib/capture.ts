// Saves reels via the background worker. The in-page UI decides *which*
// reel (each post gets its own button, see entrypoints/content/dom.ts);
// this module builds the payload and hands it over.
//
// Payload sources, in order: the item Instagram's page already loaded
// (capture store, no request at all), then /media/info (our own request,
// rate-limited by Instagram), then the page's meta tags (only on the reel's
// own page).
import type { CaptureStore } from './captureStore';
import { pageCode } from './igdom';
import { domFallbackPayload, fetchMediaInfoItem, fetchReelFromApi, followersFromDom, knownFollowers, payloadFromMediaItem, rememberFollowers } from './instagram';
import { usernameFromPath } from './profile';
import type { ChannelContext, SavePayload, SaveResult } from './types';

/** Payload from the capture store, or null when the page never loaded this reel. */
export function capturedPayload(store: CaptureStore, shortcode: string): SavePayload | null {
  const entry = store.get(shortcode);
  if (!entry) return null;
  const username = store.authorOf(entry.item);
  if (!username) return null;
  // The header count belongs to whichever profile is open; only trust it for its owner.
  const onTheirProfile = usernameFromPath(location.pathname)?.toLowerCase() === username.toLowerCase();
  const followers =
    store.user(username)?.followers ?? knownFollowers(username) ?? (onTheirProfile ? followersFromDom(username) : undefined);
  rememberFollowers(username, followers);
  return payloadFromMediaItem(entry.item, {
    shortcode,
    username,
    followers,
    capturedAt: new Date(entry.seenAt).toISOString(),
  });
}

const hasStats = (p: SavePayload) => Object.values(p.stats).some((v) => typeof v === 'number');

// ---- /media/info fallback, rate-limited ---------------------------------------
// Every fallback call in the tab goes through one gate: at least gapMs
// (+ jitter) apart however many saves ask at once (bulk save), and none at
// all for cooldownMs after Instagram answers 429.

export const API_LIMITED = 'instagram-rate-limited';

export interface GateOpts {
  gapMs: number;
  jitterMs: number;
  cooldownMs: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  rand?: () => number;
}

export function createRequestGate(o: GateOpts) {
  const now = o.now ?? Date.now;
  const sleep = o.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const rand = o.rand ?? Math.random;
  let nextAt = 0;
  let coolUntil = 0;
  return {
    async run<T>(fn: () => Promise<T>): Promise<T> {
      const t = now();
      if (t < coolUntil) throw new Error(API_LIMITED);
      const at = Math.max(t, nextAt);
      nextAt = at + o.gapMs + rand() * o.jitterMs;
      if (at > t) await sleep(at - t);
      if (now() < coolUntil) throw new Error(API_LIMITED);
      try {
        return await fn();
      } catch (e) {
        if (e instanceof Error && /\b429\b/.test(e.message)) {
          coolUntil = now() + o.cooldownMs;
          throw new Error(API_LIMITED);
        }
        throw e;
      }
    },
  };
}

const apiGate = createRequestGate({ gapMs: 4000, jitterMs: 2000, cooldownMs: 5 * 60_000 });

/**
 * The reel's media item when the page never loaded it (or its signed video
 * URL expired): one /media/info request through the same gate as saves. The
 * item goes into `store`, so a later save of this reel needs no request.
 * Aborting before the gate lets it through skips the request.
 */
export async function loadMediaItem(shortcode: string, store: CaptureStore, signal?: AbortSignal): Promise<Record<string, unknown>> {
  const item = await apiGate.run(() => {
    if (signal?.aborted) throw new Error('aborted');
    return fetchMediaInfoItem(shortcode);
  });
  store.ingest([{ ...item, code: shortcode }], []);
  return item;
}

/** Save one reel by shortcode, optionally attaching channel-baseline context. */
export async function saveReelByShortcode(
  shortcode: string,
  channel?: ChannelContext,
  store?: CaptureStore,
): Promise<SaveResult> {
  // The page's meta tags only describe this reel when we're on its page; on
  // the feed they describe the feed, so don't let the DOM fallback use them.
  const onItsPage = pageCode(location.pathname) === shortcode;
  const captured = store ? capturedPayload(store, shortcode) : null;
  let payload: SavePayload;
  if (captured && hasStats(captured)) {
    payload = captured;
  } else {
    try {
      payload = await apiGate.run(() => fetchReelFromApi(shortcode));
    } catch (e) {
      if (captured) payload = captured;
      else if (onItsPage) payload = domFallbackPayload(shortcode, location.href);
      else return { ok: false, queued: false, error: e instanceof Error ? e.message : String(e) };
    }
  }
  if (channel) payload.channel = channel;
  const res = (await browser.runtime.sendMessage({
    type: 'save',
    payload,
  })) as SaveResult | undefined;
  if (!res || typeof res !== 'object') {
    return { ok: false, queued: false, error: 'no-background-response' };
  }
  return res;
}
