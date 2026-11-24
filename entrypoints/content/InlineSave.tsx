// The Save and Stats buttons injected into each post's own action row, so it
// is obvious which reel they act on. Rendered in its own small shadow root
// (see runtime.tsx / ytRuntime.tsx). The `.rs-pair` wrapper is the slot for
// everything that sits next to a post's actions. Stats opens the post's
// stats card, which renders in the body-level overlay (StatsCard.tsx).
// Native `on:` listeners, not Solid's delegated ones: Instagram's React root
// can stop propagation before an event reaches `document`.
import { Match, Switch, type Accessor } from 'solid-js';
import { age, compact, ratio } from '@/lib/format';
import { CheckIcon, Glyph, Spinner, StatsIcon } from './icons';
import type { SaveController, SaveState } from './saves';
import { site } from './site';
import { STATS_KEY, type StatsControl } from './statsState';
import type { Theme } from './theme';

export type SaveVariant = 'pill' | 'stack' | 'overlay';

const LABEL: Record<SaveState['kind'], string> = {
  idle: 'Save',
  saving: 'Saving',
  saved: 'Saved',
  queued: 'Queued',
  error: 'Retry',
};

function titleFor(st: SaveState): string {
  switch (st.kind) {
    case 'idle':
      return `Save this ${site.video} to your ReelScope library (Alt+S)`;
    case 'saving':
      return 'Saving to your ReelScope library…';
    case 'queued':
      return 'Queued: the library server is offline. It saves when the server is back.';
    case 'error':
      return `Save failed: ${st.message}. Click to try again.`;
    case 'saved': {
      const r = st.row;
      if (!r) return 'In your ReelScope library. Click to add a fresh stats snapshot.';
      return (
        `${st.isNew ? 'Saved' : 'Updated'} @${r.author_username}: ${compact(r.latest_views)} views, ` +
        `${compact(r.latest_like_count)} likes, ${compact(r.latest_comment_count)} comments, ` +
        `${ratio(r.views_per_follower)} ${site.followers}, ${age(r.age_hours)} old. Click to add a fresh snapshot.`
      );
    }
  }
}

export default function InlineSave(props: {
  code: Accessor<string | null>;
  variant: SaveVariant;
  saves: SaveController;
  theme: Accessor<Theme>;
  /** The stats card control; left out, no Stats button. */
  stats?: StatsControl;
}) {
  const st = (): SaveState => {
    const c = props.code();
    return c ? props.saves.state(c) : { kind: 'idle' };
  };
  const stack = () => props.variant === 'stack';
  const click = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (st().kind === 'saving') return;
    const c = props.code();
    if (!c) props.saves.showToast({ kind: 'error', code: null, message: "Can't tell which reel this is yet" });
    else void props.saves.save(c, { toast: true });
  };

  let statsBtn: HTMLButtonElement | undefined;
  const statsOpen = () => !!statsBtn && props.stats?.target()?.anchor === statsBtn;
  const clickStats = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const c = props.code();
    if (!c) props.saves.showToast({ kind: 'error', code: null, message: `Can't tell which ${site.video} this is yet` });
    else props.stats?.toggle(c, statsBtn ?? null, props.variant);
  };

  return (
    <span class="rs-pair" data-variant={props.variant} data-theme={props.theme()} data-site={site.platform}>
      <button
        type="button"
        class="rs-save"
        data-variant={props.variant}
        data-state={st().kind}
        data-theme={props.theme()}
        title={titleFor(st())}
        aria-label={st().kind === 'saved' ? 'Saved to ReelScope library. Save a fresh snapshot' : `Save ${site.video} to ReelScope library`}
        aria-busy={st().kind === 'saving'}
        on:click={click}
      >
        <span class="rs-save-ico">
          <Switch fallback={<Glyph size={stack() ? 22 : 16} />}>
            <Match when={st().kind === 'saving'}>
              <Spinner />
            </Match>
            <Match when={st().kind === 'saved'}>
              <CheckIcon size={stack() ? 20 : 15} />
            </Match>
          </Switch>
        </span>
        <span class="rs-save-lbl">{st().kind !== 'idle' ? LABEL[st().kind] : stack() ? 'Save' : site.saveLabel}</span>
      </button>
      {props.stats && (
        <button
          ref={statsBtn}
          type="button"
          class="rs-save rs-statbtn"
          data-variant={props.variant}
          data-theme={props.theme()}
          title={`Stats: the numbers ${site.name} hides for this ${site.video} (${STATS_KEY.label})`}
          aria-label={`Stats for this ${site.video}`}
          aria-haspopup="dialog"
          aria-expanded={statsOpen()}
          on:click={clickStats}
        >
          <span class="rs-save-ico">
            <StatsIcon size={stack() ? 20 : 15} />
          </span>
          <span class="rs-save-lbl">Stats</span>
        </button>
      )}
    </span>
  );
}
