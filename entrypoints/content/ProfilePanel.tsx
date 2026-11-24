// Side panel: the full analysis of a creator's reels against their own
// baseline. State lives in the shared ProfileStore (profileStore.ts) so the
// inline profile strip and the grid badges show the same scan.
import { createEffect, createMemo, createSignal, For, Match, on, onCleanup, onMount, Show, Switch, type JSX } from 'solid-js';
import { age, ago, compact, date, duration, interval, multiple, pct, ratio, TIER_LABEL, tierVars, windowText } from '@/lib/format';
import type { ScoredReel } from '@/lib/types';
import type { PanelDeps } from './panel-deps';
import {
  countTarget,
  daysTarget,
  isPresetSize,
  MAX_CUSTOM_SIZE,
  parseSize,
  SIZES,
  THRESHOLDS,
  WINDOWS,
  type Phase,
  type ProfileStore,
} from './profileStore';
import type { SaveController } from './saves';
import ReelRow from './ReelRow';
import {
  approxNote,
  baselineFrom,
  bulkProgressText,
  bulkSummaryText,
  datesMostlyEstimated,
  emptyNote,
  endedNote,
  ofSize,
  progressPct,
  saveAllLabel,
  scanLabel,
  stageText,
  whenText,
  windowRunNote,
} from './scanCopy';
import ScanChart from './ScanChart';
import PostingChart, { busiestDay, busiestHour } from './PostingChart';

type Filter = 'outliers' | 'all' | 'under';
type Sort = 'multiple' | 'views' | 'newest';

export default function ProfilePanel(props: {
  store: ProfileStore;
  saves: SaveController;
  deps: PanelDeps;
  theme: 'dark' | 'light';
  onClose: () => void;
  /** Open a reel in place (lightbox); the event keeps Ctrl/Cmd-click as a new tab. */
  onOpenReel: (r: ScoredReel, list: readonly ScoredReel[], event?: MouseEvent) => void;
  /** A lightbox is open over the panel: it owns Esc. */
  keysTaken?: () => boolean;
}) {
  const deps = props.deps;
  const st0 = props.store;
  const site = st0.site;
  const { phase, target, setTarget, prev, scan, analysis, threshold, setThreshold, bulk, scanStored, unsavedOutliers } = st0;
  const run = () => st0.run();
  const stop = () => st0.stop();
  const viewStored = st0.viewStored;
  const saveOne = (r: ScoredReel) => void st0.saveOne(r);
  const saveAll = () => st0.saveAll();
  const [filter, setFilter] = createSignal<Filter>('outliers');
  const [sort, setSort] = createSignal<Sort>('multiple');
  let scrollEl: HTMLDivElement | undefined;

  onMount(() => void deps.loadFont());
  // A new scan resets the list to its outliers, scrolled to the top.
  createEffect(
    on(st0.scanVersion, () => {
      setFilter('outliers');
      scrollEl?.scrollTo({ top: 0 });
    }, { defer: true }),
  );

  const counts = createMemo(() => {
    const a = analysis();
    const reels = a?.reels ?? [];
    return {
      outliers: reels.filter((r) => r.isOutlier).length,
      all: reels.length,
      under: reels.filter((r) => r.tier === 'under').length,
    };
  });

  const rows = createMemo(() => {
    const a = analysis();
    if (!a) return [];
    const f = filter();
    const list = a.reels.filter((r) => (f === 'all' ? true : f === 'under' ? r.tier === 'under' : r.isOutlier));
    const s = sort();
    if (s === 'newest') return list; // analyzeProfile returns newest first
    const key = s === 'views' ? (r: ScoredReel) => r.views : (r: ScoredReel) => r.multiple;
    return [...list].sort((a, b) => key(b) - key(a));
  });

  // Esc closes. Ignore it while the viewer types into the page.
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== 'Escape' || props.keysTaken?.()) return;
    const t = e.composedPath()[0];
    if (t instanceof HTMLElement && (t.isContentEditable || ['INPUT', 'TEXTAREA'].includes(t.tagName))) return;
    props.onClose();
  };
  window.addEventListener('keydown', onKey, { capture: true });
  onCleanup(() => window.removeEventListener('keydown', onKey, { capture: true }));

  const open = (r: ScoredReel, e?: MouseEvent) => props.onOpenReel(r, rows(), e);

  return (
    <aside
      class="op-panel"
      data-theme={props.theme}
      style={tierVars(props.theme)}
      aria-label={`Outlier analysis for @${st0.username}`}
    >
      <header class="op-top">
        <span class="op-title">Outliers</span>
        <a class="op-handle" href={site.profileUrl(st0.username)}>
          @{st0.username}
        </a>
        <Show when={site.platform === 'youtube'}>
          <span class="op-kind" title={`This analysis scores their ${site.items} only`}>
            {site.Items}
          </span>
        </Show>
        <button type="button" class="op-icon" onClick={props.onClose} title="Close (Esc)" aria-label="Close panel">
          <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
            <path d="M3.5 3.5l9 9m0-9l-9 9" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
          </svg>
        </button>
      </header>

      <div class="op-scroll" ref={scrollEl}>
        <Switch>
          <Match when={phase().kind === 'intro' || phase().kind === 'error'}>
            <section class="op-start">
              <Show when={phase().kind === 'error'}>
                <p class="op-alert op-alert-bad">
                  Couldn't analyze @{st0.username}: {(phase() as { message: string }).message}
                </p>
              </Show>
              <Show when={prev()}>
                {(d) => (
                  <div class="op-prev">
                    <div>
                      <div class="op-prev-line">
                        Last scanned <b>{ago(d().scanned_at)}</b>:{' '}
                        <b class="ct" data-tier={d().stats.outlierCount > 0 ? 'outlier' : 'normal'}>
                          {d().stats.outlierCount}
                        </b>{' '}
                        {d().stats.outlierCount === 1 ? 'outlier' : 'outliers'}
                      </div>
                      <div class="op-dim">
                        {d().sample_size} {site.items} · baseline {compact(d().baseline_views)}
                      </div>
                    </div>
                    <button type="button" class="op-btn" onClick={() => viewStored(d())}>
                      View
                    </button>
                  </div>
                )}
              </Show>
              <h2 class="op-h">Sample</h2>
              <SizePicker onEnter={run} />
              <p class="op-dim op-note">{site.sampleNote}</p>
              <button type="button" class="op-btn op-btn-solid op-go" onClick={() => void run()}>
                {prev() ? 'Rescan' : 'Analyze'} @{st0.username}
              </button>
            </section>
          </Match>

          <Match when={phase().kind === 'running'}>
            {(() => {
              const p = () => phase() as Extract<Phase, { kind: 'running' }>;
              const pct = () => progressPct(p().count, target());
              return (
                <section class="op-start op-running" aria-live="polite">
                  <div class="op-progress-num">
                    <span class="op-num">{p().count}</span>
                    <span class="op-dim">
                      {ofSize(target())} {site.items}
                    </span>
                  </div>
                  <p class="op-dim">{stageText(p().stage, site)}</p>
                  <Show when={windowRunNote(target(), site)}>{(note) => <p class="op-dim">{note()}</p>}</Show>
                  <div class="op-bar" classList={{ 'is-open': pct() === null }}>
                    <span style={{ width: `${pct() ?? 100}%` }} />
                  </div>
                  <button
                    type="button"
                    class="op-btn"
                    onClick={stop}
                    disabled={p().stage === 'reading'}
                    title={site.stopTitle}
                  >
                    Stop
                  </button>
                </section>
              );
            })()}
          </Match>

          <Match when={phase().kind === 'results' && scan() && analysis()}>
            <Results />
          </Match>
        </Switch>
      </div>
    </aside>
  );

  /** Preset sample sizes, a box for any number up to MAX_CUSTOM_SIZE, or a time window. */
  function SizePicker(p: { onEnter: () => void }) {
    const count = () => {
      const t = target();
      return t.kind === 'count' ? t.n : null;
    };
    const days = () => {
      const t = target();
      return t.kind === 'days' ? t.days : null;
    };
    const custom = () => count() != null && !isPresetSize(count()!);
    const [draft, setDraft] = createSignal(custom() ? String(count()) : '');
    const take = (text: string) => {
      const n = parseSize(text);
      if (n != null) setTarget(countTarget(n));
    };
    return (
      <>
        <div class="op-seg op-seg-wide" role="radiogroup" aria-label="Sample size">
          <For each={SIZES}>
            {(n) => (
              <button type="button" role="radio" class="op-seg-opt" aria-checked={count() === n} onClick={() => setTarget(countTarget(n))}>
                <Show when={n !== Infinity} fallback={<>All {site.items}</>}>
                  Last <b class="op-num">{n}</b> {site.items}
                </Show>
              </button>
            )}
          </For>
        </div>
        <label class="op-custom" data-on={custom()}>
          <span>Or the last</span>
          <input
            type="number"
            inputmode="numeric"
            min="1"
            max={MAX_CUSTOM_SIZE}
            step="1"
            placeholder="any number"
            aria-invalid={draft() !== '' && parseSize(draft()) == null}
            value={draft()}
            on:focus={() => take(draft())}
            on:input={(e) => {
              setDraft(e.currentTarget.value);
              take(e.currentTarget.value);
            }}
            on:keydown={(e) => {
              // The site's own shortcuts (YouTube seeks on digits) must not see typing here.
              e.stopPropagation();
              if (e.key === 'Enter' && parseSize(draft()) != null) p.onEnter();
            }}
            on:keyup={(e) => e.stopPropagation()}
            on:keypress={(e) => e.stopPropagation()}
          />
          <span>
            {site.items} <span class="op-faint">(up to {MAX_CUSTOM_SIZE})</span>
          </span>
        </label>
        <span class="op-or" data-on={days() != null}>Or everything uploaded in the last</span>
        <div class="op-seg op-seg-wide" role="radiogroup" aria-label="Time window">
          <For each={WINDOWS}>
            {(d) => {
              const [num, unit] = windowText(d).replace('the last ', '').split(' ');
              return (
                <button type="button" role="radio" class="op-seg-opt" aria-checked={days() === d} onClick={() => setTarget(daysTarget(d))}>
                  <b class="op-num">{unit ? num : 1}</b> {unit ?? num}
                </button>
              );
            }}
          </For>
        </div>
      </>
    );
  }

  function Results() {
    const [rescanOpen, setRescanOpen] = createSignal(false);
    const rescan = () => {
      setRescanOpen(false);
      void st0.run();
    };
    const s = () => scan()!;
    const a = () => analysis()!;
    const st = () => a().stats;
    const trend = () => {
      const t = st().trend;
      if (t == null) return { text: '–', dir: 'flat' };
      const dir = t >= 1.1 ? 'up' : t <= 0.9 ? 'down' : 'flat';
      return { text: `${dir === 'up' ? '↑' : dir === 'down' ? '↓' : '→'} ${multiple(t)}`, dir };
    };
    /** When and how often they upload. Gap sizes, days and hours need exact upload times. */
    const Posting = () => {
      const dated = () => !datesMostlyEstimated(st(), site);
      const needs = 'Needs upload dates';
      const exact = 'Needs exact upload times for most of the sample';
      const day = () => busiestDay(st().uploadsByWeekday);
      const hour = () => busiestHour(st().uploadsByHour);
      return (
        <section class="op-posting" aria-label="Posting">
          <h2 class="op-h">Posting</h2>
          <dl class="op-stats op-stats-tight">
            <Stat
              label="Uploads every"
              value={dated() ? interval(st().avgIntervalDays) : '–'}
              hint={dated() ? `Average time between uploads (pinned ${site.items} left out)` : needs}
            />
            <Stat
              label="Median gap"
              value={interval(st().medianIntervalDays)}
              hint={st().medianIntervalDays == null ? exact : 'The typical gap: bursts and breaks barely move it'}
            />
            <Stat
              label="Longest gap"
              value={interval(st().longestGapDays)}
              hint={st().longestGapDays == null ? exact : 'Longest break between two uploads in the sample'}
            />
            <Stat
              label="Last upload"
              value={dated() && st().lastUploadDays != null ? `${age(st().lastUploadDays! * 24)} ago` : '–'}
              hint={dated() ? `Time from their newest ${site.item} to the scan` : needs}
            />
            <Stat
              label="Posts / week"
              value={dated() ? st().postsPerWeek.toFixed(1) : '–'}
              hint={dated() ? `${site.Items} in the sample per week` : needs}
            />
            <Stat label="Median length" value={duration(st().medianDurationSec)} hint={`Median length of the ${site.items} in the sample`} />
            <Stat
              label="Busiest day"
              value={day()?.label ?? '–'}
              hint={day() ? `${day()!.n} uploads on that day` : st().uploadsByWeekday ? 'No clear favourite' : exact}
            />
            <Stat
              label="Busiest hours"
              value={hour()?.label ?? '–'}
              hint={hour() ? `${hour()!.n} uploads in these two hours, your time` : st().uploadsByHour ? 'No clear favourite' : exact}
            />
          </dl>
          <Show when={st().uploadsByWeekday && st().uploadsByHour}>
            <PostingChart byWeekday={st().uploadsByWeekday!} byHour={st().uploadsByHour!} />
          </Show>
        </section>
      );
    };
    return (
      <>
        <section class="op-profile">
          <div class="op-avatar">
            <Show when={s().profile.profilePicUrl} fallback={<span>{s().profile.username.slice(0, 1)}</span>}>
              <img src={s().profile.profilePicUrl} alt="" referrerpolicy="no-referrer" />
            </Show>
          </div>
          <div class="op-who">
            <div class="op-name">{s().profile.fullName || `@${s().profile.username}`}</div>
            <div class="op-dim">
              <b class="op-num op-num-sm">{compact(s().profile.followers)}</b> {site.followers}
              <Show when={s().profile.postsCount != null}> · {compact(s().profile.postsCount)} posts</Show>
            </div>
          </div>
          <button
            type="button"
            class="op-btn op-btn-sm"
            aria-expanded={rescanOpen()}
            aria-controls="op-rescan"
            onClick={() => setRescanOpen(!rescanOpen())}
            title="Scan again, with a different sample size if you like"
          >
            Rescan
          </button>
        </section>

        <Show when={rescanOpen()}>
          <section class="op-rescan" id="op-rescan" aria-label="Rescan">
            <SizePicker onEnter={() => rescan()} />
            <button type="button" class="op-btn op-btn-solid" onClick={() => rescan()} title={site.rescanTitle(target())}>
              {scanLabel(target(), site)}
            </button>
          </section>
        </Show>

        <p class="op-scanmeta op-dim">
          {st().sampleSize} {site.items}
          {s().target.kind === 'days' ? ` from ${windowText((s().target as { days: number }).days)}` : ''}
          {baselineFrom(s()) ? ` (${baselineFrom(s())})` : ''},{' '}
          {datesMostlyEstimated(st(), site) ? site.estimatedAges : `${date(st().dateRange.from)} to ${date(st().dateRange.to)}`}
          {' · '}
          {whenText(s(), scanStored())}
        </p>

        <Show when={endedNote(s(), site)}>{(note) => <p class="op-alert">{note()}</p>}</Show>
        <Show when={approxNote(st(), site)}>{(note) => <p class="op-alert">{note()}</p>}</Show>
        <Show when={st().lowConfidence && st().sampleSize > 0}>
          <p class="op-alert">
            Only {st().matureCount} {st().matureCount === 1 ? `${site.item} is` : `${site.items} are`} older than 72 hours, so the
            baseline is shaky. Treat these multiples as rough.
          </p>
        </Show>

        <Show
          when={st().sampleSize > 0}
          fallback={<p class="op-empty">{emptyNote(s(), site)}</p>}
        >
          <dl class="op-stats">
            <Stat
              label="Baseline"
              value={compact(st().baselineViews)}
              hint={`Median views of ${st().matureCount} ${site.items} older than 72h${st().channel ? ` in ${site.whole}` : ''}`}
            />
            <Stat label="Hit rate" value={pct(st().hitRate)} hint={`Share of mature ${site.items} at ${multiple(st().threshold)} or more`} />
            <Stat
              label="Outliers / 10x+"
              value={
                <>
                  <span class="ct" data-tier={st().outlierCount > 0 ? 'outlier' : 'normal'}>{st().outlierCount}</span>
                  <span class="op-slash">/</span>
                  <span class="ct" data-tier={st().breakoutCount > 0 ? 'strong' : 'normal'}>{st().breakoutCount}</span>
                </>
              }
              hint="Outliers at the threshold, breakouts at 10x or more"
            />
            <Stat
              label={`Views / ${site.followers.replace(/s$/, '')}`}
              value={ratio(st().medianViewsPerFollower)}
              hint={`Median views of mature ${site.items} ÷ ${site.followers}`}
            />
            <Stat label="Engagement" value={pct(st().medianEngagementRate)} hint="Median (likes + comments) ÷ views" />
            <Stat label="Comment bait" value={pct(st().commentBaitShare)} hint="Captions like “comment X and I'll DM you”" />
            <Stat
              label="Trend"
              value={<span class={`op-trend op-trend-${trend().dir}`}>{trend().text}</span>}
              hint={`Median views of the newest 10 mature ${site.items} vs older ones (needs 15)`}
            />
            <Stat
              label="Best"
              value={
                <Show when={st().best} fallback="–">
                  <button type="button" class="op-best ct" data-tier={st().best!.tier} onClick={(e) => open(st().best!, e)} title={`Open the top ${site.item}`}>
                    {multiple(st().best!.multiple)}
                  </button>
                </Show>
              }
              hint="Highest multiple in the sample"
            />
          </dl>

          <Posting />

          <details class="op-how">
            <summary>How outliers are scored</summary>
            <p>
              The baseline is the median views of this creator's {site.items} older than 72 hours, so a few viral hits
              don't drag it up. Each {site.item}'s multiple is its views divided by that baseline: {multiple(threshold())} or more,
              and clearly above the creator's usual spread, is an outlier; 5x is strong and 10x a breakout.
            </p>
            <p>{site.Items} under 72 hours old are scored but marked early, because their views are still climbing.</p>
            <Show when={st().channel}>
              <p>
                A time window still reads {site.whole}: the baseline and trend come from all {st().channel!.sampleSize}{' '}
                {site.items}, so one hot or cold month doesn't move the yardstick. Only the window's {site.items} are listed
                and counted.
              </p>
            </Show>
          </details>

          <ScanChart reels={a().reels} baseline={st().baselineViews} threshold={threshold()} onOpen={open} item={site.item} />
          <div class="op-legend op-dim">
            <span><i class="op-key op-key-out" /> outlier</span>
            <span><i class="op-key" /> other</span>
            <span><i class="op-key op-key-early" /> early</span>
            <span><i class="op-key-line" /> baseline</span>
            <span><i class="op-key-line op-key-dash" /> threshold</span>
          </div>

          <div class="op-controls">
            <div class="op-seg" role="radiogroup" aria-label="Show">
              <SegOpt on={filter() === 'outliers'} set={() => setFilter('outliers')} label="Outliers" n={counts().outliers} />
              <SegOpt on={filter() === 'all'} set={() => setFilter('all')} label="All" n={counts().all} />
              <SegOpt on={filter() === 'under'} set={() => setFilter('under')} label="Under" n={counts().under} />
            </div>
            <label class="op-select">
              <span class="op-sr">Sort</span>
              <select value={sort()} onChange={(e) => setSort(e.currentTarget.value as Sort)}>
                <option value="multiple">By multiple</option>
                <option value="views">By views</option>
                <option value="newest">Newest</option>
              </select>
            </label>
          </div>
          <div class="op-controls">
            <div class="op-thr-row" role="radiogroup" aria-label="Outlier threshold">
              <span class="op-dim">Threshold</span>
              <For each={THRESHOLDS}>
                {(t) => (
                  <button type="button" role="radio" class="op-chip" aria-checked={threshold() === t} onClick={() => setThreshold(t)}>
                    {multiple(t)}
                  </button>
                )}
              </For>
            </div>
            <Show
              when={bulk()}
              fallback={
                <button
                  type="button"
                  class="op-btn op-btn-sm"
                  classList={{ 'op-btn-accent': !saveAllLabel(counts().outliers, unsavedOutliers().length, st0.queuedOutliers()).disabled }}
                  disabled={saveAllLabel(counts().outliers, unsavedOutliers().length, st0.queuedOutliers()).disabled}
                  onClick={() => void saveAll()}
                >
                  {saveAllLabel(counts().outliers, unsavedOutliers().length, st0.queuedOutliers()).text}
                </button>
              }
            >
              {(b) => (
                <span class="op-bulk">
                  <span class="op-dim">{bulkProgressText(b())}</span>
                  <button type="button" class="op-btn op-btn-sm" onClick={() => st0.stopBulk()}>
                    Cancel
                  </button>
                </span>
              )}
            </Show>
          </div>

          <Show when={st0.bulkSummary()}>{(sum) => <p class="op-dim op-bulk-sum">{bulkSummaryText(sum())}</p>}</Show>

          <Show
            when={rows().length > 0}
            fallback={
              <p class="op-empty">
                {filter() === 'outliers'
                  ? `Nothing reaches ${multiple(threshold())} against this baseline. Try a lower threshold.`
                  : filter() === 'under'
                    ? `No ${site.item} fell to half the baseline or below.`
                    : `No ${site.items}.`}
              </p>
            }
          >
            <ul class="op-list">
              <For each={rows()}>
                {(r) => (
                  <ReelRow
                    r={r}
                    saves={props.saves}
                    site={site}
                    busy={bulk() != null}
                    onSave={saveOne}
                    onOpen={(x, e) => {
                      if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return; // new tab, as usual
                      e.preventDefault();
                      open(x);
                    }}
                  />
                )}
              </For>
            </ul>
          </Show>
        </Show>
      </>
    );
  }
}


function Stat(props: { label: string; value: JSX.Element; hint: string }) {
  return (
    <div class="op-stat" title={props.hint}>
      <dt>{props.label}</dt>
      <dd class="op-num">{props.value}</dd>
    </div>
  );
}

function SegOpt(props: { on: boolean; set: () => void; label: string; n: number }) {
  return (
    <button type="button" role="radio" class="op-seg-opt" aria-checked={props.on} onClick={props.set}>
      {props.label} <span class="op-count">{props.n}</span>
    </button>
  );
}


