// Everything the content script does inside Instagram's page, minus the
// extension plumbing (index.tsx) so the dev harness can run it unchanged.
//
// - tracks the URL (location.ts) and which creator's profile we're "on"
//   (sticky while a post modal is open over their grid);
// - scans the DOM (MutationObserver, throttled) and injects a small shadow
//   host per post (Save button), per grid tile (multiple badge) and one
//   under the profile header (stats strip);
// - Alt+S saves the reel in view; Alt+N opens its stats card (statsState.ts);
// - tears all of it down on navigation away and on dispose().
import { createEffect, createRoot, createSignal, on, type Accessor } from 'solid-js';
import type { ScanRef } from '@/lib/metrics';
import type { ScanFormat, ScoredReel } from '@/lib/types';
import { isPostPath, pageCode } from '@/lib/igdom';
import { usernameFromPath } from '@/lib/profile';
import {
  actionRowFor,
  COMMENT_SEL,
  ensurePositioned,
  gridTiles,
  HOST_ATTR,
  looksLikeVideoPost,
  pageLinkFor,
  placementFor,
  postContainer,
  bestCodeIn,
  profileHeader,
  reelInViewShortcode,
  resolveCode,
  restorePositioned,
} from './dom';
import GridBadge from './GridBadge';
import { hoverTarget, mountHost, unmount, type Mounted } from './hosts';
import InlineSave, { type SaveVariant } from './InlineSave';
import { watchLocation, type Timers } from './location';
import type { PanelDeps } from './panel-deps';
import { createProfileStore, outliersByMultiple, type ProfileStore } from './profileStore';
import ProfileStrip from './ProfileStrip';
import { createContentShift, type RailGeom } from './railLayout';
import { createSaveController, type SaveController } from './saves';
import { createStatsControl, scanRefFromDetail, scanRefFromStore, STATS_KEY, statsButtonFor, type SaveHost, type StatsControl } from './statsState';
import { createThemeWatcher, type Theme } from './theme';

export interface Runtime {
  theme: Accessor<Theme>;
  saves: SaveController;
  deps: PanelDeps;
  /** Store of the profile whose side panel is open, else null. */
  panelStore: Accessor<ProfileStore | null>;
  /** Store whose scan is running while neither its strip nor its panel is in view (floating progress). */
  scanPillStore: Accessor<ProfileStore | null>;
  /** Outliers-only rail beside the shifted profile column, when it fits. */
  rail: Accessor<{ store: ProfileStore; geom: RailGeom } | null>;
  /**
   * Open a reel without leaving the page. Ctrl/Cmd/Shift/middle-click opens a
   * new tab; `viaPage` first clicks any link of Instagram's to it (its own
   * modal); otherwise our lightbox, stepping through `list`.
   */
  openReel(r: Pick<ScoredReel, 'shortcode' | 'url'>, opts?: { list?: readonly ScoredReel[]; viaPage?: boolean; event?: MouseEvent }): void;
  /** The open lightbox, if any. */
  lightbox: Accessor<{ store: ProfileStore; codes: string[]; start: number } | null>;
  closeLightbox(): void;
  /** YouTube: the store whose outliers grid (a pop-up of only its outliers) is open. */
  outlierGrid: Accessor<ProfileStore | null>;
  closeOutlierGrid(): void;
  closePanel(): void;
  /** The stats card: which post's is open. */
  stats: StatsControl;
  /**
   * The creator's latest scan to compare a post with: the in-page one when
   * this tab scanned or loaded it, else the stored one (null when there is
   * none, or the server is down).
   */
  creatorScan(username: string, format: ScanFormat): Promise<ScanRef | null>;
  /** On this creator's profile (or channel) page right now. */
  onCreatorPage(username: string): boolean;
  /** Run a DOM scan now (tests). */
  scanNow(): void;
  dispose(): void;
}

const SCAN_GAP_MS = 200;
const SAFETY_SCAN_MS = 1500;
const OVERLAY_GRACE_MS = 1500;
const HEADER_WAIT_MS = 3000;
const MAX_STORES = 6;
const PAGE_STYLE_ID = 'reelscope-page-style';
const PAGE_CSS = `
[data-rs-dim] { opacity: .14 !important; filter: grayscale(1) !important; transition: opacity .2s, filter .2s; }
[data-rs-dim]:hover { opacity: .75 !important; filter: none !important; }
`;

const HOST_STYLE: Record<SaveVariant, string> = {
  pill: 'all:initial;display:inline-flex;align-items:center;flex:none;margin:0 0 0 6px;vertical-align:middle;',
  stack: 'all:initial;display:flex;justify-content:center;flex:none;margin:2px 0 10px;',
  overlay: 'all:initial;position:absolute;top:10px;left:10px;z-index:5;display:block;',
};

export function startRuntime(opts: { deps: PanelDeps; timers: Timers }): Runtime {
  const { deps, timers } = opts;
  return createRoot((disposeRoot) => {
    const saves = createSaveController(deps);
    const stats = createStatsControl();
    const themeW = createThemeWatcher();
    const theme = themeW.theme;

    const [path, setPath] = createSignal(location.pathname);
    /** Profile whose page (or a modal over it) we're on. */
    const [ctxUser, setCtxUser] = createSignal<string | null>(usernameFromPath(location.pathname));
    const [panelFor, setPanelFor] = createSignal<string | null>(null);

    const stores = new Map<string, ProfileStore>();
    const storeFor = (u: string) => {
      let s = stores.get(u);
      if (s) {
        stores.delete(u); // re-insert: Map order doubles as LRU
        stores.set(u, s);
        return s;
      }
      s = createProfileStore(u, deps, saves);
      stores.set(u, s);
      for (const [name, old] of stores) {
        if (stores.size <= MAX_STORES) break;
        if (name === u) continue;
        old.dispose();
        stores.delete(name);
      }
      return s;
    };
    const ctxStore = (): ProfileStore | null => {
      const u = ctxUser();
      return u ? storeFor(u) : null;
    };

    // ---- per-post save buttons ---------------------------------------------
    const saveHosts = new Map<HTMLElement, SaveHost>();
    const overlaySeen = new WeakMap<Element, number>();
    const pageCodeSig = () => pageCode(path());

    /** One host per post: the Save and Stats buttons (InlineSave). */
    function mountSave(variant: SaveVariant, code: Accessor<string | null>): Mounted {
      const m = mountHost('save', HOST_STYLE[variant], () => (
        <InlineSave code={code} variant={variant} saves={saves} theme={theme} stats={stats} />
      ));
      m.host.setAttribute('data-variant', variant);
      saveHosts.set(m.host, { ...m, code, variant });
      return m;
    }

    function injectRows() {
      for (const svg of Array.from(document.querySelectorAll(COMMENT_SEL))) {
        if (svg.closest(`[${HOST_ATTR}]`)) continue;
        const row = actionRowFor(svg);
        if (!row) continue;
        if (row.querySelector(`:scope > [${HOST_ATTR}="save"]`)) continue;
        if (!looksLikeVideoPost(row)) continue;
        const { code, dynamic } = resolveCode(row);
        if (!code && !dynamic) continue; // links not rendered yet: next scan
        const place = placementFor(row, svg);
        if (!place) continue;
        const m = mountSave(place.vertical ? 'stack' : 'pill', dynamic ? pageCodeSig : () => code);
        row.insertBefore(m.host, place.before);
        if (code) saves.watch([code]);
        // A late action row replaces any overlay fallback in the same post.
        const scope = postContainer(row);
        scope?.querySelectorAll(`[${HOST_ATTR}="save"][data-variant="overlay"]`).forEach((h) => {
          const om = saveHosts.get(h as HTMLElement);
          if (om) (unmount(om), saveHosts.delete(om.host));
        });
      }
    }

    /** Fallback for non-English UIs: no labelled action rows, so overlay the video. */
    function injectOverlays(now: number) {
      const reelsPage = /^\/reels?\//.test(location.pathname);
      for (const video of Array.from(document.querySelectorAll('video'))) {
        const scope = postContainer(video);
        if (!scope && !reelsPage) continue;
        let el: Element | null = video;
        let near = false;
        for (let i = 0; el && i < 12; i++) {
          el = el.parentElement;
          if (!el) break;
          if (el.querySelector(`[${HOST_ATTR}="save"]`)) {
            near = true;
            break;
          }
          if (el === scope) break;
        }
        if (near) continue;
        if (scope?.querySelector(COMMENT_SEL)) continue; // a labelled row exists, wait for it
        const seen = overlaySeen.get(video);
        if (seen === undefined) {
          overlaySeen.set(video, now);
          continue;
        }
        if (now - seen < OVERLAY_GRACE_MS) continue;
        const parent = video.parentElement;
        if (!parent) continue;
        const own = pageCode(location.pathname);
        const code = scope ? (scope.matches('[role="dialog"]') && own ? own : bestCodeIn(scope)) : null;
        if (!code && !own) continue;
        ensurePositioned(parent);
        const m = mountSave('overlay', code ? () => code : pageCodeSig);
        parent.append(m.host);
        if (code) saves.watch([code]);
      }
    }

    // ---- profile strip + grid badges ----------------------------------------
    let strip: (Mounted & { user: string; io?: IntersectionObserver }) | null = null;
    let stripWaitSince = 0;
    const [stripInView, setStripInView] = createSignal(false);
    const badgeHosts = new Map<HTMLAnchorElement, Mounted & { code: string; unhover: () => void }>();
    const [tilesVersion, setTilesVersion] = createSignal(0);

    function ensureStrip(user: string, now: number) {
      if (strip && strip.user !== user) teardownProfileUi();
      if (!strip) {
        const store = storeFor(user);
        const m = mountHost('strip', 'all:initial;display:block;margin:0 0 28px;', () => (
          <ProfileStrip
            store={store}
            theme={theme}
            panelOpen={() => panelFor() === user}
            onDetails={() => setPanelFor(panelFor() === user ? null : user)}
            onOpenReel={(r, event) =>
              rtApi.openReel(r, { list: outliersByMultiple(store), viaPage: true, event })
            }
          />
        ));
        strip = { ...m, user };
        stripWaitSince = now;
        // A scan scrolls the strip away; the floating pill takes over then.
        try {
          strip.io = new IntersectionObserver((es) => setStripInView(es.some((e) => e.isIntersecting)));
          strip.io.observe(m.host);
        } catch {
          // no IntersectionObserver: the pill just shows during every scan
        }
      }
      if (strip.host.isConnected) return;
      const header = profileHeader();
      // Right after a profile-to-profile hop the old header can linger; give
      // the new one a moment before settling for whatever header is there.
      const fresh = header && (header.textContent ?? '').includes(user);
      if (header && (fresh || now - stripWaitSince > HEADER_WAIT_MS)) {
        header.after(strip.host);
      } else if (!header && now - stripWaitSince > HEADER_WAIT_MS) {
        const main = document.querySelector('main');
        const first = main?.firstElementChild ?? main;
        first?.prepend(strip.host);
      }
    }

    function injectBadges(store: ProfileStore) {
      if (!store.analysis()) return;
      let added = false;
      for (const { a, code } of gridTiles()) {
        const cur = badgeHosts.get(a);
        if (cur && cur.code === code && cur.host.isConnected) continue;
        if (cur) (cur.unhover(), unmount(cur), badgeHosts.delete(a));
        ensurePositioned(a);
        const m = mountHost('badge', 'all:initial;position:absolute;top:0;left:0;right:0;bottom:0;pointer-events:none;z-index:2;display:block;', () => (
          <GridBadge reel={() => store.byCode().get(code)} saved={() => saves.state(code).kind === 'saved'} />
        ));
        a.append(m.host);
        a.setAttribute('data-rs-tile', code);
        // Hovering (or focusing) the tile opens the badge's details; the badge itself takes no pointer.
        badgeHosts.set(a, { ...m, code, unhover: hoverTarget(a, m.host) });
        added = true;
      }
      if (added) setTilesVersion((v) => v + 1);
    }

    function clearBadges() {
      for (const [a, m] of badgeHosts) {
        m.unhover();
        unmount(m);
        a.removeAttribute('data-rs-tile');
        a.removeAttribute('data-rs-dim');
        restorePositioned(a);
      }
      badgeHosts.clear();
    }

    // ---- outliers-only rail ---------------------------------------------------------
    const shift = createContentShift();
    const [railGeom, setRailGeom] = createSignal<RailGeom | null>(null, {
      equals: (a, b) => a === b || (!!a && !!b && a.left === b.left && a.top === b.top && a.width === b.width && a.maxHeight === b.maxHeight),
    });
    let railTriedAt = 0;
    const railWanted = () => {
      const store = ctxStore();
      if (!store || !store.outliersOnly()) return false;
      if ((store.analysis()?.stats.outlierCount ?? 0) === 0) return false;
      if (panelFor() === store.username) return false; // the panel owns the right side
      // A post modal over the grid keeps the shift (no slide on every open/close).
      return onOwnProfile() || isPostPath(path());
    };
    const onOwnProfile = () => usernameFromPath(path())?.toLowerCase() === ctxUser()?.toLowerCase();
    function updateRail() {
      railTriedAt = Date.now();
      if (!railWanted()) {
        shift.restore();
        setRailGeom(null);
        return;
      }
      setRailGeom(shift.apply());
    }

    const [lightbox, setLightbox] = createSignal<{ store: ProfileStore; codes: string[]; start: number } | null>(null);

    function teardownProfileUi() {
      setLightbox(null);
      shift.restore();
      setRailGeom(null);
      if (strip) {
        strip.io?.disconnect();
        unmount(strip);
      }
      strip = null;
      setStripInView(false);
      clearBadges();
    }

    // Outliers-only: dim every tracked tile that isn't an outlier in the scan.
    createEffect(() => {
      tilesVersion();
      const store = ctxStore();
      const only = store?.outliersOnly() ?? false;
      const map = store?.byCode();
      for (const [a, m] of badgeHosts) {
        const dim = only && !map?.get(m.code)?.isOutlier;
        if (dim) a.setAttribute('data-rs-dim', '');
        else a.removeAttribute('data-rs-dim');
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

    // ---- scanning --------------------------------------------------------------
    function scan() {
      const now = Date.now();
      for (const [host, m] of saveHosts) {
        if (!host.isConnected) (m.dispose(), saveHosts.delete(host));
      }
      for (const [a, m] of badgeHosts) {
        if (!a.isConnected || !m.host.isConnected) {
          m.unhover();
          m.dispose();
          badgeHosts.delete(a);
        }
      }
      injectRows();
      injectOverlays(now);
      // Instagram re-rendered the shifted column, or the grid wasn't there yet.
      if (railWanted() && (shift.stale() || (!railGeom() && now - railTriedAt > 1000))) updateRail();
      const user = ctxUser();
      if (user) {
        const store = storeFor(user);
        if (usernameFromPath(location.pathname) === user) ensureStrip(user, now);
        injectBadges(store);
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

    // ---- navigation ------------------------------------------------------------
    function onUrl(url: URL) {
      const p = url.pathname;
      setPath(p);
      const user = usernameFromPath(p);
      if (user) setCtxUser(user);
      else if (!isPostPath(p)) setCtxUser(null);
      // else: a post/reel URL, usually a modal over the profile grid. Keep it.
      themeW.refresh();
      schedule();
    }
    const stopLoc = watchLocation(timers, onUrl);
    createEffect(on(railWanted, () => updateRail(), { defer: true }));
    let resizeTimer: ReturnType<typeof setTimeout> | undefined;
    const onResize = () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => railWanted() && updateRail(), 120);
    };
    window.addEventListener('resize', onResize);

    // A finished scan badges the grid right away, not at the next safety scan.
    createEffect(on(() => ctxStore()?.analysis(), () => schedule(), { defer: true }));
    // Buttons bound to the URL (the /reels/ viewer) need their saved state too.
    createEffect(() => {
      const c = pageCodeSig();
      if (c) saves.watch([c]);
    });

    createEffect(
      on(ctxUser, (user, prevUser) => {
        if (user === prevUser) return;
        teardownProfileUi();
        if (panelFor() !== user) setPanelFor(null);
        if (user) {
          storeFor(user);
          ensurePageStyle();
        }
      }),
    );

    // ---- Alt+S, Alt+N ------------------------------------------------------------
    const onKey = (e: KeyboardEvent) => {
      if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      // e.code so macOS Option+S (types "ß") works
      if (e.code !== 'KeyS' && e.code !== STATS_KEY.code) return;
      const t = e.composedPath()[0] ?? e.target;
      if (t instanceof HTMLElement && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName))) return;
      e.preventDefault();
      e.stopPropagation();
      const code = reelInViewShortcode();
      if (!code) {
        const what = e.code === 'KeyS' ? 'Use the Save button on a post.' : 'Use the Stats button on a post.';
        saves.showToast({ kind: 'error', code: null, message: `No reel in view. ${what}` });
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
        const u = panelFor();
        return u && u === ctxUser() ? storeFor(u) : null;
      },
      scanPillStore: () => {
        const store = ctxStore();
        if (!store || store.phase().kind !== 'running') return null;
        if (stripInView() || panelFor() === store.username) return null;
        return store;
      },
      rail: () => {
        const geom = railGeom();
        const store = ctxStore();
        return geom && store && railWanted() && onOwnProfile() ? { store, geom } : null;
      },
      openReel(r, opts = {}) {
        const e = opts.event;
        if (e && (e.ctrlKey || e.metaKey || e.shiftKey || e.button === 1)) {
          deps.openUrl(r.url);
          return;
        }
        if (opts.viaPage) {
          const link = pageLinkFor(r.shortcode);
          if (link) {
            link.click();
            return;
          }
        }
        const store = ctxStore();
        if (!store) return;
        const codes = (opts.list ?? []).map((x) => x.shortcode);
        if (!codes.includes(r.shortcode)) codes.unshift(r.shortcode);
        setLightbox({ store, codes, start: codes.indexOf(r.shortcode) });
      },
      lightbox,
      closeLightbox: () => setLightbox(null),
      outlierGrid: () => null,
      closeOutlierGrid: () => {},
      closePanel: () => setPanelFor(null),
      stats,
      async creatorScan(username, format) {
        const lower = username.toLowerCase();
        for (const s of stores.values()) {
          if (s.username.toLowerCase() !== lower || s.format !== format) continue;
          const live = scanRefFromStore(s);
          if (live) return live;
        }
        const d = await deps.previousScan(username, format).catch(() => null);
        return d ? scanRefFromDetail(d) : null;
      },
      onCreatorPage: (username) => usernameFromPath(path())?.toLowerCase() === username.toLowerCase(),
      scanNow: scan,
      dispose() {
        disposed = true;
        stats.close();
        stopLoc();
        mo.disconnect();
        themeW.stop();
        window.removeEventListener('keydown', onKey, { capture: true });
        window.removeEventListener('resize', onResize);
        clearTimeout(resizeTimer);
        teardownProfileUi();
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
