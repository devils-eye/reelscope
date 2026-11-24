// In-page player for a scanned reel when Instagram's own modal isn't
// reachable (its grid tile is gone from the DOM): the video from the item the
// page loaded, the numbers, Save, and ←/→ through the list it was opened
// from. When the page never loaded the reel (a stored scan, or an old reel
// the grid dropped) or its signed CDN URL has expired, it asks /media/info
// once (rate-limited, see lib/capture.ts); only if that fails too does it show
// Instagram's embed of the reel. Never opens a tab. Instagram only: on
// YouTube a scanned Short opens in YouTube's own player (ytRuntime.tsx).
import { createEffect, createSignal, Match, on, onCleanup, onMount, Show, Switch } from 'solid-js';
import { compact, multiple, TIER_LABEL, tierVars } from '@/lib/format';
import { str } from '@/lib/instagram';
import { pickThumbUrl, pickVideoUrl } from '@/lib/profile';
import type { ScoredReel } from '@/lib/types';
import type { PanelDeps } from './panel-deps';
import type { ProfileStore } from './profileStore';
import { ageText } from './ReelRow';
import type { SaveController } from './saves';
import { site } from './site';
import type { Theme } from './theme';

const FETCH_DELAY_MS = 350;
const FOCUSABLE = 'button:not(:disabled), a[href], video[controls], iframe, [tabindex]:not([tabindex="-1"])';

export default function Lightbox(props: {
  store: ProfileStore;
  codes: readonly string[];
  start: number;
  saves: SaveController;
  deps: Pick<PanelDeps, 'mediaItem' | 'loadMediaItem'>;
  theme: Theme;
  onClose: () => void;
}) {
  const [i, setI] = createSignal(Math.max(0, Math.min(props.start, props.codes.length - 1)));
  const code = () => props.codes[i()]!;
  const reel = (): ScoredReel | undefined => props.store.byCode().get(code());
  const [fetched, setFetched] = createSignal<ReadonlyMap<string, Record<string, unknown>>>(new Map());
  const item = () =>
    fetched().get(code()) ?? props.deps.mediaItem(code()) ?? (reel()?.raw as Record<string, unknown> | undefined);
  /** Video URLs that failed to play (expired signatures). */
  const [badUrls, setBadUrls] = createSignal<ReadonlySet<string>>(new Set());
  const videoUrl = () => {
    const u = pickVideoUrl(item());
    return u && !badUrls().has(u) ? u : undefined;
  };
  const poster = () => reel()?.thumbnailUrl ?? (item() ? pickThumbUrl(item()!) : undefined);
  /** Reels with no playable video even after asking Instagram: these get the embed. */
  const [failed, setFailed] = createSignal<ReadonlySet<string>>(new Set());
  const embed = () => failed().has(code());
  const markFailed = (c: string) => setFailed((s) => new Set(s).add(c));
  const author = () => {
    const u = item()?.user;
    return (u && typeof u === 'object' ? str((u as Record<string, unknown>).username) : undefined) ?? props.store.username;
  };
  const caption = () => (reel()?.caption ?? str((item()?.caption as Record<string, unknown> | undefined)?.text) ?? '').trim();
  const state = () => props.saves.state(code()).kind;
  const [muted, setMuted] = createSignal(true);
  let dialog!: HTMLDivElement;
  let video: HTMLVideoElement | undefined;

  const step = (d: number) => setI((n) => Math.max(0, Math.min(props.codes.length - 1, n + d)));
  createEffect(on(code, () => setMuted(true), { defer: true }));

  // One /media/info request per reel while the player is open, never for a
  // reel only flicked past (FETCH_DELAY_MS), and dropped when you move on.
  const asked = new Set<string>();
  let fetchCtl: AbortController | undefined;
  function fetchItem(c: string) {
    if (asked.has(c)) return markFailed(c);
    asked.add(c);
    fetchCtl?.abort();
    const ctl = (fetchCtl = new AbortController());
    props.deps.loadMediaItem(c, ctl.signal).then(
      (it) => {
        setFetched((m) => new Map(m).set(c, it));
        const u = pickVideoUrl(it);
        if (!u || badUrls().has(u)) markFailed(c); // nothing new to try
      },
      () => (ctl.signal.aborted ? asked.delete(c) : markFailed(c)),
    );
  }
  createEffect(
    on(code, (c) => {
      fetchCtl?.abort();
      if (embed() || videoUrl()) return;
      const t = setTimeout(() => fetchItem(c), FETCH_DELAY_MS);
      onCleanup(() => clearTimeout(t));
    }),
  );
  onCleanup(() => fetchCtl?.abort());

  function onVideoError(src: string) {
    setBadUrls((s) => new Set(s).add(src));
    fetchItem(code()); // a fresh signed URL, or the embed if we already asked
  }

  function save() {
    const r = reel();
    if (r) void props.store.saveOne(r);
    else void props.saves.save(code());
  }

  function unmute() {
    if (!video) return;
    video.muted = false;
    void video.play().catch(() => {});
  }

  // Keys: ours first, and nothing reaches Instagram's handlers while open.
  const onKey = (e: KeyboardEvent) => {
    let handled = true;
    if (e.key === 'Escape') props.onClose();
    else if (e.key === 'ArrowLeft') step(-1);
    else if (e.key === 'ArrowRight') step(1);
    else if (e.key === 'Tab') trapTab(e.shiftKey);
    else handled = false;
    if (handled) {
      e.preventDefault();
      e.stopImmediatePropagation();
    }
  };
  // Other keys still reach the focused control (space on the video), then stop here.
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
    // Lock page scroll; put back exactly what was there.
    const html = document.documentElement;
    const body = document.body;
    const saved = [html.style.overflow, body.style.overflow];
    html.style.overflow = 'hidden';
    body.style.overflow = 'hidden';
    dialog.querySelector<HTMLElement>('.op-lb-close')?.focus();
    onCleanup(() => {
      window.removeEventListener('keydown', onKey, { capture: true });
      html.style.overflow = saved[0]!;
      body.style.overflow = saved[1]!;
    });
  });

  const saveLabel = () =>
    ({ idle: 'Save', saving: 'Saving…', saved: 'Saved', queued: 'Queued', error: 'Retry save' })[state()];

  return (
    <div
      class="op-lb-backdrop"
      data-theme={props.theme}
      onClick={(e) => e.target === e.currentTarget && props.onClose()}
    >
      <button type="button" class="op-lb-nav op-lb-prev" aria-label={`Previous ${site.item}`} disabled={i() === 0} onClick={() => step(-1)}>
        <Chevron dir="left" />
      </button>
      <div
        ref={dialog}
        class="op-panel op-lb"
        data-theme={props.theme}
        style={tierVars(props.theme)}
        role="dialog"
        aria-modal="true"
        aria-label={`${site.Video} by @${author()}`}
      >
        <div class="op-lb-media">
          <Switch>
            <Match when={!embed() && videoUrl()} keyed>
              {(src) => (
                <>
                  <video
                    ref={(el) => {
                      video = el;
                      el.muted = true;
                    }}
                    src={src}
                    poster={poster()}
                    controls
                    autoplay
                    playsinline
                    loop
                    onVolumeChange={(e) => setMuted(e.currentTarget.muted)}
                    onError={() => onVideoError(src)}
                  />
                  <Show when={muted()}>
                    <button type="button" class="op-lb-unmute" onClick={unmute}>
                      <SpeakerOff /> Tap for sound
                    </button>
                  </Show>
                </>
              )}
            </Match>
            <Match when={!embed()}>
              <div class="op-lb-wait">
                <Show when={poster()}>{(p) => <img src={p()} alt="" />}</Show>
                <span class="op-lb-wait-note">
                  <span class="op-spin" aria-hidden="true" />
                  Loading video…
                </span>
              </div>
            </Match>
            <Match when={embed()}>
              <iframe
                class="op-lb-embed"
                src={`https://www.instagram.com/reel/${code()}/embed/`}
                title={`Instagram embed of ${code()}`}
                allow="autoplay; encrypted-media; picture-in-picture"
              />
            </Match>
          </Switch>
        </div>

        <div class="op-lb-info">
          <header class="op-lb-top">
            <a class="op-lb-author" href={site.profileUrl(author())}>
              @{author()}
            </a>
            <Show when={reel() && ageText(reel()!.ageDays) !== '–' ? reel() : undefined}>
              {(r) => (
                <span class="op-dim" title={r().dateEstimated ? site.estimatedTitle : undefined}>
                  {r().dateEstimated ? '~' : ''}
                  {ageText(r().ageDays)} ago
                </span>
              )}
            </Show>
            <button type="button" class="op-icon op-lb-close" aria-label="Close (Esc)" title="Close (Esc)" onClick={() => props.onClose()}>
              <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
                <path d="M3.5 3.5l9 9m0-9l-9 9" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
              </svg>
            </button>
          </header>

          <Show when={reel()}>
            {(r) => (
              <>
                <div class="op-lb-mult">
                  <span class="op-mult ct" data-tier={r().tier}>
                    {multiple(r().multiple)}
                  </span>
                  <span class="op-lb-tier">
                    <span class="op-tier-label">{TIER_LABEL[r().tier]}</span>
                    <span class="op-dim">their usual views</span>
                  </span>
                </div>
                <dl class="op-lb-stats">
                  <div>
                    <dt>Views</dt>
                    <dd class="op-num">{compact(r().views)}</dd>
                  </div>
                  <div>
                    <dt>Likes</dt>
                    <dd class="op-num">{r().fromGrid ? '–' : compact(r().likes)}</dd>
                  </div>
                  <div>
                    <dt>Comments</dt>
                    <dd class="op-num">{r().fromGrid ? '–' : compact(r().comments)}</dd>
                  </div>
                </dl>
              </>
            )}
          </Show>

          <p class="op-lb-cap">{caption() || <span class="op-faint">No caption</span>}</p>

          <div class="op-lb-actions">
            <button
              type="button"
              class="op-btn op-lb-save"
              classList={{ 'op-btn-accent': state() === 'idle' || state() === 'error' }}
              data-state={state()}
              disabled={state() === 'saving' || state() === 'saved'}
              onClick={save}
            >
              {saveLabel()}
            </button>
            <a class="op-btn op-lb-open" href={reel()?.url ?? `https://www.instagram.com/reel/${code()}/`}>
              Open on {site.name}
            </a>
          </div>

          <footer class="op-lb-foot op-dim">
            <span class="op-num">
              {i() + 1} / {props.codes.length}
            </span>
            <span>← → to browse · Esc to close</span>
          </footer>
        </div>
      </div>
      <button
        type="button"
        class="op-lb-nav op-lb-next"
        aria-label={`Next ${site.item}`}
        disabled={i() === props.codes.length - 1}
        onClick={() => step(1)}
      >
        <Chevron dir="right" />
      </button>
    </div>
  );
}

function Chevron(props: { dir: 'left' | 'right' }) {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
      <path
        d={props.dir === 'left' ? 'M15 5l-7 7 7 7' : 'M9 5l7 7-7 7'}
        fill="none"
        stroke="currentColor"
        stroke-width="2.2"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  );
}

function SpeakerOff() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
      <path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor" />
      <path d="M17 9l5 6m0-6l-5 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
    </svg>
  );
}
