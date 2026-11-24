// YouTube: the channel's outliers on their own, as a grid of thumbnails over
// the page. Opened from the strip's "View outliers"; a card opens the video
// in a new tab, so the channel page (and this grid) stay where they are.
// Same scan, save state and "Save all" as the strip.
import { createMemo, createSignal, For, onCleanup, onMount, Show } from 'solid-js';
import { compact, multiple, TIER_LABEL, tierVars } from '@/lib/format';
import type { ScoredReel } from '@/lib/types';
import { outliersByMultiple, type ProfileStore } from './profileStore';
import { ageText } from './ReelRow';
import type { SaveController, SaveState } from './saves';
import { bulkProgressText, bulkSummaryText, saveAllLabel } from './scanCopy';
import type { Theme } from './theme';

type Sort = 'multiple' | 'views' | 'newest';
const SORTS: Array<{ id: Sort; label: string; title: string }> = [
  { id: 'multiple', label: 'Multiple', title: 'Furthest above their usual views first' },
  { id: 'views', label: 'Views', title: 'Most views first' },
  { id: 'newest', label: 'Newest', title: 'Newest upload first' },
];
const FOCUSABLE = 'button:not(:disabled), a[href], [tabindex]:not([tabindex="-1"])';

function duration(sec: number | undefined): string | null {
  if (sec == null || !Number.isFinite(sec) || sec <= 0) return null;
  const s = Math.round(sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

export default function OutlierGrid(props: {
  store: ProfileStore;
  saves: SaveController;
  theme: Theme;
  onOpen: (r: ScoredReel) => void;
  onClose: () => void;
}) {
  const s = props.store;
  const site = s.site;
  const [sort, setSort] = createSignal<Sort>('multiple');
  const outliers = createMemo(() => outliersByMultiple(s));
  const shown = createMemo(() => {
    const list = [...outliers()];
    if (sort() === 'views') list.sort((a, b) => b.views - a.views);
    else if (sort() === 'newest') list.sort((a, b) => a.ageDays - b.ageDays);
    return list;
  });
  const label = () => saveAllLabel(outliers().length, s.unsavedOutliers().length, s.queuedOutliers());
  const stateOf = (code: string) => props.saves.state(code).kind;
  const savedCount = () => outliers().filter((r) => stateOf(r.shortcode) === 'saved').length;
  const baseline = () => s.analysis()?.stats.baselineViews ?? 0;
  let dialog!: HTMLDivElement;

  // Keys: ours first; nothing reaches YouTube's shortcuts while the grid is open.
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') props.onClose();
    else if (e.key === 'Tab') trapTab(e.shiftKey);
    else return;
    e.preventDefault();
    e.stopImmediatePropagation();
  };
  const stopBubble = (e: Event) => e.stopPropagation();
  function trapTab(back: boolean) {
    const els = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE));
    if (els.length === 0) return;
    const active = (dialog.getRootNode() as ShadowRoot | Document).activeElement as HTMLElement | null;
    const at = active ? els.indexOf(active) : -1;
    const next = back ? (at <= 0 ? els.length - 1 : at - 1) : at === -1 || at === els.length - 1 ? 0 : at + 1;
    els[next]!.focus();
  }

  onMount(() => {
    window.addEventListener('keydown', onKey, { capture: true });
    dialog.addEventListener('keydown', stopBubble);
    dialog.addEventListener('keyup', stopBubble);
    const html = document.documentElement;
    const body = document.body;
    const saved = [html.style.overflow, body.style.overflow];
    html.style.overflow = 'hidden';
    body.style.overflow = 'hidden';
    dialog.querySelector<HTMLElement>('.op-og-close')?.focus();
    onCleanup(() => {
      window.removeEventListener('keydown', onKey, { capture: true });
      html.style.overflow = saved[0]!;
      body.style.overflow = saved[1]!;
    });
  });

  return (
    <div class="op-lb-backdrop op-og-backdrop" data-theme={props.theme} onClick={(e) => e.target === e.currentTarget && props.onClose()}>
      <div
        ref={dialog}
        class="op-panel op-og"
        classList={{ 'op-og-wide': site.format === 'long' }}
        data-theme={props.theme}
        style={tierVars(props.theme)}
        role="dialog"
        aria-modal="true"
        aria-label={`Outliers of @${s.username}`}
      >
        <header class="op-og-top">
          <div class="op-og-head">
            <span class="op-title">Outliers</span>
            <span class="op-og-n op-num">{outliers().length}</span>
            <span class="op-kind">{site.Items}</span>
            <a class="op-og-who op-dim" href={site.profileUrl(s.username)} target="_blank" rel="noopener">
              @{s.username}
            </a>
          </div>
          <p class="op-og-sub op-dim">
            <Show when={baseline() > 0}>
              Their usual {site.item} gets <b class="op-num">{compact(baseline())}</b> views.{' '}
            </Show>
            Click a {site.item} to open it in a new tab.
            <Show when={savedCount() > 0}>
              {' '}
              {savedCount()} saved.
            </Show>
          </p>
          <div class="op-og-tools">
            <span class="op-seg" role="radiogroup" aria-label="Sort">
              <For each={SORTS}>
                {(o) => (
                  <button
                    type="button"
                    role="radio"
                    class="op-seg-opt"
                    aria-checked={sort() === o.id}
                    title={o.title}
                    onClick={() => setSort(o.id)}
                  >
                    {o.label}
                  </button>
                )}
              </For>
            </span>
            <Show
              when={s.bulk()}
              fallback={
                <button
                  type="button"
                  class="op-btn op-btn-sm"
                  classList={{ 'op-btn-accent': !label().disabled }}
                  disabled={label().disabled}
                  title="Save every outlier to your library, one at a time"
                  onClick={() => void s.saveAll()}
                >
                  {label().text}
                </button>
              }
            >
              {(b) => (
                <span class="op-og-bulk" aria-live="polite">
                  <span>{bulkProgressText(b())}</span>
                  <span class="op-rail-bar">
                    <span style={{ width: `${(b().done / b().total) * 100}%` }} />
                  </span>
                  <button type="button" class="op-btn op-btn-sm" onClick={() => s.stopBulk()}>
                    Cancel
                  </button>
                </span>
              )}
            </Show>
            <button type="button" class="op-icon op-og-close" aria-label="Close (Esc)" title="Close (Esc)" onClick={() => props.onClose()}>
              <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
                <path d="M3.5 3.5l9 9m0-9l-9 9" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
              </svg>
            </button>
          </div>
          <Show when={s.bulkSummary()}>
            {(sum) => (
              <p class="op-rail-sum" classList={{ 'is-bad': sum().failed > 0, 'is-warn': !sum().failed && sum().queued > 0 }}>
                {bulkSummaryText(sum())}
              </p>
            )}
          </Show>
        </header>

        <div class="op-og-scroll">
          <Show
            when={shown().length > 0}
            fallback={<p class="op-og-empty op-dim">No outliers in this scan. Rescan with a bigger sample to look further back.</p>}
          >
            <ul class="op-og-grid">
              <For each={shown()}>{(r) => <Card r={r} store={s} state={() => stateOf(r.shortcode)} onOpen={props.onOpen} />}</For>
            </ul>
          </Show>
        </div>
      </div>
    </div>
  );
}

const LABEL: Record<string, string> = { idle: 'Save', saving: 'Saving…', saved: 'Saved', queued: 'Queued', error: 'Retry' };

function Card(props: { r: ScoredReel; store: ProfileStore; state: () => SaveState['kind']; onOpen: (r: ScoredReel) => void }) {
  const r = props.r;
  const site = props.store.site;
  const state = props.state;
  const title = (r.caption ?? '').split('\n')[0]?.trim() ?? '';
  const age = () => (r.dateEstimated ? `~${ageText(r.ageDays)}` : ageText(r.ageDays));
  const len = duration(r.durationSec);
  return (
    <li class="op-og-card" data-tier={r.tier}>
      <a
        class="op-og-link"
        href={r.url}
        target="_blank"
        rel="noopener"
        title={`${title || `Open ${site.item}`} (opens in a new tab)`}
        onClick={(e) => {
          if (e.button !== 0) return; // middle-click: the browser's own new tab
          e.preventDefault();
          props.onOpen(r);
        }}
      >
        <span class="op-og-thumb">
          <Show when={r.thumbnailUrl} fallback={<span class="op-thumb-ph" />}>
            <img src={r.thumbnailUrl} alt="" loading="lazy" referrerpolicy="no-referrer" onError={(e) => e.currentTarget.remove()} />
          </Show>
          {/* The chip is dark in both themes, so it takes the dark theme's tier colours. */}
          <span
            class="op-og-mult op-mult ct"
            data-tier={r.tier}
            style={tierVars('dark')}
            title={`${TIER_LABEL[r.tier]}: ${multiple(r.multiple)} their usual views`}
          >
            {multiple(r.multiple)}
          </span>
          <Show when={len}>
            <span class="op-og-len op-num">{len}</span>
          </Show>
          <Show when={r.early}>
            <span class="op-og-early" title="Under 72h old: views still climbing">
              Early
            </span>
          </Show>
        </span>
        <span class="op-og-title">{title || <span class="op-faint">Untitled</span>}</span>
        <span class="op-og-meta">
          <span>
            <b class="op-num">{compact(r.views)}</b> views
          </span>
          <span title={r.dateEstimated ? site.estimatedTitle : undefined}>{age()} ago</span>
          <span class="op-og-tier">{TIER_LABEL[r.tier]}</span>
        </span>
      </a>
      <button
        type="button"
        class="op-og-save"
        data-state={state()}
        disabled={state() === 'saving' || state() === 'saved' || props.store.bulk() != null}
        onClick={() => void props.store.saveOne(r)}
        title={
          state() === 'saved'
            ? 'In your library'
            : state() === 'queued'
              ? 'Queued: the server is offline, it saves when it is back'
              : state() === 'error'
                ? 'Save failed. Try again'
                : 'Save to library with its channel multiple'
        }
        aria-label={state() === 'saved' ? 'Saved' : `Save ${title || site.item}`}
      >
        {LABEL[state()] ?? LABEL.idle}
      </button>
    </li>
  );
}
