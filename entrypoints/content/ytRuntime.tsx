// Everything the content script does on YouTube; the Instagram twin is
// runtime.tsx, and both feed the same body-level UI (ContentApp: toast, side
// panel, scan pill, lightbox).
//
// - Save after Subscribe on the watch page, and at the top of the Shorts
//   player's action column, bound to the video in the URL;
// - Alt+S saves the video or Short on screen; Alt+N opens its stats card;
// - on a channel page, the outlier strip above the tab's content: their
//   long-form videos or their Shorts (a switch in the strip, following the
//   Videos / Shorts tab), each scored against its own baseline (the library
//   server lists them, see ytDeps.ts), a multiple badge on each video and
//   Shorts tile, "Outliers only" dimming and the side panel;
// - a scanned Short or video opens in YouTube's own player (our Save is
//   there too). No lightbox: YouTube refuses to play its embedded player
//   inside its own pages (error 152, whatever the referrer or domain).
// - "View outliers" in the strip: a pop-up grid of only the outliers
//   (OutlierGrid), each opening in a new tab.
// No outliers rail.
import { createEffect, createMemo, createRoot, createSignal, on } from 'solid-js';
import { ensurePositioned, HOST_ATTR, restorePositioned } from './dom';
import GridBadge from './GridBadge';
import { hoverTarget, mountHost, unmount, type Mounted } from './hosts';
import InlineSave, { type SaveVariant } from './InlineSave';
import { watchLocation, type Timers } from './location';
import type { PanelDeps } from './panel-deps';
import { createProfileStore, outliersByMultiple, storeKey, type ProfileStore } from './profileStore';
import ProfileStrip from './ProfileStrip';
import type { Runtime } from './runtime';
import { createSaveController } from './saves';
import { createStatsControl, scanRefFromDetail, scanRefFromStore, STATS_KEY, statsButtonFor, type SaveHost } from './statsState';
import { createThemeWatcher } from './theme';
import {
  channelContentTop,
  channelFromPath,
  channelTabFormat,
  pageVideoId,
  shortsActionBars,
  shortTiles,
  videoTiles,
  watchActionRow,
} from './ytDom';
import type { ScanFormat } from '@/lib/types';

const SCAN_GAP_MS = 250;
const SAFETY_SCAN_MS = 1500;
/** Two per channel: its Shorts and its long videos. */
const MAX_STORES = 8;
const FORMATS: ScanFormat[] = ['long', 'short'];
const PAGE_STYLE_ID = 'reelscope-page-style';
const PAGE_CSS = `
[data-rs-dim] { opacity: .14 !important; filter: grayscale(1) !important; transition: opacity .2s, filter .2s; }
[data-rs-dim]:hover { opacity: .75 !important; filter: none !important; }
`;

const HOST_STYLE: Record<Exclude<SaveVariant, 'overlay'>, string> = {
  pill: 'all:initial;display:inline-flex;align-items:center;flex:none;margin:0 0 0 12px;vertical-align:middle;',
  stack: 'all:initial;display:flex;justify-content:center;flex:none;margin:0 0 16px;',
};
const BADGE_STYLE = 'all:initial;position:absolute;top:0;left:0;right:0;bottom:0;pointer-events:none;z-index:2;display:block;';
const STRIP_STYLE = 'all:initial;display:block;margin:16px 0 12px;';

export function startYoutubeRuntime(opts: { deps: PanelDeps; timers: Timers }): Runtime {
  const { deps, timers } = opts;
  return createRoot((disposeRoot) => {
    const saves = createSaveController(deps);
    const stats = createStatsControl();
    const themeW = createThemeWatcher();
    const theme = themeW.theme;

    const [href, setHref] = createSignal(location.href);
    const videoId = createMemo(() => pageVideoId(new URL(href())));
    /** The channel whose page we're on. */
    const [ctxUser, setCtxUser] = createSignal<string | null>(channelFromPath(location.pathname));
    /**
     * Which of their uploads the strip scores: long-form videos or Shorts.
     * The Videos and Shorts tabs pick it; on other tabs it stays as it was.
     */
    const tabFormat = createMemo(() => channelTabFormat(new URL(href()).pathname));
    const [format, setFormat] = createSignal<ScanFormat>(tabFormat() ?? 'long');
    createEffect(on(tabFormat, (f) => f && setFormat(f), { defer: true }));
    /** The store key (storeKey) whose side panel is open. */
    const [panelFor, setPanelFor] = createSignal<string | null>(null);
    /** The store key whose outliers grid is open. */
    const [gridFor, setGridFor] = createSignal<string | null>(null);

    const stores = new Map<string, ProfileStore>();
    const storeFor = (u: string, f: ScanFormat) => {
      const key = storeKey(u, f);
      let s = stores.get(key);
      if (s) {
        stores.delete(key); // re-insert: Map order doubles as LRU
        stores.set(key, s);
        return s;
      }
      s = createProfileStore(u, deps, saves, f);
      stores.set(key, s);
      for (const [k, old] of stores) {
        if (stores.size <= MAX_STORES) break;
        if (k === key || old.username === u) continue;
        old.dispose();
        stores.delete(k);
      }
      return s;
    };
    const keyOf = (s: ProfileStore) => storeKey(s.username, s.format);
    const ctxStore = (): ProfileStore | null => {
      const u = ctxUser();
      return u ? storeFor(u, format()) : null;
    };
    /** The switch in the strip: the side panel, if open, follows it. */
    const switchFormat = (f: ScanFormat) => {
      const u = ctxUser();
      const open = u !== null && panelFor() !== null;
      setFormat(f);
      if (open) setPanelFor(storeKey(u, f));
      if (u !== null && gridFor() !== null) setGridFor(storeKey(u, f));
    };

    // ---- Save button -------------------------------------------------------------
    const saveHosts = new Map<HTMLElement, SaveHost>();
    /** One host per action row: the Save and Stats buttons (InlineSave). */
    function mountSave(variant: 'pill' | 'stack'): Mounted {
      const m = mountHost('save', HOST_STYLE[variant], () => (
        <InlineSave code={videoId} variant={variant} saves={saves} theme={theme} stats={stats} />
      ));
      saveHosts.set(m.host, { ...m, code: videoId, variant });
      return m;
    }
    function injectSaves() {
      const row = watchActionRow();
      if (row && !row.querySelector(`:scope > [${HOST_ATTR}="save"]`)) {
        row.append(mountSave('pill').host);
        // YouTube lays out the owner row and its buttons by measuring, on resize:
        // make it measure again with ours in, or Share can end up past the edge.
        timers.setTimeout(() => window.dispatchEvent(new Event('resize')), 0);
        timers.setTimeout(() => window.dispatchEvent(new Event('resize')), 600);
      }
      for (const bar of shortsActionBars()) {
        if (!bar.querySelector(`:scope > [${HOST_ATTR}="save"]`)) bar.prepend(mountSave('stack').host);
      }
    }

    // ---- channel strip + video and Shorts badges -------------------------------
    let strip: (Mounted & { key: string; io?: IntersectionObserver }) | null = null;
    const [stripInView, setStripInView] = createSignal(false);
    const badgeHosts = new Map<HTMLAnchorElement, Mounted & { code: string; tile: HTMLElement; store: ProfileStore; unhover: () => void }>();
    const [tilesVersion, setTilesVersion] = createSignal(0);

    function ensureStrip(store: ProfileStore) {
      const key = keyOf(store);
      if (strip && strip.key !== key) teardownStrip();
      if (!strip) {
        const m = mountHost('strip', STRIP_STYLE, () => (
          <ProfileStrip
            store={store}
            theme={theme}
            panelOpen={() => panelFor() === key}
            onDetails={() => setPanelFor(panelFor() === key ? null : key)}
            onOpenReel={(r, event) => rtApi.openReel(r, { list: outliersByMultiple(store), event })}
            onFormat={switchFormat}
            onShowOutliers={() => setGridFor(key)}
          />
        ));
        strip = { ...m, key };
        try {
          strip.io = new IntersectionObserver((es) => setStripInView(es.some((e) => e.isIntersecting)));
          strip.io.observe(m.host);
        } catch {
          // no IntersectionObserver: the pill just shows during every scan
        }
      }
      // Switching tabs swaps the content under us: follow it.
      const top = channelContentTop();
      if (top && strip.host.parentElement !== top) top.prepend(strip.host);
    }

    /** Shorts tiles get the Shorts scan's multiples, video tiles the long videos'. */
    function injectBadges(user: string) {
      let added = false;
      for (const f of FORMATS) {
        const store = storeFor(user, f);
        if (!store.analysis()) continue;
        for (const { a, tile, code } of f === 'long' ? videoTiles() : shortTiles()) {
          const cur = badgeHosts.get(a);
          if (cur && cur.code === code && cur.store === store && cur.host.isConnected) continue;
          if (cur) (cur.unhover(), unmount(cur), badgeHosts.delete(a));
          ensurePositioned(a);
          const m = mountHost('badge', BADGE_STYLE, () => (
            <GridBadge reel={() => store.byCode().get(code)} saved={() => saves.state(code).kind === 'saved'} />
          ));
          a.append(m.host);
          // Hovering anywhere on the tile (thumbnail or title) opens the badge's details.
          badgeHosts.set(a, { ...m, code, tile, store, unhover: hoverTarget(tile, m.host) });
          added = true;
        }
      }
      if (added) setTilesVersion((v) => v + 1);
    }

    function clearBadges() {
      for (const [a, m] of badgeHosts) {
        m.unhover();
        unmount(m);
        m.tile.removeAttribute('data-rs-dim');
        restorePositioned(a);
      }
      badgeHosts.clear();
    }

    function teardownStrip() {
      if (strip) {
        strip.io?.disconnect();
        unmount(strip);
      }
      strip = null;
      setStripInView(false);
    }

    function teardownChannelUi() {
      teardownStrip();
      clearBadges();
    }

    // Outliers only: dim every badged tile that isn't an outlier in its scan
    // (the switch is per scan: the videos' leaves the Shorts alone).
    createEffect(() => {
      tilesVersion();
      for (const m of badgeHosts.values()) {
        if (m.store.outliersOnly() && !m.store.byCode().get(m.code)?.isOutlier) m.tile.setAttribute('data-rs-dim', '');
        else m.tile.removeAttribute('data-rs-dim');
      }
    });

    let pageStyle: HTMLStyleElement | null = null;
    function ensurePageStyle() {
      if (pageStyle?.isConnected) return;
      pageStyle = document.createElement('style');
      pageStyle.id = PAGE_STYLE_ID;
      pageStyle.textContent = PAGE_CSS;
      (document.head ?? document.documentElement).append(pageStyle);
    }

    // ---- scanning the page ------------------------------------------------------
    function scan() {
      for (const [host, m] of saveHosts) {
        if (!host.isConnected) (m.dispose(), saveHosts.delete(host));
      }
      for (const [a, m] of badgeHosts) {
        if (!a.isConnected || !m.host.isConnected) {
          m.unhover();
          m.dispose();
          m.tile.removeAttribute('data-rs-dim');
          badgeHosts.delete(a);
        }
      }
      injectSaves();
      const user = ctxUser();
      if (user) {
        ensureStrip(storeFor(user, format()));
        injectBadges(user);
      }
    }

    let scheduled = false;
    let lastScan = 0;
    let disposed = false;
    function schedule() {
      if (scheduled || disposed) return;
      scheduled = true;
      const wait = Math.max(0, SCAN_GAP_MS - (Date.now() - lastScan));
      timers.setTimeout(() => {
        requestAnimationFrame(() => {
          scheduled = false;
          if (disposed) return;
          lastScan = Date.now();
          scan();
        });
      }, wait);
    }

    const mo = new MutationObserver(schedule);
    mo.observe(document.body, { childList: true, subtree: true });
    timers.setInterval(schedule, SAFETY_SCAN_MS);

    // ---- navigation -------------------------------------------------------------
    const stopLoc = watchLocation(timers, (url) => {
      setHref(url.href);
      setCtxUser(channelFromPath(url.pathname));
      themeW.refresh();
      schedule();
    });
    // A finished scan badges its tiles right away, not at the next safety scan;
    // the switch swaps the strip right away too.
    createEffect(
      on(
        () => {
          const u = ctxUser();
          return u ? [format(), ...FORMATS.map((f) => storeFor(u, f).analysis())] : null;
        },
        () => schedule(),
        { defer: true },
      ),
    );
    createEffect(() => {
      const c = videoId();
      if (c) saves.watch([c]);
    });
    createEffect(
      on(ctxUser, (user, prevUser) => {
        if (user === prevUser) return;
        teardownChannelUi();
        const p = panelFor();
        if (!user || (p !== storeKey(user, 'short') && p !== storeKey(user, 'long'))) setPanelFor(null);
        setGridFor(null);
        if (user) {
          for (const f of FORMATS) storeFor(user, f);
          ensurePageStyle();
        }
      }),
    );

    // ---- Alt+S, Alt+N --------------------------------------------------------------
    const onKey = (e: KeyboardEvent) => {
      if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      if (e.code !== 'KeyS' && e.code !== STATS_KEY.code) return;
      const t = e.composedPath()[0] ?? e.target;
      if (t instanceof HTMLElement && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName))) return;
      e.preventDefault();
      e.stopPropagation();
      const code = videoId();
      if (!code) {
        saves.showToast({ kind: 'error', code: null, message: 'Open a video or a Short first.' });
        return;
      }
      if (e.code === 'KeyS') {
        void saves.save(code, { toast: true });
        return;
      }
      const btn = statsButtonFor(saveHosts.values(), code);
      stats.toggle(code, btn?.anchor ?? null, btn?.variant ?? 'pill');
    };
    window.addEventListener('keydown', onKey, { capture: true });

    void deps.loadFont();
    schedule();

    const rtApi: Runtime = {
      theme,
      saves,
      deps,
      panelStore: () => {
        const store = ctxStore();
        return store && panelFor() === keyOf(store) ? store : null;
      },
      // The strip's scan when the strip is out of sight, else the other
      // format's scan still running behind the switch.
      scanPillStore: () => {
        const u = ctxUser();
        if (!u) return null;
        const shown = storeFor(u, format());
        if (shown.phase().kind === 'running' && !stripInView() && panelFor() !== keyOf(shown)) return shown;
        const other = storeFor(u, format() === 'long' ? 'short' : 'long');
        return other.phase().kind === 'running' ? other : null;
      },
      rail: () => null,
      openReel(r, o = {}) {
        const e = o.event;
        if (e && (e.ctrlKey || e.metaKey || e.shiftKey || e.button === 1)) {
          deps.openUrl(r.url);
          return;
        }
        // YouTube's own link when the page shows the video: it opens in place, no reload.
        const path = r.url.includes('/shorts/') ? `/shorts/${r.shortcode}` : `/watch?v=${r.shortcode}`;
        const link = document.querySelector<HTMLAnchorElement>(`ytd-page-manager a[href^="${path}"]`);
        if (link) link.click();
        else location.assign(r.url);
      },
      lightbox: () => null,
      closeLightbox: () => {},
      outlierGrid: () => {
        const store = ctxStore();
        return store && gridFor() === keyOf(store) ? store : null;
      },
      closeOutlierGrid: () => setGridFor(null),
      closePanel: () => setPanelFor(null),
      stats,
      async creatorScan(username, f) {
        const live = stores.get(storeKey(username, f));
        const ref = live ? scanRefFromStore(live) : null;
        if (ref) return ref;
        const d = await deps.previousScan(username, f).catch(() => null);
        return d ? scanRefFromDetail(d) : null;
      },
      onCreatorPage: (username) => ctxUser() === username,
      scanNow: scan,
      dispose() {
        disposed = true;
        stats.close();
        stopLoc();
        mo.disconnect();
        themeW.stop();
        window.removeEventListener('keydown', onKey, { capture: true });
        teardownChannelUi();
        for (const m of saveHosts.values()) unmount(m);
        saveHosts.clear();
        for (const s of stores.values()) s.dispose();
        stores.clear();
        pageStyle?.remove();
        document.querySelectorAll('[data-rs-pos]').forEach((el) => restorePositioned(el as HTMLElement));
        disposeRoot();
      },
    };
    return rtApi;
  });
}
