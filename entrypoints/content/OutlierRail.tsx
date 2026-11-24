// Outliers-only rail: the creator's outliers, best multiple first, in the
// space freed beside Instagram's (shifted) profile column. Same rows and
// save state as the side panel; "Save all" at the top.
import { createMemo, For, Show } from 'solid-js';
import { tierVars } from '@/lib/format';
import type { ScoredReel } from '@/lib/types';
import { outliersByMultiple, type ProfileStore } from './profileStore';
import type { RailGeom } from './railLayout';
import ReelRow from './ReelRow';
import type { SaveController } from './saves';
import { bulkProgressText, bulkSummaryText, saveAllLabel } from './scanCopy';
import type { Theme } from './theme';

export default function OutlierRail(props: {
  store: ProfileStore;
  geom: RailGeom;
  saves: SaveController;
  theme: Theme;
  onOpen: (r: ScoredReel, list: ScoredReel[]) => void;
}) {
  const s = props.store;
  const outliers = createMemo(() => outliersByMultiple(s));
  const label = () => saveAllLabel(outliers().length, s.unsavedOutliers().length, s.queuedOutliers());
  return (
    <aside
      class="op-panel op-rail"
      data-theme={props.theme}
      style={{
        ...tierVars(props.theme),
        left: `${props.geom.left}px`,
        top: `${props.geom.top}px`,
        width: `${props.geom.width}px`,
        'max-height': `${props.geom.maxHeight}px`,
      }}
      aria-label={`Outliers of @${s.username}`}
    >
      <header class="op-rail-top">
        <div class="op-rail-head">
          <span class="op-title">Outliers</span>
          <span class="op-rail-n op-num">{outliers().length}</span>
          <span class="op-rail-sub op-dim">by multiple</span>
        </div>
        <Show
          when={s.bulk()}
          fallback={
            <button
              type="button"
              class="op-btn op-btn-sm op-rail-save"
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
            <div class="op-rail-bulk" aria-live="polite">
              <span class="op-rail-bulk-text">{bulkProgressText(b())}</span>
              <span class="op-rail-bar">
                <span style={{ width: `${(b().done / b().total) * 100}%` }} />
              </span>
              <button type="button" class="op-btn op-btn-sm" onClick={() => s.stopBulk()}>
                Cancel
              </button>
            </div>
          )}
        </Show>
        <Show when={s.bulkSummary()}>
          {(sum) => (
            <p class="op-rail-sum" classList={{ 'is-bad': sum().failed > 0, 'is-warn': !sum().failed && sum().queued > 0 }}>
              {bulkSummaryText(sum())}
            </p>
          )}
        </Show>
      </header>
      <ul class="op-list op-rail-list">
        <For each={outliers()}>
          {(r) => (
            <ReelRow
              r={r}
              saves={props.saves}
              site={s.site}
              busy={s.bulk() != null}
              onSave={(x) => void s.saveOne(x)}
              onOpen={(x, e) => {
                if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return; // new tab, as usual
                e.preventDefault();
                props.onOpen(x, outliers());
              }}
              compact
            />
          )}
        </For>
      </ul>
    </aside>
  );
}
