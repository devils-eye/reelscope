// Floating progress while a scan scrolls the profile strip out of view:
// what is happening, how far along, and Stop. Top-centre like the toast.
import type { Accessor } from 'solid-js';
import { Glyph } from './icons';
import type { ProfileStore } from './profileStore';
import { ofSize, progressPct, stageText } from './scanCopy';
import type { Theme } from './theme';

export default function ScanPill(props: { store: ProfileStore; theme: Accessor<Theme> }) {
  const s = props.store;
  const site = s.site;
  const p = () => {
    const ph = s.phase();
    return ph.kind === 'running' ? ph : { count: 0, stage: 'opening' as const };
  };
  const pct = () => progressPct(p().count, s.target());
  return (
    <div class="rs-pill" data-theme={props.theme()} role="status" aria-live="polite" aria-label={`Scanning @${s.username}`}>
      <Glyph size={16} />
      <span class="rs-pill-text">{stageText(p().stage, site)}</span>
      <span class="rs-pill-num">
        <b>{p().count}</b>
        {ofSize(s.target())} {site.items}
      </span>
      <button
        type="button"
        class="rs-pill-stop"
        disabled={p().stage === 'reading'}
        title={site.stopTitle}
        onClick={() => s.stop()}
      >
        Stop
      </button>
      <span class="rs-pill-bar" classList={{ 'is-open': pct() === null }} aria-hidden="true">
        <span style={{ width: `${pct() ?? 100}%` }} />
      </span>
    </div>
  );
}
