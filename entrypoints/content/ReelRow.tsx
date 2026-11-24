// One scored reel as a list row: thumbnail, multiple, views, age and a save
// button bound to the shared save state. Used by the side panel (full rows
// with caption and badges) and the outlier rail (compact).
import { Match, Show, Switch } from 'solid-js';
import { compact, multiple, pct, TIER_LABEL } from '@/lib/format';
import type { ScoredReel } from '@/lib/types';
import type { SaveController } from './saves';
import { site as pageSite, type Site } from './site';

export function ageText(days: number): string {
  if (!Number.isFinite(days) || days <= 0) return '–';
  if (days < 1) return `${Math.max(1, Math.round(days * 24))}h`;
  if (days < 21) return `${Math.round(days)}d`;
  if (days < 120) return `${Math.round(days / 7)}w`;
  return `${Math.round(days / 30.4)}mo`;
}

export default function ReelRow(props: {
  r: ScoredReel;
  saves: SaveController;
  /** A bulk save is running: single saves wait. */
  busy: boolean;
  onSave: (r: ScoredReel) => void;
  /** Open the reel; default is a new tab via the link. */
  onOpen?: (r: ScoredReel, e: MouseEvent) => void;
  compact?: boolean;
  /** The scan's words (long YouTube videos get a landscape thumbnail); the page's by default. */
  site?: Site;
}) {
  const r = props.r;
  const site = props.site ?? pageSite;
  const state = () => props.saves.state(r.shortcode).kind;
  const caption = (r.caption ?? '').split('\n')[0]?.trim() ?? '';
  const age = () => (r.dateEstimated ? `~${ageText(r.ageDays)}` : ageText(r.ageDays));
  return (
    <li class="op-row" classList={{ 'op-row-compact': props.compact, 'op-row-wide': site.format === 'long' }} data-tier={r.tier}>
      <a
        class="op-row-main"
        href={r.url}
        target="_blank"
        rel="noopener"
        title={props.onOpen ? `Open ${site.item}` : `Open ${site.item} in a new tab`}
        onClick={(e) => props.onOpen?.(r, e)}
      >
        <span class="op-thumb">
          <Show when={r.thumbnailUrl} fallback={<span class="op-thumb-ph" />}>
            <img src={r.thumbnailUrl} alt="" loading="lazy" referrerpolicy="no-referrer" onError={(e) => e.currentTarget.remove()} />
          </Show>
        </span>
        <span class="op-mult-cell">
          <span class="op-mult ct" data-tier={r.tier}>
            {multiple(r.multiple)}
          </span>
          <span class="op-tier-label">{TIER_LABEL[r.tier]}</span>
        </span>
        <span class="op-row-body">
          <Show when={!props.compact}>
            <span class="op-cap">{caption || <span class="op-faint">No caption</span>}</span>
          </Show>
          <span class="op-meta">
            <span>
              <b>{compact(r.views)}</b> views
            </span>
            <span title={r.dateEstimated ? site.estimatedTitle : undefined}>{age()}</span>
            <Show when={!props.compact}>
              <span title="(likes + comments) ÷ views">{pct(r.engagementRate)} eng</span>
            </Show>
          </span>
          <Show when={props.compact && r.early}>
            <span class="op-badges">
              <span class="op-badge op-badge-early" title="Under 72h old: views still climbing">Early</span>
            </span>
          </Show>
          <Show when={!props.compact && (r.early || r.pinned || r.commentBait)}>
            <span class="op-badges">
              <Show when={r.early}>
                <span class="op-badge op-badge-early" title="Under 72h old: views still climbing">Early</span>
              </Show>
              <Show when={r.pinned}>
                <span class="op-badge" title="Pinned to the top of the grid">Pinned</span>
              </Show>
              <Show when={r.commentBait}>
                <span class="op-badge" title="Caption asks for a keyword comment, DM or bio click">Comment bait</span>
              </Show>
            </span>
          </Show>
        </span>
      </a>
      <button
        type="button"
        class="op-save"
        data-state={state()}
        disabled={state() === 'saving' || state() === 'saved' || props.busy}
        onClick={() => props.onSave(r)}
        title={
          state() === 'saved'
            ? 'In your library'
            : state() === 'queued'
              ? 'Queued: the server is offline, it saves when it is back'
              : state() === 'error'
                ? 'Save failed. Try again'
                : 'Save to library with its channel multiple'
        }
        aria-label={state() === 'saved' ? 'Saved' : `Save ${site.item}`}
      >
        <Switch fallback={<BookmarkIcon />}>
          <Match when={state() === 'saving'}>
            <span class="op-spin" />
          </Match>
          <Match when={state() === 'saved'}>
            <CheckIcon />
          </Match>
          <Match when={state() === 'queued'}>
            <span class="op-save-txt">Queued</span>
          </Match>
          <Match when={state() === 'error'}>
            <span class="op-save-txt">Retry</span>
          </Match>
        </Switch>
      </button>
    </li>
  );
}

function BookmarkIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
      stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"
      stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M5 12.5l4.5 4.5L19 7" />
    </svg>
  );
}
