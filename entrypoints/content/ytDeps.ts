// The YouTube side effects behind the shared UI (panel-deps.ts). Unlike on
// Instagram, nothing is read off the page: a save names the video and the
// library server asks YouTube for the rest, and a channel scan runs on the
// server (lib/ytdlp.ts) while this polls it. Every request is the server's,
// signed out, so the viewer's YouTube account is never involved.
import { detailsFromYtInfo } from '@/lib/metrics';
import type { ProfileScanDetail, SavePayload, SaveResult, YtInfoResult, YtScanState } from '@/lib/types';
import { loadPanelFont, send, serverUp } from './ext';
import type { PanelDeps } from './panel-deps';
import type { ScanOutcome } from './reelScan';

const POLL_MS = 700;

const OFFLINE = 'The library server is offline. Start it with bun run server.';
const offline = (error: string | undefined) => (!error || error.startsWith('network:') ? OFFLINE : error);

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export const ytDeps: PanelDeps = {
  async scanProfile(username, opts) {
    opts.onProgress?.({ stage: 'opening', count: 0 });
    const limit = opts.limit === Infinity ? null : opts.limit;
    const start = await send<{ id: string }>({
      type: 'ytScanStart',
      channel: username,
      limit,
      since: opts.since ?? null,
      format: opts.format ?? 'short',
    });
    if (!start?.ok) throw new Error(offline(start?.error));
    let stopped = false;
    for (;;) {
      if (opts.signal.aborted && !stopped) {
        stopped = true;
        void send({ type: 'ytScanStop', id: start.id });
      }
      await wait(POLL_MS);
      const r = await send<{ data: YtScanState }>({ type: 'ytScanGet', id: start.id });
      if (!r?.ok) throw new Error(offline(r?.error));
      const st = r.data;
      if (st.stage === 'failed') throw new Error(st.error ?? 'YouTube scan failed');
      if (st.stage === 'done' && st.result) {
        const { profile, reels, ended } = st.result;
        return { profile, reels, ended } satisfies ScanOutcome;
      }
      if (st.stage !== 'done') opts.onProgress?.({ stage: st.stage, count: st.count });
    }
  },
  async previousScan(username, format = 'short') {
    const r = await send<{ data: ProfileScanDetail | null }>({ type: 'profileGet', username, platform: 'youtube', format });
    return r?.ok ? r.data : null;
  },
  async postScan(profile, analysis, format = 'short') {
    const r = await send<{ id: number }>({ type: 'profileScan', profile: { ...profile, platform: 'youtube' }, analysis, format });
    return !!r?.ok;
  },
  async savedShortcodes(shortcodes) {
    const r = await send<{ saved: string[] }>({ type: 'savedShortcodes', shortcodes });
    return r?.ok ? r.saved : [];
  },
  async saveReel(shortcode, channel) {
    const payload: SavePayload = {
      platform: 'youtube',
      shortcode,
      url: `https://www.youtube.com/watch?v=${shortcode}`,
      author: { username: '' },
      stats: {},
      capturedAt: new Date().toISOString(),
      source: 'api',
      ...(channel ? { channel } : {}),
    };
    const res = await send<Omit<Extract<SaveResult, { ok: true }>, 'ok'>>({ type: 'save', payload });
    if (!res) return { ok: false, queued: false, error: 'no-background-response' };
    return res as SaveResult;
  },
  serverUp,
  // Scanned videos open in YouTube's own player; there is no media item to read.
  mediaItem: () => undefined,
  loadMediaItem: () => Promise.reject(new Error('YouTube videos play in the embedded player')),
  openUrl(url) {
    window.open(url, '_blank', 'noopener');
  },
  loadFont: loadPanelFont,
  async postStats(id) {
    let r: YtInfoResult | undefined;
    try {
      r = (await browser.runtime.sendMessage({ type: 'ytInfo', id })) as YtInfoResult | undefined;
    } catch {
      r = undefined;
    }
    if (!r) return { ok: false, reason: 'retry', error: 'Extension not responding. Reload the page' };
    if (!r.ok) return { ok: false, reason: r.reason, error: r.reason === 'offline' ? OFFLINE : r.error };
    return { ok: true, details: detailsFromYtInfo(r.data), at: Date.now(), source: 'youtube' };
  },
};
