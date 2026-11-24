// Multiple badge on a profile-grid tile ("4.2x" against the creator's own
// baseline). Hovering the tile (or focusing it from the keyboard) opens a
// small block of details under it: views, likes, comments, engagement, age.
// The runtime mirrors the tile's hover onto our host as `data-hover`
// (hosts.tsx hoverTarget). Purely visual: pointer-events are off, so the tile
// still opens on click.
import { createMemo, Show, type Accessor } from 'solid-js';
import { compact, longAge, multiple, pct, TIER_LABEL } from '@/lib/format';
import { computeMetrics, postFromScanned } from '@/lib/metrics';
import type { ScoredReel } from '@/lib/types';

export default function GridBadge(props: { reel: Accessor<ScoredReel | undefined>; saved: Accessor<boolean> }) {
  return (
    // Not Show's narrowed accessor: it goes stale when the tier changes but
    // the reel stays defined (threshold changes in the panel).
    <Show when={props.reel()}>
      {(() => {
        const r = () => props.reel()!;
        const m = createMemo(() => computeMetrics(postFromScanned(r())));
        return (
          <span class="rs-badge-wrap">
            <span
              class="rs-badge"
              data-tier={r().tier}
              title={`${multiple(r().multiple)} this creator's baseline · ${TIER_LABEL[r().tier]}${r().early ? ' · under 72h, still climbing' : ''}${props.saved() ? ' · in your library' : ''}`}
            >
              <span class="rs-badge-num">{multiple(r().multiple)}</span>
              <Show when={r().early}>
                <span class="rs-badge-early">early</span>
              </Show>
              <Show when={props.saved()}>
                <svg class="rs-badge-saved" viewBox="0 0 24 24" width="11" height="11" aria-label="In your library">
                  <path d="M5 12.5l4.5 4.5L19 7" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round" />
                </svg>
              </Show>
            </span>
            <span class="rs-badge-more" aria-hidden="true">
              <span class="rs-badge-tier" data-tier={r().tier}>
                {TIER_LABEL[r().tier]}
              </span>
              <span title={r().fromGrid ? 'Rounded, as the grid shows it' : undefined}>
                <b>
                  {r().fromGrid ? '≈' : ''}
                  {compact(m().views)}
                </b>{' '}
                views
              </span>
              <Show when={m().likes != null}>
                <span>
                  <b>{compact(m().likes)}</b> likes
                </span>
              </Show>
              <Show when={m().comments != null}>
                <span>
                  <b>{compact(m().comments)}</b> comments
                </span>
              </Show>
              <Show when={m().engagementRate != null}>
                <span>
                  <b>{pct(m().engagementRate)}</b> eng.
                </span>
              </Show>
              <Show when={m().ageHours != null}>
                <span>
                  <b>
                    {r().dateEstimated ? '≈' : ''}
                    {longAge(m().ageHours)}
                  </b>{' '}
                  old
                </span>
              </Show>
            </span>
          </span>
        );
      })()}
    </Show>
  );
}
