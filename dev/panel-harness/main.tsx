/// <reference types="vite/client" />
// Runs the real in-page UI on the fake Instagram in fixture/ig.js. Scans are
// real: the page hook (hook.ts) captures what the fixture loads from
// fixture/api.js and reelScan.ts scrolls the reels tab. Library calls
// (stored scans, saves) are faked here. URL params (sticky for the tab):
//   ?theme=dark|light   Instagram theme (fixture)
//   ?noprev=1           no stored scan for @fakecreator (shows the Scan CTA)
//   ?offline=1          library server down (saves queue)
import { render } from 'solid-js/web';
// @ts-expect-error plain JS fixture module, no types
import { REELS } from './fixture/api.js';
import fontUrl from '@fontsource-variable/archivo/files/archivo-latin-wdth-normal.woff2?url';
import overlayCss from '../../entrypoints/content/style.css?inline';
import panelCss from '../../entrypoints/content/panel.css?inline';
import statsCss from '../../entrypoints/content/stats.css?inline';
import { captures, startCaptureBridge } from '../../entrypoints/content/captures';
import ContentApp from '../../entrypoints/content/ContentApp';
import type { PanelDeps } from '../../entrypoints/content/panel-deps';
import { startRuntime } from '../../entrypoints/content/runtime';
import { windowTimers } from '../../entrypoints/content/location';
import { igPostStats } from '../../entrypoints/content/postStats';
import { scanByScrolling } from '../../entrypoints/content/reelScan';
import { loadMediaItem } from '@/lib/capture';
import { analyzeProfile } from '@/lib/outliers';
import { mapMediaItem } from '@/lib/profile';
import type { ProfileInfo, ProfileReel, ProfileScanDetail, ReelLatestRow } from '@/lib/types';

const url = new URLSearchParams(location.search);
for (const k of ['noprev', 'offline']) if (url.has(k)) sessionStorage.setItem(`h-${k}`, url.get(k)!);
const flag = (k: string) => sessionStorage.getItem(`h-${k}`) === '1';
const N = 72;

const now = Date.now();
// The stored scan is the fixture's own first 72 reels, so badges and numbers
// line up with what a fresh scan finds.
const reels: ProfileReel[] = (REELS.fakecreator as unknown[]).slice(0, N).map((m) => {
  const { raw: _raw, ...r } = mapMediaItem(m)!;
  return r;
});

const profile: ProfileInfo = {
  userId: '123',
  username: 'fakecreator',
  fullName: 'Fake Creator · Coffee Lab',
  followers: 184_000,
  postsCount: 612,
};

const stored: ProfileScanDetail = (() => {
  const scannedAt = new Date(now - 3 * 86400_000).toISOString();
  const a = analyzeProfile(reels, profile, { now: new Date(scannedAt) });
  return {
    id: 1, username: 'fakecreator', user_id: '123', full_name: profile.fullName ?? null, followers: profile.followers ?? null,
    scanned_at: scannedAt, sample_size: reels.length, threshold: 2, baseline_views: a.stats.baselineViews,
    stats: a.stats, reels: a.reels, scans: [],
  };
})();

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const savedSet = new Set(['FAKE013']);
function fakeRow(code: string): ReelLatestRow {
  const r = reels.find((x) => x.shortcode === code);
  const views = r?.views ?? 612_000;
  return {
    shortcode: code, platform: 'instagram', url: `https://www.instagram.com/reel/${code}/`, media_id: null,
    author_username: r ? 'fakecreator' : 'coffeelab.daily', author_full_name: null, author_followers: 184_000,
    caption: r?.caption ?? 'The 3 mistakes everyone makes with cold brew', audio_title: null, duration_sec: 31,
    taken_at: r?.takenAt ?? new Date(now - 50 * 3600_000).toISOString(), first_saved_at: '', last_saved_at: '',
    status: 'new', tags: [], notes: null, raw_json: null, snapshot_id: 1, snapshot_captured_at: '',
    latest_play_count: views, latest_view_count: null, latest_like_count: Math.round(views * 0.04),
    latest_comment_count: Math.round(views * 0.0011), latest_share_count: null, latest_author_followers: 184_000,
    latest_views: views, age_hours: 50, views_per_follower: views / 184_000, views_per_hour: views / 50,
    channel_baseline_views: r ? stored.baseline_views : null, channel_multiple: r && stored.baseline_views ? views / stored.baseline_views : null,
    channel_tier: null,
  };
}

startCaptureBridge();
(window as unknown as { __captures: unknown }).__captures = captures;

const deps: PanelDeps = {
  scanProfile: (username, opts) => scanByScrolling(username, captures, opts),
  previousScan: async (u) => (flag('noprev') || flag('offline') || u !== 'fakecreator' ? null : (await wait(150), stored)),
  postScan: async () => !flag('offline'),
  savedShortcodes: async (codes) => (flag('offline') ? [] : codes.filter((c) => savedSet.has(c))),
  async saveReel(sc) {
    await wait(450);
    if (flag('offline')) return { ok: false, queued: true, error: 'offline' };
    const isNew = !savedSet.has(sc);
    savedSet.add(sc);
    return { ok: true, isNew, data: fakeRow(sc) };
  },
  serverUp: async () => !flag('offline'),
  openUrl: (u) => window.open(u, '_blank', 'noopener'),
  mediaItem: (code) => captures.get(code)?.item,
  loadMediaItem: (code, signal) => loadMediaItem(code, captures, signal),
  postStats: (code, signal) => igPostStats(code, captures, (c, sg) => loadMediaItem(c, captures, sg), signal),
  async loadFont() {
    const buf = await (await fetch(fontUrl)).arrayBuffer();
    const face = new FontFace('Archivo RS', buf, { stretch: '62% 125%', weight: '100 900' });
    await face.load();
    document.fonts.add(face);
  },
};

const rt = startRuntime({ deps, timers: windowTimers });
(window as unknown as { __rs: unknown }).__rs = rt;

const host = document.createElement('div');
host.setAttribute('data-harness-overlay', '');
document.body.append(host);
const shadow = host.attachShadow({ mode: 'open' });
const style = document.createElement('style');
style.textContent = overlayCss + panelCss + statsCss;
const mount = document.createElement('div');
shadow.append(style, mount);
render(() => <ContentApp rt={rt} />, mount);
