// Inline strip under a profile's header: the creator's outlier stats when a
// scan exists, otherwise a "Scan reels" call to action. Never scans on its own
// (a scan scrolls the viewer's page). Native `on:` listeners throughout,
// because this lives inside Instagram's React tree.
import { createSignal, For, Match, Show, Switch, type Accessor, type JSX } from 'solid-js';
import { age, ago, compact, date, interval, multiple, pct, tierVars, windowText } from '@/lib/format';
import { ChevronIcon, Glyph } from './icons';
import {
  countTarget,
  daysTarget,
  isPresetSize,
  isWhole,
  MAX_CUSTOM_SIZE,
  parseSize,
  SIZES,
  WINDOWS,
  type BulkScope,
  type Phase,
  type ProfileStore,
} from './profileStore';
import type { ScanFormat, ScoredReel } from '@/lib/types';
import {
  approxNote,
  bulkProgressText,
  baselineFrom,
  bulkSummaryText,
  bulkScopeLabel,
  datesMostlyEstimated,
  daysLabel,
  emptyNote,
  endedNote,
  ofSize,
  progressPct,
  saveAllLabel,
  scanLabel,
  sizeLabel,
  stageText,
  whenText,
  windowRunNote,
} from './scanCopy';
import type { Theme } from './theme';

export default function ProfileStrip(props: {
  store: ProfileStore;
  theme: Accessor<Theme>;
  panelOpen: Accessor<boolean>;
  onDetails: () => void;
  onOpenReel: (r: ScoredReel, e: MouseEvent) => void;
  /** YouTube: switch the strip between their long videos and their Shorts (each scored apart). */
  onFormat?: (f: ScanFormat) => void;
  /** YouTube: open the pop-up grid of only the outliers. */
  onShowOutliers?: () => void;
}) {
  const s = props.store;
  const site = s.site;
  const a = () => s.analysis();
  const st = () => a()?.stats;
  const outliers = () => st()?.outlierCount ?? 0;
  const saveAll = () => saveAllLabel(outliers(), s.unsavedOutliers().length, s.queuedOutliers());
  // One tray at a time under the top row: bulk save, or rescan options.
  const [tray, setTray] = createSignal<'bulk' | 'rescan' | null>(null);
  const toggleTray = (t: 'bulk' | 'rescan') => setTray(tray() === t ? null : t);
  const startBulk = (scope?: BulkScope) => {
    setTray(null);
    void s.saveAll(scope);
  };
  const rescan = () => {
    setTray(null);
    void s.run();
  };
  const running = () => {
    const p = s.phase();
    return p.kind === 'running' ? p : null;
  };

  const meta = () => {
    const sc = s.scan();
    const stats = st();
    if (!sc || !stats) return null;
    const when = whenText(sc, s.scanStored());
    const span = datesMostlyEstimated(stats, site) ? site.estimatedAges : `${date(stats.dateRange.from)} to ${date(stats.dateRange.to)}`;
    // A time window says the span already.
    if (sc.target.kind === 'days') {
      const from = baselineFrom(sc);
      return `${stats.sampleSize} ${site.items} from ${windowText(sc.target.days)}${from ? `, ${from}` : ''} · ${when}`;
    }
    return `${stats.sampleSize} ${site.items} · ${span} · ${when}`;
  };

  const trend = () => {
    const t = st()?.trend;
    if (t == null) return { text: '–', dir: 'flat' };
    const dir = t >= 1.1 ? 'up' : t <= 0.9 ? 'down' : 'flat';
    return { text: `${dir === 'up' ? '↑' : dir === 'down' ? '↓' : '→'} ${multiple(t)}`, dir };
  };

  return (
    <section
      class="rs-strip"
      data-theme={props.theme()}
      style={tierVars(props.theme())}
      aria-label={`Outlier stats for @${s.username}`}
    >
      <div class="rs-strip-top">
        <span class="rs-brand">
          <Glyph size={18} />
          <span class="rs-brand-word">Outliers</span>
        </span>
        <Show when={props.onFormat}>
          {(set) => (
            <span class="rs-seg rs-format" role="radiogroup" aria-label="Score their videos or their Shorts">
              <For each={FORMAT_OPTS}>
                {(o) => (
                  <button
                    type="button"
                    role="radio"
                    class="rs-seg-opt"
                    aria-checked={s.format === o.format}
                    title={o.title}
                    on:click={() => s.format !== o.format && set()(o.format)}
                  >
                    {o.label}
                  </button>
                )}
              </For>
            </span>
          )}
        </Show>
        <span class="rs-strip-meta" title={meta() ?? undefined}>
          {meta() ?? `@${s.username}`}
        </span>
        <Show when={s.phase().kind === 'results' && st()}>
          <span class="rs-strip-actions">
            <button
              type="button"
              class="rs-toggle"
              aria-pressed={s.outliersOnly()}
              disabled={outliers() === 0}
              title={site.dimTitle}
              on:click={() => s.setOutliersOnly(!s.outliersOnly())}
            >
              <span class="rs-switch" aria-hidden="true" />
              Outliers only
              <span class="rs-count">{outliers()}</span>
            </button>
            <Show when={props.onShowOutliers}>
              {(show) => (
                <button
                  type="button"
                  class="rs-btn rs-btn-grid"
                  disabled={outliers() === 0}
                  title={`Only the outliers, in a grid; each opens in a new tab`}
                  on:click={() => show()()}
                >
                  <GridIcon />
                  View outliers
                </button>
              )}
            </Show>
            <Show
              when={s.bulk()}
              fallback={
                <span class="rs-split">
                  <button
                    type="button"
                    class="rs-btn"
                    classList={{ 'rs-btn-accent': !saveAll().disabled }}
                    disabled={saveAll().disabled}
                    title="Save every outlier to your library, one at a time"
                    on:click={() => startBulk()}
                  >
                    {saveAll().text}
                  </button>
                  <button
                    type="button"
                    class="rs-btn rs-split-more"
                    classList={{ 'rs-btn-accent': !saveAll().disabled }}
                    aria-expanded={tray() === 'bulk'}
                    aria-controls="rs-bulk-menu"
                    aria-label="More ways to save"
                    title={`Save the outliers or every scanned ${site.item}`}
                    on:click={() => toggleTray('bulk')}
                  >
                    <ChevronIcon />
                  </button>
                </span>
              }
            >
              {(b) => (
                <span class="rs-bulk" aria-live="polite">
                  <span class="rs-bulk-text">{bulkProgressText(b())}</span>
                  <button type="button" class="rs-btn" on:click={() => s.stopBulk()}>
                    Cancel
                  </button>
                </span>
              )}
            </Show>
            <button
              type="button"
              class="rs-btn"
              aria-pressed={props.panelOpen()}
              on:click={() => props.onDetails()}
              title={`Chart, every ${site.item} and bulk save`}
            >
              Full analysis
            </button>
            <button
              type="button"
              class="rs-btn rs-btn-more"
              aria-expanded={tray() === 'rescan'}
              aria-controls="rs-rescan-menu"
              title="Scan again, with a different sample size if you like"
              on:click={() => toggleTray('rescan')}
            >
              Rescan
              <ChevronIcon />
            </button>
          </span>
        </Show>
      </div>

      <Show when={tray() === 'bulk' && !s.bulk() && s.phase().kind === 'results' && st()}>
        <BulkMenu store={s} onStart={startBulk} />
      </Show>
      <Show when={tray() === 'rescan' && s.phase().kind === 'results'}>
        <div class="rs-tray rs-rescan" id="rs-rescan-menu" role="group" aria-label="Rescan">
          <span class="rs-tray-row">
            <b>Sample</b>
            <span class="rs-dim">
              {s.scan() ? `This scan has ${s.scan()!.reels.length} ${site.items}. ` : ''}
              Pick All to reach {site.whole}, or a time window.
            </span>
          </span>
          <span class="rs-cta-go">
            <TargetPicker store={s} onEnter={() => rescan()} />
            <button type="button" class="rs-btn rs-btn-solid" title={site.rescanTitle(s.target())} on:click={() => rescan()}>
              {scanLabel(s.target(), site)}
            </button>
          </span>
        </div>
      </Show>

      <Switch>
        <Match when={running()}>
          {(() => {
            const p = () => running() ?? { count: 0, stage: 'opening' as const };
            const pct = () => progressPct(p().count, s.target());
            return (
            <div class="rs-strip-run" aria-live="polite">
              <span class="rs-run-num">
                <b>{p().count}</b>
                <Show when={ofSize(s.target())}>{(of) => <span>{of()}</span>}</Show>
                <i>{site.items}</i>
              </span>
              <span class="rs-run-body">
                <span class="rs-run-text">
                  <span>{stageText(p().stage, site)}</span>
                  <Show when={windowRunNote(s.target(), site) ?? (p().stage === 'opening' && site.runNote)}>
                    {(note) => <span class="rs-dim"> {note()}</span>}
                  </Show>
                </span>
                <span class="rs-bar" classList={{ 'is-open': pct() === null }}>
                  <span style={{ width: `${pct() ?? 100}%` }} />
                </span>
              </span>
              <button
                type="button"
                class="rs-btn"
                disabled={p().stage === 'reading'}
                title={site.stopTitle}
                on:click={() => s.stop()}
              >
                Stop
              </button>
            </div>
            );
          })()}
        </Match>

        <Match when={s.phase().kind === 'results' && st()}>
          {(() => {
            // Read the live stats, not Match's narrowed value: that one only
            // refreshes when truthiness changes (threshold changes in the panel).
            const stats = () => st()!;
            return (
            <>
              <Show when={stats().sampleSize > 0} fallback={<p class="rs-note">{emptyNote(s.scan()!, site)}</p>}>
                <dl class="rs-stats">
                  <Stat label="Baseline" hint={`Median views of the ${stats().matureCount} ${site.items} older than 72h${stats().channel ? ` in ${site.whole}` : ''}`}>
                    {compact(stats().baselineViews)}
                  </Stat>
                  <Stat label="Hit rate" hint={`Share of mature ${site.items} at ${multiple(stats().threshold)} or more`}>
                    {pct(stats().hitRate)}
                  </Stat>
                  <Stat label="Outliers / 10x+" hint="Outliers at the threshold, breakouts at 10x or more">
                    <span class="ct" data-tier={stats().outlierCount > 0 ? 'outlier' : 'normal'}>{stats().outlierCount}</span>
                    <span class="rs-slash">/</span>
                    <span class="ct" data-tier={stats().breakoutCount > 0 ? 'strong' : 'normal'}>{stats().breakoutCount}</span>
                  </Stat>
                  <Stat label="Best" hint="Highest multiple in the sample. Click to open it">
                    <Show when={stats().best} fallback="–">
                      <button
                        type="button"
                        class="rs-best ct"
                        data-tier={stats().best!.tier}
                        on:click={(e) => props.onOpenReel(stats().best!, e)}
                      >
                        {multiple(stats().best!.multiple)}
                      </button>
                    </Show>
                  </Stat>
                  <Stat label="Trend" hint={`Median views of the newest 10 mature ${site.items} vs older ones (needs 15)`}>
                    <span class={`rs-trend-${trend().dir}`}>{trend().text}</span>
                  </Stat>
                  <Stat label="Engagement" hint="Median (likes + comments) ÷ views">
                    {pct(stats().medianEngagementRate)}
                  </Stat>
                  <Stat
                    label="Uploads every"
                    hint={
                      datesMostlyEstimated(stats(), site)
                        ? 'Needs upload dates'
                        : `Average time between uploads: ${stats().postsPerWeek.toFixed(1)} ${site.items} a week`
                    }
                  >
                    {datesMostlyEstimated(stats(), site) ? '–' : interval(stats().avgIntervalDays)}
                  </Stat>
                  <Stat label="Last upload" hint={datesMostlyEstimated(stats(), site) ? 'Needs upload dates' : `Time from their newest ${site.item} to the scan`}>
                    {datesMostlyEstimated(stats(), site) || stats().lastUploadDays == null ? '–' : `${age(stats().lastUploadDays! * 24)} ago`}
                  </Stat>
                </dl>
              </Show>
              <Show when={s.scan() && endedNote(s.scan()!, site)}>
                {(note) => <p class="rs-note rs-note-warn">{note()}</p>}
              </Show>
              <Show when={approxNote(stats(), site)}>
                {(note) => <p class="rs-note rs-note-warn">{note()}</p>}
              </Show>
              <Show when={s.bulkSummary()}>
                {(sum) => (
                  <p class="rs-note" classList={{ 'rs-note-ok': !sum().failed && !sum().queued, 'rs-note-warn': sum().failed > 0 || sum().queued > 0 }}>
                    {bulkSummaryText(sum())}
                  </p>
                )}
              </Show>
              <Show when={stats().lowConfidence && stats().sampleSize > 0}>
                <p class="rs-note rs-note-warn">
                  Only {stats().matureCount} {stats().matureCount === 1 ? `${site.item} is` : `${site.items} are`} older than 72 hours, so the
                  baseline is shaky. Treat the multiples as rough.
                </p>
              </Show>
            </>
            );
          })()}
        </Match>

        <Match when={s.phase().kind === 'intro' && s.prev() === undefined}>
          <p class="rs-note rs-dim">Looking for a saved scan of @{s.username}…</p>
        </Match>

        <Match when={s.phase().kind === 'intro' || s.phase().kind === 'error'}>
          <div class="rs-cta">
            <div class="rs-cta-text">
              <Show when={s.phase().kind === 'error'}>
                <p class="rs-note rs-note-bad">Scan failed: {(s.phase() as Extract<Phase, { kind: 'error' }>).message}</p>
              </Show>
              <p class="rs-cta-head">
                Which of @{s.username}'s {site.items} beat their usual views?
              </p>
              <p class="rs-dim">{site.ctaBody}</p>
              <Show when={s.serverUp() === false}>
                <p class="rs-note rs-note-warn">
                  The library server is offline, so the scan won't be stored. Start it with <code>bun run server</code>.
                </p>
              </Show>
            </div>
            <div class="rs-cta-go">
              <TargetPicker store={s} onEnter={() => void s.run()} />
              <button type="button" class="rs-btn rs-btn-solid" on:click={() => void s.run()}>
                {s.phase().kind === 'error' ? 'Try again' : scanLabel(s.target(), site)}
              </button>
            </div>
          </div>
        </Match>
      </Switch>
    </section>
  );
}

const stopKey = (e: KeyboardEvent) => e.stopPropagation();

const FORMAT_OPTS: Array<{ format: ScanFormat; label: string; title: string }> = [
  { format: 'long', label: 'Videos', title: 'Their long-form videos, scored against their own videos' },
  { format: 'short', label: 'Shorts', title: 'Their Shorts, scored against their own Shorts' },
];

/** The preset sample sizes plus a box for any number up to MAX_CUSTOM_SIZE, or a time window. */
function TargetPicker(props: { store: ProfileStore; onEnter: () => void }) {
  const s = props.store;
  const site = s.site;
  const count = () => {
    const t = s.target();
    return t.kind === 'count' ? t.n : null;
  };
  const days = () => {
    const t = s.target();
    return t.kind === 'days' ? t.days : null;
  };
  const custom = () => count() != null && !isPresetSize(count()!);
  const [draft, setDraft] = createSignal(custom() ? String(count()) : '');
  const take = (text: string) => {
    const n = parseSize(text);
    if (n != null) s.setTarget(countTarget(n));
  };
  return (
    <span class="rs-pick">
      <div class="rs-seg" role="radiogroup" aria-label="Sample size">
        <For each={SIZES}>
          {(n) => (
            <button type="button" role="radio" class="rs-seg-opt" aria-checked={count() === n} on:click={() => s.setTarget(countTarget(n))}>
              {sizeLabel(n)}
            </button>
          )}
        </For>
        <input
          class="rs-seg-opt rs-seg-custom"
          type="number"
          inputmode="numeric"
          min="1"
          max={MAX_CUSTOM_SIZE}
          step="1"
          placeholder="Custom"
          aria-label={`Custom sample size, 1 to ${MAX_CUSTOM_SIZE} ${site.items}`}
          title={`Any number of ${site.items} up to ${MAX_CUSTOM_SIZE}`}
          data-on={custom()}
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
            if (e.key === 'Enter' && parseSize(draft()) != null) props.onEnter();
          }}
          on:keyup={stopKey}
          on:keypress={stopKey}
        />
      </div>
      <span class="rs-pick-or" aria-hidden="true">or</span>
      <div class="rs-seg" role="radiogroup" aria-label="Time window">
        <For each={WINDOWS}>
          {(d) => (
            <button
              type="button"
              role="radio"
              class="rs-seg-opt"
              aria-checked={days() === d}
              aria-label={`Everything from ${windowText(d)}`}
              title={`Every ${site.item} uploaded in ${windowText(d)}`}
              on:click={() => s.setTarget(daysTarget(d))}
            >
              {daysLabel(d)}
            </button>
          )}
        </For>
      </div>
    </span>
  );
}

const SCOPES: BulkScope[] = ['outliers', 'all'];

/** Bulk save: the outliers, or every scanned reel. */
function BulkMenu(props: { store: ProfileStore; onStart: (scope: BulkScope) => void }) {
  const s = props.store;
  const site = s.site;
  const sampled = () => s.scan()?.reels.length ?? 0;
  const partial = () => {
    const sc = s.scan();
    return sc != null && !isWhole(sc.target);
  };
  const cell = (scope: BulkScope) => {
    const label = () => bulkScopeLabel(scope, s.scopeReels(scope).length, s.unsaved(scope).length, s.queued(scope), site);
    return (
      <button
        type="button"
        class="rs-btn rs-tray-go"
        classList={{ 'rs-btn-accent': !label().disabled }}
        disabled={label().disabled}
        on:click={() => props.onStart(scope)}
      >
        {label().text}
      </button>
    );
  };
  return (
    <div class="rs-tray" id="rs-bulk-menu" role="group" aria-label="Save in bulk">
      <div class="rs-tray-grid">
        <span />
        <span class="rs-tray-col">
          Outliers <b>{s.scopeReels('outliers').length}</b>
        </span>
        <span class="rs-tray-col">
          All scanned <b>{sampled()}</b>
        </span>

        <span class="rs-tray-row">
          <b>Library</b>
          <span class="rs-dim">Saved with their stats, channel multiple and video</span>
        </span>
        <For each={SCOPES}>{(scope) => cell(scope)}</For>
      </div>
      <p class="rs-note rs-dim">
        One {site.item} at a time, best multiple first. {site.Items} already saved are skipped.
        <Show when={partial()}>
          {' '}This covers the {sampled()} scanned {site.items}; scan All to reach {site.whole}.
        </Show>
      </p>
    </div>
  );
}

function Stat(props: { label: string; hint: string; children: JSX.Element }) {
  return (
    <div class="rs-stat" title={props.hint}>
      <dt>{props.label}</dt>
      <dd>{props.children}</dd>
    </div>
  );
}

function GridIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true">
      <rect x="2" y="2" width="5" height="5" rx="1" />
      <rect x="9" y="2" width="5" height="5" rx="1" />
      <rect x="2" y="9" width="5" height="5" rx="1" />
      <rect x="9" y="9" width="5" height="5" rx="1" />
    </svg>
  );
}
