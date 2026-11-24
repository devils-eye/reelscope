// Instagram's side of the stats card (PanelDeps.postStats): the media item the
// page already loaded, read through the same capture store saves use. Only
// when the page never loaded the reel, or loaded it without its views, does
// it ask /media/info once, through the rate-limited gate in lib/capture.ts.
// Shared by the real deps (deps.ts) and the dev harness.
import { capturedPayload } from '@/lib/capture';
import type { CaptureStore } from '@/lib/captureStore';
import { detailsFromIgItem } from '@/lib/metrics';
import type { PostStatsResult } from './panel-deps';
import { saveErrorText } from './saves';

export async function igPostStats(
  code: string,
  store: CaptureStore,
  load: (code: string, signal?: AbortSignal) => Promise<unknown>,
  signal?: AbortSignal,
): Promise<PostStatsResult> {
  const read = () => {
    const entry = store.get(code);
    if (!entry) return null;
    // Same author and follower lookup as a save (capture store, header, cache).
    const p = capturedPayload(store, code);
    const details = detailsFromIgItem(entry.item, { followers: p?.author.followers, username: p?.author.username });
    return { details, at: entry.seenAt };
  };
  const seen = read();
  if (seen && seen.details.post.views != null) return { ok: true, ...seen, source: 'page' };
  try {
    await load(code, signal);
  } catch (e) {
    // Better what the page had than nothing.
    if (seen) return { ok: true, ...seen, source: 'page' };
    return { ok: false, reason: 'retry', error: saveErrorText(e instanceof Error ? e.message : String(e)) };
  }
  const fresh = read();
  return fresh
    ? { ok: true, ...fresh, source: 'instagram' }
    : { ok: false, reason: 'retry', error: "Couldn't read this reel from Instagram" };
}
