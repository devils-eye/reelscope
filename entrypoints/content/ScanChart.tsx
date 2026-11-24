// Views over time on a log scale: one dot per reel, the creator's baseline as
// a line and the outlier threshold as a dashed line. Hand-rolled SVG.
import { createMemo, For, Show } from 'solid-js';
import { compact, multiple } from '@/lib/format';
import type { ScoredReel } from '@/lib/types';
import { site } from './site';

const W = 408;
const H = 172;
const PAD = { l: 36, r: 40, t: 12, b: 22 };

function shortDate(t: number): string {
  return new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/** 1-2-5 ticks inside [lo, hi] (log10 units), thinned to at most 5. */
function logTicks(lo: number, hi: number): number[] {
  const out: number[] = [];
  for (let e = Math.floor(lo); e <= Math.ceil(hi); e++) {
    for (const m of [1, 2, 5]) {
      const v = Math.log10(m) + e;
      if (v >= lo && v <= hi) out.push(v);
    }
  }
  if (out.length <= 5) return out;
  const decades = out.filter((v) => Math.abs(v - Math.round(v)) < 1e-9);
  return decades.length >= 2 ? decades : out.filter((_, i) => i % 2 === 0);
}

export default function ScanChart(props: {
  reels: ScoredReel[];
  baseline: number;
  threshold: number;
  onOpen: (r: ScoredReel, e: MouseEvent) => void;
  /** What one dot is ("reel", "Short", "video"); the page's word by default. */
  item?: string;
}) {
  const model = createMemo(() => {
    const pts = props.reels
      .map((r) => ({ r, t: Date.parse(r.takenAt) }))
      .filter((p) => p.r.views > 0 && Number.isFinite(p.t));
    if (pts.length === 0) return null;
    const estimated = pts.filter((p) => p.r.dateEstimated).length > pts.length / 2;

    const base = props.baseline > 0 ? props.baseline : null;
    const thr = base ? base * props.threshold : null;
    const vs = pts.map((p) => Math.log10(p.r.views));
    if (base) vs.push(Math.log10(base));
    if (thr) vs.push(Math.log10(thr));
    let lo = Math.min(...vs);
    let hi = Math.max(...vs);
    const span = Math.max(hi - lo, 0.5);
    lo -= span * 0.08;
    hi += span * 0.1;

    let t0 = Math.min(...pts.map((p) => p.t));
    let t1 = Math.max(...pts.map((p) => p.t));
    if (t1 - t0 < 86400000) {
      t0 -= 86400000;
      t1 += 86400000;
    }

    const x = (t: number) => PAD.l + ((t - t0) / (t1 - t0)) * (W - PAD.l - PAD.r);
    const y = (v: number) => PAD.t + (1 - (Math.log10(v) - lo) / (hi - lo)) * (H - PAD.t - PAD.b);

    // Quiet dots first so outliers paint on top.
    const order = [...pts].sort((a, b) => Number(a.r.isOutlier) - Number(b.r.isOutlier) || a.r.multiple - b.r.multiple);
    return {
      dots: order.map((p) => ({ r: p.r, cx: x(p.t), cy: y(p.r.views) })),
      ticks: logTicks(lo, hi).map((v) => ({ y: y(10 ** v), label: compact(10 ** v) })),
      baseY: base ? y(base) : null,
      thrY: thr ? y(thr) : null,
      // Estimated dates only order the dots; don't print them as real ones.
      from: estimated ? 'older' : shortDate(t0),
      to: estimated ? 'newer' : shortDate(t1),
    };
  });

  return (
    <Show when={model()}>
      {(m) => (
        <svg class="op-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Views per ${props.item ?? site.item} over time, log scale`}>
          <For each={m().ticks}>
            {(tk) => (
              <>
                <line class="op-grid" x1={PAD.l} x2={W - PAD.r} y1={tk.y} y2={tk.y} />
                <text class="op-axis" x={PAD.l - 6} y={tk.y + 3.5} text-anchor="end">
                  {tk.label}
                </text>
              </>
            )}
          </For>
          <text class="op-axis" x={PAD.l} y={H - 6}>
            {m().from}
          </text>
          <text class="op-axis" x={W - PAD.r} y={H - 6} text-anchor="end">
            {m().to}
          </text>

          <Show when={m().thrY != null}>
            <line class="op-thr" x1={PAD.l} x2={W - PAD.r} y1={m().thrY!} y2={m().thrY!} />
            <text class="op-line-label op-thr-label" x={W - PAD.r + 6} y={Math.min(m().thrY! + 3.5, (m().baseY ?? Infinity) - 9)}>
              {multiple(props.threshold)}
            </text>
          </Show>
          <Show when={m().baseY != null}>
            <line class="op-base" x1={PAD.l} x2={W - PAD.r} y1={m().baseY!} y2={m().baseY!} />
            <text class="op-line-label" x={W - PAD.r + 6} y={m().baseY! + 3.5}>
              {compact(props.baseline)}
            </text>
          </Show>

          <For each={m().dots}>
            {(d) => (
              <circle
                class="op-dot"
                classList={{ 'is-early': d.r.early }}
                data-tier={d.r.tier}
                cx={d.cx}
                cy={d.cy}
                r={d.r.isOutlier ? 4.2 : 3}
                onClick={(e) => props.onOpen(d.r, e)}
                onAuxClick={(e) => e.button === 1 && props.onOpen(d.r, e)}
              >
                <title>
                  {`${multiple(d.r.multiple)} · ${compact(d.r.views)} views · ${d.r.dateEstimated ? '~' : ''}${shortDate(Date.parse(d.r.takenAt))}${d.r.early ? ' · early' : ''}`}
                </title>
              </circle>
            )}
          </For>
        </svg>
      )}
    </Show>
  );
}
