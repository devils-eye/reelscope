// Scan state for one creator, shared by the inline profile strip, the grid
// badges and the side panel. Lives in its own reactive root so it survives
// SPA navigation (opening a reel modal and coming back keeps the results).
import { batch, createMemo, createRoot, createSignal, type Accessor } from 'solid-js';
import { analyzeProfile, channelBaseline } from '@/lib/outliers';
import type {
  ChannelBaseline,
  ProfileAnalysis,
  ProfileInfo,
  ProfileReel,
  ProfileScanDetail,
  SaveResult,
  ScanFormat,
  ScoredReel,
} from '@/lib/types';
import type { PanelDeps } from './panel-deps';
import type { ScanOutcome, ScanStage } from './reelScan';
import { site as pageSite, siteFor, type Site } from './site';
import type { SaveController } from './saves';

/** Sample sizes; Infinity scans the whole profile (until the grid ends). */
export const SIZES = [36, 72, 150, Infinity] as const;
/** Largest custom sample; past this, scan All. */
export const MAX_CUSTOM_SIZE = 5000;
export const isPresetSize = (n: number) => (SIZES as readonly number[]).includes(n);
/** A typed sample size, or null when it isn't a whole number from 1 to MAX_CUSTOM_SIZE. */
export function parseSize(text: string): number | null {
  const n = Number(text.trim());
  return text.trim() !== '' && Number.isInteger(n) && n >= 1 && n <= MAX_CUSTOM_SIZE ? n : null;
}
/**
 * Time windows, in days. A window scan still reads the whole channel: the
 * window's reels are scored against all of them, so one hot or cold month
 * doesn't move the yardstick.
 */
export const WINDOWS = [7, 30, 90, 180, 365] as const;
const DAY_MS = 86400_000;

/** What a scan covers: the last N reels (Infinity: all of them), or the last N days of uploads. */
export type ScanTarget = { kind: 'count'; n: number } | { kind: 'days'; days: number };
export const countTarget = (n: number): ScanTarget => ({ kind: 'count', n });
export const daysTarget = (days: number): ScanTarget => ({ kind: 'days', days });
export const sameTarget = (a: ScanTarget, b: ScanTarget) =>
  a.kind === 'count' ? b.kind === 'count' && a.n === b.n : b.kind === 'days' && a.days === b.days;
/** The whole profile: every reel they have. */
export const isWhole = (t: ScanTarget) => t.kind === 'count' && t.n === Infinity;

export const THRESHOLDS = [1.5, 2, 3, 5] as const;
/** Gap between bulk saves (captured reels need no Instagram request; uncaptured ones also queue in lib/capture.ts). */
const SAVE_GAP_MS = 700;
const SAVE_JITTER_MS = 500;

export type Phase =
  | { kind: 'intro' }
  | { kind: 'running'; count: number; stage: ScanStage }
  | { kind: 'results' }
  | { kind: 'error'; message: string };

/** What a bulk save covers: the outliers, or every reel in the scan. */
export type BulkScope = 'outliers' | 'all';

/** How a bulk save run went. */
export interface BulkSummary {
  scope: BulkScope;
  /** New to the library. */
  saved: number;
  /** Already in the library (skipped up front, or the server knew them). */
  already: number;
  /** Queued in the extension because the server is offline. */
  queued: number;
  failed: number;
  /** Reels left unsaved because the run was cancelled. */
  cancelled: number;
}

export interface Scan {
  profile: ProfileInfo;
  reels: ProfileReel[];
  scannedAt: string;
  target: ScanTarget;
  /** Time windows: the whole channel's yardstick the window is scored against. */
  baseline?: ChannelBaseline;
  /** Why the scan fell short of its target (unset when it got there). */
  ended?: Exclude<ScanOutcome['ended'], 'full'>;
  /** Loaded from the server rather than scanned just now. */
  stored: boolean;
}

function stripRaw(r: ScoredReel): ScoredReel {
  const { raw: _raw, ...rest } = r;
  return rest;
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => (clearTimeout(t), resolve()), { once: true });
  });
}

export interface ProfileStore {
  username: string;
  /** What this store scans: reels / Shorts ('short'), or a YouTube channel's long-form videos ('long'). */
  format: ScanFormat;
  /** The words for what it scans ("Shorts", "videos"). */
  site: Site;
  phase: Accessor<Phase>;
  /** What the next scan covers. */
  target: Accessor<ScanTarget>;
  setTarget(t: ScanTarget): void;
  /** undefined while loading, null when there is no stored scan (or the server is down). */
  prev: Accessor<ProfileScanDetail | null | undefined>;
  serverUp: Accessor<boolean | undefined>;
  scan: Accessor<Scan | null>;
  /** Bumps whenever a new scan is shown (the panel resets its filter on it). */
  scanVersion: Accessor<number>;
  threshold: Accessor<number>;
  setThreshold(t: number): void;
  analysis: Accessor<ProfileAnalysis | null>;
  byCode: Accessor<ReadonlyMap<string, ScoredReel>>;
  unsavedOutliers: Accessor<ScoredReel[]>;
  /** Outliers waiting in the offline queue. */
  queuedOutliers: Accessor<number>;
  /** Reels a bulk save of this scope covers, best multiple first. */
  scopeReels(scope: BulkScope): ScoredReel[];
  /** Reels of a scope not yet saved (nor queued or saving). */
  unsaved(scope: BulkScope): ScoredReel[];
  /** Reels of a scope waiting in the offline queue. */
  queued(scope: BulkScope): number;
  scanStored: Accessor<boolean | null>;
  bulk: Accessor<{ done: number; total: number; scope: BulkScope } | null>;
  /** Outcome of the last "Save all" run (cleared by the next run or scan). */
  bulkSummary: Accessor<BulkSummary | null>;
  /** Dim everything but outliers in Instagram's own grid. */
  outliersOnly: Accessor<boolean>;
  setOutliersOnly(on: boolean): void;
  /** Scan the creator for the current target. */
  run(): Promise<void>;
  /** End a running scan early and score what loaded so far. */
  stop(): void;
  viewStored(d: ProfileScanDetail): void;
  saveOne(r: ScoredReel): Promise<SaveResult | null>;
  /** Save every unsaved reel of the scope (default: the outliers). */
  saveAll(scope?: BulkScope): Promise<void>;
  stopBulk(): void;
  dispose(): void;
}

/** The store's outliers, best multiple first (the rail's order). */
export const outliersByMultiple = (store: ProfileStore): ScoredReel[] =>
  [...(store.analysis()?.reels ?? [])].filter((r) => r.isOutlier).sort((a, b) => b.multiple - a.multiple);

/** One store per creator and format: a channel's Shorts and its long videos are scanned and scored apart. */
export const storeKey = (username: string, format: ScanFormat = 'short') => (format === 'long' ? `${username}/videos` : username);

export function createProfileStore(
  username: string,
  deps: PanelDeps,
  saves: SaveController,
  format: ScanFormat = 'short',
): ProfileStore {
  const site = siteFor(pageSite, format);
  return createRoot((dispose) => {
    const [phase, setPhase] = createSignal<Phase>({ kind: 'intro' });
    const [target, setTarget] = createSignal<ScanTarget>(countTarget(36), { equals: sameTarget });
    const [prev, setPrev] = createSignal<ProfileScanDetail | null | undefined>(undefined);
    const [serverUp, setServerUp] = createSignal<boolean | undefined>(undefined);
    const [scan, setScan] = createSignal<Scan | null>(null);
    const [scanVersion, setScanVersion] = createSignal(0);
    const [threshold, setThreshold] = createSignal(2);
    const [bulk, setBulk] = createSignal<{ done: number; total: number; scope: BulkScope } | null>(null);
    const [bulkSummary, setBulkSummary] = createSignal<BulkSummary | null>(null);
    const [scanStored, setScanStored] = createSignal<boolean | null>(null);
    const [outliersOnly, setOutliersOnly] = createSignal(false);

    let runCtl: AbortController | null = null;
    let bulkCtl: AbortController | null = null;
    let disposed = false;

    const analysis = createMemo<ProfileAnalysis | null>(() => {
      const s = scan();
      if (!s) return null;
      return analyzeProfile(
        s.reels,
        { followers: s.profile.followers },
        {
          threshold: threshold(),
          now: new Date(s.scannedAt),
          windowDays: s.target.kind === 'days' ? s.target.days : undefined,
          baseline: s.baseline,
        },
      );
    });

    const byCode = createMemo<ReadonlyMap<string, ScoredReel>>(
      () => new Map((analysis()?.reels ?? []).map((r) => [r.shortcode, r])),
    );

    const byMultiple = createMemo(() => [...(analysis()?.reels ?? [])].sort((a, b) => b.multiple - a.multiple));
    const scopeReels = (scope: BulkScope) => (scope === 'all' ? byMultiple() : byMultiple().filter((r) => r.isOutlier));
    const stateOf = (r: ScoredReel) => saves.state(r.shortcode).kind;
    // Queued saves go through on their own once the server is back.
    const unsaved = (scope: BulkScope) => scopeReels(scope).filter((r) => !['saved', 'queued', 'saving'].includes(stateOf(r)));
    const queued = (scope: BulkScope) => scopeReels(scope).filter((r) => stateOf(r) === 'queued').length;
    const queuedOutliers = createMemo(() => queued('outliers'));
    const unsavedOutliers = createMemo(() => unsaved('outliers'));

    function showScan(next: Scan) {
      batch(() => {
        setScan(next);
        setPhase({ kind: 'results' });
        setScanVersion((v) => v + 1);
      });
      saves.watch(next.reels.map((r) => r.shortcode));
    }

    function viewStored(d: ProfileScanDetail) {
      setThreshold(THRESHOLDS.includes(d.threshold as (typeof THRESHOLDS)[number]) ? d.threshold : 2);
      // Rescan with the same sample (size or time window) the stored scan used.
      const days = d.stats?.windowDays;
      const t = days !== undefined ? daysTarget(days) : countTarget(SIZES.find((n) => n >= d.sample_size) ?? Infinity);
      setTarget(t);
      showScan({
        profile: { userId: d.user_id ?? '', username: d.username, fullName: d.full_name ?? undefined, followers: d.followers ?? undefined },
        reels: d.reels,
        scannedAt: d.scanned_at,
        target: days !== undefined ? t : countTarget(d.sample_size),
        baseline: d.stats?.channel,
        stored: true,
      });
    }

    /**
     * Scan the creator for the current target. A time window reads the whole
     * channel (the yardstick), then keeps only the window's reels.
     */
    async function run() {
      if (runCtl) return; // one scan at a time; Stop ends it
      const ctl = new AbortController();
      runCtl = ctl;
      const want = target();
      const limit = want.kind === 'count' ? want.n : Infinity;
      setPhase({ kind: 'running', count: 0, stage: 'opening' });
      try {
        const out = await deps.scanProfile(username, {
          limit,
          since: want.kind === 'days' ? Date.now() - want.days * DAY_MS : undefined,
          format,
          signal: ctl.signal,
          onProgress: (p) => !disposed && setPhase({ kind: 'running', count: p.count, stage: p.stage }),
        });
        if (disposed) return;
        if (out.reels.length === 0 && out.ended === 'stopped') {
          setPhase(scan() ? { kind: 'results' } : { kind: 'intro' });
          return;
        }
        const scannedAt = new Date();
        const list = out.reels;
        // Short of the target: say why. A grid that stops growing has ended:
        // that is all their reels, which is what a whole-profile or window scan wants.
        const ended = out.ended === 'full' || out.ended === 'stalled' ? undefined : out.ended;
        const since = want.kind === 'days' ? scannedAt.getTime() - want.days * DAY_MS : undefined;
        // Old pinned reels fall outside the window too.
        const reels = since === undefined ? list : list.filter((r) => Date.parse(r.takenAt) >= since);
        const baseline = since === undefined ? undefined : channelBaseline(list, scannedAt.getTime());
        setScanStored(null);
        setBulkSummary(null);
        showScan({
          profile: out.profile,
          reels,
          scannedAt: scannedAt.toISOString(),
          target: want,
          baseline,
          ended,
          stored: false,
        });
        const a = analysis();
        if (a && reels.length > 0) {
          const clean: ProfileAnalysis = {
            stats: { ...a.stats, best: a.stats.best && stripRaw(a.stats.best) },
            reels: a.reels.map(stripRaw),
          };
          deps.postScan(out.profile, clean, format).then(
            (ok) => (setScanStored(ok), ok && setServerUp(true)),
            () => setScanStored(false),
          );
        }
      } catch (e) {
        if (disposed) return;
        setPhase({ kind: 'error', message: e instanceof Error ? e.message : String(e) });
      } finally {
        if (runCtl === ctl) runCtl = null;
      }
    }

    function stop() {
      runCtl?.abort();
    }

    async function saveOne(r: ScoredReel): Promise<SaveResult | null> {
      const a = analysis();
      const s = scan();
      if (!a || !s) return null;
      return saves.save(r.shortcode, {
        channel: {
          baselineViews: a.stats.baselineViews,
          multiple: r.multiple,
          tier: r.tier,
          sampleSize: a.stats.sampleSize,
          scannedAt: s.scannedAt,
        },
      });
    }

    /**
     * Save every reel of the scope not yet saved, best multiple first,
     * one at a time. Each save takes the capture-store path (no Instagram
     * request for reels the page loaded); the /media/info fallback for the
     * rest is rate-limited in lib/capture.ts, so this never bursts requests.
     */
    async function saveAll(scope: BulkScope = 'outliers') {
      if (bulkCtl) return;
      const reels = scopeReels(scope);
      const sum: BulkSummary = {
        scope,
        saved: 0,
        already: reels.filter((r) => stateOf(r) === 'saved').length,
        queued: queued(scope),
        failed: 0,
        cancelled: 0,
      };
      const todo = unsaved(scope);
      setBulkSummary(null);
      if (todo.length === 0) {
        setBulkSummary(sum);
        return;
      }
      const ctl = new AbortController();
      bulkCtl = ctl;
      setBulk({ done: 0, total: todo.length, scope });
      for (const [i, r] of todo.entries()) {
        if (i > 0) await sleep(SAVE_GAP_MS + Math.random() * SAVE_JITTER_MS, ctl.signal);
        if (ctl.signal.aborted || disposed) {
          sum.cancelled = todo.length - i;
          break;
        }
        const res = await saveOne(r);
        if (res?.ok) res.isNew ? sum.saved++ : sum.already++;
        else if (res?.queued) sum.queued++;
        else sum.failed++;
        setBulk({ done: i + 1, total: todo.length, scope });
      }
      bulkCtl = null;
      setBulk(null);
      if (!disposed) setBulkSummary(sum);
    }

    // Show the stored scan straight away; never start a scan on our own
    // (on Instagram it scrolls the viewer's page).
    void deps.previousScan(username, format).then(
      (d) => {
        setPrev(d);
        if (d && !scan() && phase().kind === 'intro') viewStored(d);
      },
      () => setPrev(null),
    );
    void deps.serverUp().then(setServerUp, () => setServerUp(false));

    return {
      username,
      format,
      site,
      phase,
      target,
      setTarget,
      prev,
      serverUp,
      scan,
      scanVersion,
      threshold,
      setThreshold,
      analysis,
      byCode,
      unsavedOutliers,
      queuedOutliers,
      scopeReels,
      unsaved,
      queued,
      scanStored,
      bulk,
      bulkSummary,
      outliersOnly,
      setOutliersOnly,
      run,
      stop,
      viewStored,
      saveOne,
      saveAll,
      stopBulk: () => bulkCtl?.abort(),
      dispose() {
        disposed = true;
        runCtl?.abort();
        bulkCtl?.abort();
        dispose();
      },
    };
  });
}
