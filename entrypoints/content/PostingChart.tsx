// When a creator uploads: uploads per weekday and per two-hour block of the
// day, in the viewer's time zone (lib/outliers.ts cadence). Plain bars; the
// busiest in full ink, nothing in marigold (that is for outliers).
import { For } from 'solid-js';

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
/** Monday first. */
const WEEK = [1, 2, 3, 4, 5, 6, 0];
/** Hours per bar: one hour of a small sample is noise. */
const BLOCK = 2;

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;
const blockLabel = (b: number) => `${b * BLOCK}–${(b + 1) * BLOCK}h`;

/** Uploads per BLOCK-hour block, from per-hour counts. */
const blocks = (byHour: number[]) =>
  Array.from({ length: 24 / BLOCK }, (_, b) => byHour.slice(b * BLOCK, (b + 1) * BLOCK).reduce((x, y) => x + y, 0));

/** Indexes holding the largest count (several on a tie; none when all are 0). */
function tops(counts: number[]): number[] {
  const max = Math.max(0, ...counts);
  return max === 0 ? [] : counts.flatMap((n, i) => (n === max ? [i] : []));
}

/** The weekday with the most uploads ("Tue", or "Tue/Fri" on a two-way tie), or null. */
export function busiestDay(byWeekday: number[] | null): { label: string; n: number } | null {
  if (!byWeekday) return null;
  const top = WEEK.filter((d) => tops(byWeekday).includes(d));
  if (top.length === 0 || top.length > 2) return null;
  return { label: top.map((d) => DAY_NAMES[d]).join('/'), n: byWeekday[top[0]!]! };
}

/** The two-hour block with the most uploads ("18–20h"; the earliest on a tie), or null. */
export function busiestHour(byHour: number[] | null): { label: string; n: number } | null {
  if (!byHour) return null;
  const counts = blocks(byHour);
  const top = tops(counts);
  if (top.length === 0 || top.length > 2) return null;
  return { label: blockLabel(top[0]!), n: counts[top[0]!]! };
}

function Bars(props: { counts: number[]; names: string[]; what: string }) {
  const max = () => Math.max(1, ...props.counts);
  const top = () => tops(props.counts);
  return (
    <div class="op-rhythm-bars">
      <For each={props.counts}>
        {(n, i) => (
          <span
            class="op-rhythm-bar"
            classList={{ 'is-top': top().includes(i()), 'is-zero': n === 0 }}
            style={{ height: `${(n / max()) * 100}%` }}
            title={`${props.names[i()]}: ${plural(n, props.what)}`}
          />
        )}
      </For>
    </div>
  );
}

export default function PostingChart(props: { byWeekday: number[]; byHour: number[] }) {
  return (
    <div class="op-rhythm">
      <figure class="op-rhythm-part op-rhythm-week">
        <figcaption>By weekday</figcaption>
        <Bars counts={WEEK.map((d) => props.byWeekday[d]!)} names={WEEK.map((d) => DAY_NAMES[d]!)} what="upload" />
        <div class="op-rhythm-axis">
          <For each={WEEK}>{(d) => <span>{DAY_NAMES[d]!.slice(0, 1)}</span>}</For>
        </div>
      </figure>
      <figure class="op-rhythm-part op-rhythm-day">
        <figcaption>By hour, your time</figcaption>
        <Bars counts={blocks(props.byHour)} names={blocks(props.byHour).map((_, b) => blockLabel(b))} what="upload" />
        <div class="op-rhythm-axis op-rhythm-hours">
          <span>0h</span>
          <span>6h</span>
          <span>12h</span>
          <span>18h</span>
        </div>
      </figure>
    </div>
  );
}
