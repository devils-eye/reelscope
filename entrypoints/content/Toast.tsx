// Save feedback, top-centre (the bottom-right corner belongs to Instagram's
// Messages bar). Says exactly which reel was saved: author, caption, stats.
import { createEffect, onCleanup, Show, type Accessor } from 'solid-js';
import { age, compact, multiple, OUTLIER_RATIO, ratio } from '@/lib/format';
import { CheckIcon, Spinner } from './icons';
import type { SaveController, ToastMsg } from './saves';
import { site } from './site';
import type { Theme } from './theme';

const HIDE_MS: Record<ToastMsg['kind'], number> = { saving: 20000, saved: 6000, queued: 5000, error: 6000 };

export default function Toast(props: { saves: SaveController; theme: Accessor<Theme> }) {
  createEffect(() => {
    const t = props.saves.toast();
    if (!t) return;
    const timer = setTimeout(() => {
      if (props.saves.toast()?.id === t.id) props.saves.dismissToast();
    }, HIDE_MS[t.msg.kind]);
    onCleanup(() => clearTimeout(timer));
  });

  return (
    <Show when={props.saves.toast()} keyed>
      {(t) => (
        <div class="rs-toast" data-kind={t.msg.kind} data-theme={props.theme()} role="status" aria-live="polite">
          <Body msg={t.msg} />
          <button type="button" class="rs-toast-x" onClick={() => props.saves.dismissToast()} aria-label="Dismiss">
            <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
              <path d="M3.5 3.5l9 9m0-9l-9 9" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" />
            </svg>
          </button>
        </div>
      )}
    </Show>
  );
}

function Body(props: { msg: ToastMsg }) {
  const m = props.msg;
  switch (m.kind) {
    case 'saving':
      return (
        <div class="rs-toast-row">
          <Spinner />
          <span class="rs-toast-dim">
            Saving {site.video} {m.code}…
          </span>
        </div>
      );
    case 'queued':
      return (
        <div class="rs-toast-row">
          <b class="rs-toast-warn">Queued</b>
          <span class="rs-toast-dim">
            Library server is offline. {site.Video} {m.code} saves when it's back.
          </span>
        </div>
      );
    case 'error':
      return (
        <div class="rs-toast-row">
          <b class="rs-toast-bad">Not saved</b>
          <span class="rs-toast-dim">{m.message}</span>
        </div>
      );
    case 'saved': {
      const r = m.row;
      const cap = (r.caption ?? '').split('\n')[0]?.trim() ?? '';
      const vpf = r.views_per_follower;
      return (
        <>
          <div class="rs-toast-row">
            <span class="rs-toast-ok">
              <CheckIcon size={14} />
              {m.isNew ? 'Saved' : 'Updated'}
            </span>
            <span class="rs-toast-who">@{r.author_username}</span>
            <Show when={cap}>
              <span class="rs-toast-cap">{cap}</span>
            </Show>
          </div>
          <div class="rs-toast-stats">
            <Stat v={compact(r.latest_views)} l="views" />
            <Stat v={compact(r.latest_like_count)} l="likes" />
            <Stat v={compact(r.latest_comment_count)} l="comments" />
            <Stat v={ratio(vpf)} l={`of ${site.followers}`} hot={vpf != null && vpf >= OUTLIER_RATIO} />
            <Show when={r.channel_multiple != null}>
              <Stat v={multiple(r.channel_multiple)} l="their baseline" hot={(r.channel_multiple ?? 0) >= 2} />
            </Show>
            <Stat v={age(r.age_hours)} l="old" />
          </div>
        </>
      );
    }
  }
}

function Stat(props: { v: string; l: string; hot?: boolean }) {
  return (
    <span class="rs-toast-stat" classList={{ 'is-hot': props.hot }}>
      <b>{props.v}</b> {props.l}
    </span>
  );
}
