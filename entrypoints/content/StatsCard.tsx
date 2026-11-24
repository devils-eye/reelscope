// The stats card: every number the site hides for one post, on demand. Opens
// from a post's Stats button (InlineSave.tsx) or Alt+N, and renders in the
// body-level overlay (ContentApp), positioned against the button: below or
// above it in action rows, beside it in the reels / Shorts column, always
// inside the viewport. Esc or a click elsewhere closes it.
//
// Data: PanelDeps.postStats (Instagram: what the page loaded; YouTube: the
// library server's yt-dlp lookup), the metrics in lib/metrics.ts, and the
// creator's latest scan (Runtime.creatorScan) for "Vs this creator".
import { createEffect, createMemo, createResource, createSignal, For, onCleanup, onMount, Show, type JSX } from 'solid-js';
import { ago, compact, duration, full, longAge, multiple, oneIn, pct, perK, ratio, TIER_LABEL, tierVars } from '@/lib/format';
import { compareToScan, computeMetrics, type PostDetails, type PostMetrics } from '@/lib/metrics';
import type { ScanFormat } from '@/lib/types';
import { StatsIcon } from './icons';
import type { PanelDeps } from './panel-deps';
import type { Runtime } from './runtime';
import { site, siteFor, type Site } from './site';
import type { StatsTarget } from './statsState';
import type { Theme } from './theme';

const CARD_W = 392;
const MARGIN = 8;
const GAP = 8;
/** Below this much room on either side, the card covers the button instead of squeezing. */
const MIN_ROOM = 260;

/** "Oct 12, 2026 · 14:05" (just the day when only the day is known). */
function when(iso: string | null | undefined, dateOnly = false): string {
  if (!iso) return '–';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '–';
  if (dateOnly) return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
  const day = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  const time = d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
  return `${day} · ${time}`;
}

const plural = (n: number, one: string, many = `${one}s`) => `${full(n)} ${n === 1 ? one : many}`;

interface Pos {
  left: number;
  top: number;
  width: number;
  maxHeight: number;
}

export default function StatsCard(props: {
  target: StatsTarget;
  deps: PanelDeps;
  theme: Theme;
  creatorScan: Runtime['creatorScan'];
  onCreatorPage: Runtime['onCreatorPage'];
  onClose: (restoreFocus: boolean) => void;
}) {
  let card: HTMLDivElement | undefined;
  let inner: HTMLDivElement | undefined;
  const ctl = new AbortController();
  onCleanup(() => ctl.abort());

  // ---- data ----------------------------------------------------------------------
  const [attempt, setAttempt] = createSignal(0);
  const [res] = createResource(
    () => ({ code: props.target.code, n: attempt() }),
    ({ code }) => props.deps.postStats(code, ctl.signal),
  );
  const ok = () => {
    const r = res();
    return r?.ok ? r : null;
  };
  const details = (): PostDetails | null => ok()?.details ?? null;
  const [now, setNow] = createSignal(Date.now());
  const metrics = createMemo<PostMetrics | null>(() => {
    const d = details();
    return d ? computeMetrics(d.post, now()) : null;
  });
  const err = () => {
    const r = res();
    return r && !r.ok ? r : null;
  };
  const format = (): ScanFormat => (details()?.extras.short === false ? 'long' : 'short');
  /** The page's words, for this post's kind (a long YouTube video is a "video", its scans "videos"). */
  const words = (): Site => siteFor(site, format());

  const [scan] = createResource(
    () => {
      const u = details()?.post.username;
      return u ? { u, f: format() } : false;
    },
    ({ u, f }) => props.creatorScan(u, f),
  );
  // Only asked when there is no scan: to tell "never scanned" from "server down".
  const [serverUp] = createResource(
    () => scan.state === 'ready' && scan() === null,
    () => props.deps.serverUp(),
  );
  const vs = createMemo(() => {
    const m = metrics();
    const s = scan();
    return m && s ? compareToScan(props.target.code, m, s) : null;
  });

  // ---- placement -------------------------------------------------------------------
  const [pos, setPos] = createSignal<Pos | null>(null);
  function place() {
    if (!card || !inner) return;
    const vw = document.documentElement.clientWidth || window.innerWidth;
    const vh = window.innerHeight;
    const width = Math.min(CARD_W, vw - 2 * MARGIN);
    const h = inner.offsetHeight + 2; // + borders
    const a = props.target.anchor;
    if (a && !a.isConnected) return props.onClose(false);
    if (!a) {
      const top = Math.min(72, Math.max(MARGIN, (vh - h) / 2));
      setPos({ left: (vw - width) / 2, top, width, maxHeight: vh - top - MARGIN });
      return;
    }
    const r = a.getBoundingClientRect();
    // The post scrolled away (or the page moved on): nothing left to describe.
    if (r.bottom < 0 || r.top > vh || r.right < 0 || r.left > vw || (r.width === 0 && r.height === 0)) return props.onClose(false);
    const below = vh - r.bottom - GAP - MARGIN;
    const above = r.top - GAP - MARGIN;
    const right = vw - r.right - GAP - MARGIN;
    const left = r.left - GAP - MARGIN;
    const clampY = (top: number, hh: number) => Math.min(Math.max(MARGIN, top), vh - MARGIN - hh);
    // The reels / Shorts column: beside it, so the video stays in view.
    if (props.target.variant === 'stack' && (right >= width || left >= width)) {
      const maxHeight = vh - 2 * MARGIN;
      const hh = Math.min(h, maxHeight);
      const x = right >= width ? r.right + GAP : r.left - GAP - width;
      setPos({ left: x, top: clampY(r.top + r.height / 2 - hh / 2, hh), width, maxHeight });
      return;
    }
    const x = Math.min(Math.max(MARGIN, r.left), vw - MARGIN - width);
    if (h <= below || (below >= above && below >= MIN_ROOM)) {
      setPos({ left: x, top: r.bottom + GAP, width, maxHeight: below });
    } else if (h <= above || above >= MIN_ROOM) {
      const hh = Math.min(h, above);
      setPos({ left: x, top: r.top - GAP - hh, width, maxHeight: above });
    } else {
      // No room either way (a short window): cover the button rather than squeeze.
      const maxHeight = vh - 2 * MARGIN;
      setPos({ left: x, top: clampY(r.bottom + GAP, Math.min(h, maxHeight)), width, maxHeight });
    }
  }

  let raf = 0;
  const schedule = () => {
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      place();
    });
  };

  onMount(() => {
    place();
    card?.focus({ preventScroll: true });
    const ro = new ResizeObserver(schedule);
    if (inner) ro.observe(inner);
    // Clicks anywhere else close it; the Stats button toggles it itself.
    const onDown = (e: PointerEvent) => {
      const path = e.composedPath();
      if ((card && path.includes(card)) || (props.target.anchor && path.includes(props.target.anchor))) return;
      props.onClose(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopImmediatePropagation();
      props.onClose(true);
    };
    // Keys typed in the card are ours, not the site's shortcuts.
    const stopBubble = (e: Event) => e.stopPropagation();
    card?.addEventListener('keydown', stopBubble);
    card?.addEventListener('keyup', stopBubble);
    window.addEventListener('pointerdown', onDown, { capture: true });
    window.addEventListener('keydown', onKey, { capture: true });
    window.addEventListener('scroll', schedule, { capture: true, passive: true });
    window.addEventListener('resize', schedule);
    // The site re-renders under us: follow the button, close when it's gone; ages tick.
    const tick = setInterval(schedule, 400);
    const clock = setInterval(() => setNow(Date.now()), 30_000);
    onCleanup(() => {
      ro.disconnect();
      cancelAnimationFrame(raf);
      clearInterval(tick);
      clearInterval(clock);
      window.removeEventListener('pointerdown', onDown, { capture: true });
      window.removeEventListener('keydown', onKey, { capture: true });
      window.removeEventListener('scroll', schedule, { capture: true });
      window.removeEventListener('resize', schedule);
    });
  });
  createEffect(() => {
    res.state;
    scan.state;
    schedule();
  });

  const style = (): JSX.CSSProperties => {
    const p = pos();
    return {
      ...tierVars(props.theme),
      left: `${p?.left ?? -9999}px`,
      top: `${p?.top ?? 0}px`,
      width: `${p?.width ?? CARD_W}px`,
      'max-height': `${p?.maxHeight ?? 600}px`,
      visibility: p ? 'visible' : 'hidden',
    };
  };

  const who = () => details()?.post.username;
  const label = () => (who() ? `Stats for @${who()}'s ${words().video}` : 'Stats');

  return (
    <div
      ref={card}
      class="rs-card"
      data-theme={props.theme}
      style={style()}
      role="dialog"
      aria-label={label()}
      tabIndex={-1}
    >
      <div ref={inner} class="rs-card-in">
        <header class="rs-card-head">
          <span class="rs-card-mark" aria-hidden="true">
            <StatsIcon size={14} />
          </span>
          <div class="rs-card-who">
            <Show when={details()} fallback={<p class="rs-card-name">Stats</p>}>
              {(d) => (
                <>
                  <p class="rs-card-name">
                    <a href={words().profileUrl(d().post.username ?? '')} target="_blank" rel="noopener" title={d().post.fullName ?? undefined}>
                      @{d().post.username ?? 'unknown'}
                    </a>
                    <Show when={metrics()?.followers != null}>
                      <span class="rs-card-dim" title={`${full(metrics()!.followers)} ${words().followers}`}>
                        {' '}
                        · {compact(metrics()!.followers)} {words().followers}
                      </span>
                    </Show>
                  </p>
                  <Show when={d().post.title}>
                    <p class="rs-card-title">{d().post.title}</p>
                  </Show>
                  <p class="rs-card-meta">
                    <span title={d().post.dateOnly ? 'YouTube gave only the upload day' : 'Posted (your time zone)'}>
                      {when(d().post.takenAt, d().post.dateOnly)}
                    </span>
                    <Show when={metrics()?.ageHours != null}>
                      <span class="rs-card-sep">·</span>
                      <span>{metrics()!.ageHours! < 1 / 60 ? 'just now' : `${longAge(metrics()!.ageHours)} ago`}</span>
                    </Show>
                    <Show when={d().post.durationSec != null}>
                      <span class="rs-card-sep">·</span>
                      <span title="Length">{duration(d().post.durationSec)}</span>
                    </Show>
                  </p>
                </>
              )}
            </Show>
          </div>
          <button type="button" class="rs-card-x" aria-label="Close stats" title="Close (Esc)" on:click={() => props.onClose(true)}>
            <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true">
              <path d="M4 4l8 8M12 4l-8 8" />
            </svg>
          </button>
        </header>

        <Show when={res.loading && !res.latest}>
          <Loading youtube={site.platform === 'youtube'} />
        </Show>

        <Show when={err()}>
          {(err) => (
            <div class="rs-card-err" role="alert">
              <p>{errorText(err().reason, err().error)}</p>
              <Show when={err().reason !== 'gone'}>
                <button type="button" class="rs-card-btn" on:click={() => setAttempt((n) => n + 1)} disabled={res.loading}>
                  {res.loading ? 'Trying…' : 'Try again'}
                </button>
              </Show>
            </div>
          )}
        </Show>

        <Show when={metrics()}>
          {(m) => (
            <>
              <BigNumbers m={m()} platform={details()!.post.platform} likesHidden={!!details()!.extras.likesHidden} />
              <Rates m={m()} words={words()} />
              <VsCreator
                vs={vs()}
                loading={scan.loading}
                noScan={scan.state === 'ready' && scan() === null}
                serverDown={serverUp() === false}
                username={who() ?? ''}
                words={words()}
                onTheirPage={!!who() && props.onCreatorPage(who()!)}
                hasViews={m().views != null}
              />
              <Facts details={details()!} m={m()} />
              <p class="rs-card-foot">
                {provenance(ok()!.source, ok()!.at, now())} Hover a number for the exact count.
              </p>
            </>
          )}
        </Show>
      </div>
    </div>
  );
}

/** "top 3%" in the upper half, "bottom 8%" in the lower. */
function standing(rank: number, of: number): string {
  const top = rank / of;
  if (top <= 0.5) return `top ${Math.max(1, Math.round(top * 100))}%`;
  return `bottom ${Math.max(1, Math.round(((of - rank + 1) / of) * 100))}%`;
}

function errorText(reason: 'offline' | 'gone' | 'retry', error: string): string {
  if (reason === 'gone') return `${error.replace(/^YouTube:\s*/, '')}. Nothing to show.`;
  return error;
}

function provenance(source: 'page' | 'instagram' | 'youtube', at: number, now: number): string {
  const t = ago(new Date(at).toISOString(), now);
  if (source === 'page') return `Numbers as Instagram's page loaded them, ${t}.`;
  if (source === 'instagram') return `Numbers asked from Instagram ${t}.`;
  return `Numbers from YouTube via your library server, ${t === 'just now' ? 'just now' : t}.`;
}

function Loading(props: { youtube: boolean }) {
  return (
    <div class="rs-card-loading" aria-live="polite">
      <p class="rs-card-wait">
        <span class="rs-spin" aria-hidden="true" />
        {props.youtube ? 'Asking YouTube for the numbers. This takes a few seconds.' : 'Reading the numbers…'}
      </p>
      <div class="rs-card-big" aria-hidden="true">
        <For each={[0, 1, 2, 3]}>
          {() => (
            <div class="rs-card-cell">
              <span class="rs-skel rs-skel-label" />
              <span class="rs-skel rs-skel-num" />
            </div>
          )}
        </For>
      </div>
    </div>
  );
}

function BigNumbers(props: { m: PostMetrics; platform?: string; likesHidden: boolean }) {
  const cells = () => {
    const m = props.m;
    const out: Array<{ label: string; value: number | null; title: string }> = [
      { label: 'Views', value: m.views, title: m.views != null ? `${full(m.views)} views` : 'No view count came through' },
      {
        label: 'Likes',
        value: m.likes,
        title: m.likes != null ? `${full(m.likes)} likes${props.likesHidden ? ' (hidden from viewers by the creator)' : ''}` : 'No like count came through',
      },
      { label: 'Comments', value: m.comments, title: m.comments != null ? `${full(m.comments)} comments` : 'No comment count came through' },
    ];
    // Only when known: YouTube never publishes shares, Instagram only sometimes sends them.
    if (m.shares != null) out.push({ label: 'Shares', value: m.shares, title: `${full(m.shares)} shares` });
    return out;
  };
  return (
    <dl class="rs-card-big" style={{ '--n': cells().length }}>
      <For each={cells()}>
        {(c) => (
          <div class="rs-card-cell" title={c.title}>
            <dt>{c.label}</dt>
            <dd class="rs-card-num">{compact(c.value)}</dd>
          </div>
        )}
      </For>
    </dl>
  );
}

function Rates(props: { m: PostMetrics; words: Site }) {
  const rows = () => {
    const m = props.m;
    const young = m.ageHours != null && m.ageHours < 48;
    const all: Array<{ label: string; value: string | null; title: string }> = [
      {
        label: 'Engagement',
        value: m.engagementRate != null ? pct(m.engagementRate) : null,
        title: m.engagementHasShares
          ? 'Likes, comments and shares per view: how many viewers did something.'
          : 'Likes and comments per view: how many viewers did something (no share count to add).',
      },
      { label: 'Like rate', value: m.likeRate != null ? pct(m.likeRate) : null, title: 'Likes per view.' },
      { label: 'Comments / 1K', value: m.commentsPer1k != null ? perK(m.commentsPer1k) : null, title: 'Comments for every 1,000 views.' },
      { label: 'Shares / 1K', value: m.sharesPer1k != null ? perK(m.sharesPer1k) : null, title: 'Shares for every 1,000 views.' },
      {
        label: 'Comment : like',
        value: m.commentLikeRatio != null ? oneIn(m.commentLikeRatio) : null,
        title: 'Comments against likes. 1:40 means one comment for every 40 likes; questions, giveaways and "comment X" prompts push it up.',
      },
      {
        label: `Views / ${props.words.followers === 'subscribers' ? 'sub' : 'follower'}`,
        value: m.viewsPerFollower != null ? multiple(m.viewsPerFollower) : null,
        title: `Views divided by the creator's ${props.words.followers}. Above 1x, it reached well past their own audience.`,
      },
      young
        ? { label: 'Views / hour', value: m.viewsPerHour != null ? compact(m.viewsPerHour) : null, title: 'Average views per hour since it was posted.' }
        : { label: 'Views / day', value: m.viewsPerDay != null ? compact(m.viewsPerDay) : null, title: 'Average views per day since it was posted.' },
    ];
    return all.filter((r) => r.value !== null);
  };
  return (
    <Show when={rows().length > 0}>
      <section class="rs-card-sec">
        <h3 class="rs-card-h">Rates</h3>
        <dl class="rs-card-rates">
          <For each={rows()}>
            {(r) => (
              <div class="rs-card-rate" title={r.title}>
                <dt>{r.label}</dt>
                <dd class="rs-card-num">{r.value}</dd>
              </div>
            )}
          </For>
        </dl>
      </section>
    </Show>
  );
}

function VsCreator(props: {
  vs: ReturnType<typeof compareToScan>;
  loading: boolean;
  noScan: boolean;
  serverDown: boolean;
  username: string;
  words: Site;
  onTheirPage: boolean;
  hasViews: boolean;
}) {
  const where = () => (props.words.platform === 'youtube' ? 'channel' : 'profile');
  return (
    <section class="rs-card-sec">
      <h3 class="rs-card-h">
        Vs this creator
        <Show when={props.vs}>
          {(v) => (
            <span class="rs-card-h-note" title={`Compared with ${plural(v().sampleSize, props.words.item, props.words.items)} from their scan`}>
              their {props.words.items} · scanned {ago(v().scannedAt)}
            </span>
          )}
        </Show>
      </h3>
      <Show when={props.vs}>
        {(v) => (
          <>
            <div class="rs-vs">
              <span
                class="rs-vs-mult ct"
                data-tier={v().tier}
                title={`Current views over their usual ${props.words.item} (${compact(v().baselineViews)} views)`}
              >
                {multiple(v().multiple)}
              </span>
              <p class="rs-vs-text">
                <b class="ct" data-tier={v().tier}>
                  {TIER_LABEL[v().tier]}
                </b>{' '}
                for them
                <br />
                <span class="rs-card-dim" title="Rank by views among the scanned ones, with this one at its current views">
                  #{v().rank} of {v().of} by views · {standing(v().rank, v().of)}
                </span>
              </p>
            </div>
            <dl class="rs-card-rates rs-vs-rates">
              <div class="rs-card-rate" title={`Median views of their ${props.words.items} older than 72 hours, from the scan`}>
                <dt>Their usual</dt>
                <dd class="rs-card-num">{compact(v().baselineViews)}</dd>
              </div>
              <Show when={v().engagementVsMedian != null}>
                <div
                  class="rs-card-rate"
                  title={`Likes and comments per view: ${pct(v().engagement)} here, ${pct(v().medianEngagement)} on their median ${props.words.item}`}
                >
                  <dt>Engagement</dt>
                  <dd class="rs-card-num">
                    {ratio(v().engagementVsMedian)}
                    <span class="rs-card-unit"> median</span>
                  </dd>
                </div>
              </Show>
            </dl>
            <Show when={v().early}>
              <p class="rs-card-note">Under 72 hours old: still climbing, so the multiple will move.</p>
            </Show>
            <Show when={v().lowConfidence}>
              <p class="rs-card-note">Few of their {props.words.items} were older than 72 hours: a rough baseline.</p>
            </Show>
          </>
        )}
      </Show>
      <Show when={!props.vs}>
        <p class="rs-card-line">
          <Show
            when={!props.loading}
            fallback={
              <>
                <span class="rs-spin rs-spin-sm" aria-hidden="true" /> Looking for a scan of @{props.username}…
              </>
            }
          >
            <Show
              when={props.noScan || !props.hasViews}
              fallback={<>No baseline in their scan to compare with.</>}
            >
              <Show when={props.hasViews} fallback={<>No view count, so nothing to compare.</>}>
                <Show
                  when={!props.serverDown}
                  fallback={<>The library server is offline, so their scans can't be read.</>}
                >
                  No scan of @{props.username}'s {props.words.items} yet.{' '}
                  <Show
                    when={!props.onTheirPage}
                    fallback={<>Scan them from the ReelScope strip on this {where()}.</>}
                  >
                    <a class="rs-card-link" href={props.words.profileUrl(props.username)} target="_blank" rel="noopener">
                      Open their {where()}
                    </a>{' '}
                    and scan it to compare.
                  </Show>
                </Show>
              </Show>
            </Show>
          </Show>
        </p>
      </Show>
    </section>
  );
}

const LIVE_TEXT: Record<string, string> = {
  is_live: 'Live right now',
  was_live: 'Was a live stream or premiere',
  is_upcoming: 'Scheduled: premiere or stream',
  post_live: 'Stream just ended (still processing)',
};

function Facts(props: { details: PostDetails; m: PostMetrics }) {
  const rows = () => {
    const x = props.details.extras;
    const out: Array<{ label: string; value: JSX.Element; title?: string }> = [];
    if (x.audio) {
      const a = x.audio;
      const name = a.original ? a.title && !/^original audio$/i.test(a.title) ? a.title : 'Original audio' : (a.title ?? 'A licensed track');
      const by = a.artist ? (a.original ? `@${a.artist}` : a.artist) : null;
      out.push({ label: 'Audio', value: <>{name}{by ? <span class="rs-card-dim"> · {by}</span> : null}</>, title: a.original ? 'Sound recorded for (or first used in) a reel' : 'A track from the music library' });
    }
    if (x.collaborators) out.push({ label: 'Collab', value: x.collaborators.map((u) => `@${u}`).join(', '), title: 'Co-authors: the post shows on their profiles too' });
    if (x.paidPartnership) out.push({ label: 'Partnership', value: x.sponsors ? `Paid, with ${x.sponsors.map((u) => `@${u}`).join(', ')}` : 'Paid partnership', title: 'Marked as a paid partnership' });
    if (x.likesHidden) out.push({ label: 'Likes', value: 'Hidden by the creator', title: 'Viewers don\'t see the like count; the number above is what the page received' });
    if (x.category) out.push({ label: 'Category', value: x.category });
    if (x.liveStatus) out.push({ label: 'Live', value: LIVE_TEXT[x.liveStatus] ?? x.liveStatus });
    if (x.resolution) out.push({ label: 'Quality', value: x.resolution, title: 'Best resolution YouTube offers for it' });
    if (x.chapters) out.push({ label: 'Chapters', value: full(x.chapters) });
    const c = props.m.caption;
    if (c) {
      const yt = props.details.post.platform === 'youtube';
      out.push({
        label: yt ? 'Text' : 'Caption',
        value: `${plural(c.length, 'char')} · ${plural(c.hashtags, 'hashtag')} · ${plural(c.mentions, 'mention')}`,
        title: `${yt ? 'Title and description' : 'Caption'}: length in characters, and how many #hashtags and @mentions`,
      });
    }
    return out;
  };
  const tags = () => props.details.extras.tags?.slice(0, 8) ?? [];
  return (
    <Show when={rows().length > 0 || tags().length > 0}>
      <section class="rs-card-sec">
        <h3 class="rs-card-h">Details</h3>
        <dl class="rs-card-facts">
          <For each={rows()}>
            {(r) => (
              <div title={r.title}>
                <dt>{r.label}</dt>
                <dd>{r.value}</dd>
              </div>
            )}
          </For>
          <Show when={tags().length > 0}>
            <div title={`${plural(props.details.extras.tags!.length, 'tag')} set by the uploader (viewers don't see them)`}>
              <dt>Tags</dt>
              <dd class="rs-card-tags">
                <For each={tags()}>{(t) => <span class="rs-card-tag">{t}</span>}</For>
                <Show when={props.details.extras.tags!.length > tags().length}>
                  <span class="rs-card-dim">+{props.details.extras.tags!.length - tags().length}</span>
                </Show>
              </dd>
            </div>
          </Show>
        </dl>
      </section>
    </Show>
  );
}
