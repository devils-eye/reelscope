// One saved reel: how far it outran its creator, its saved video, the
// caption, your notes and status. Opens beside whatever view you're on.
import { createEffect, createMemo, createResource, createSignal, For, on, onCleanup, onMount, Show, untrack } from 'solid-js';
import { getReel, patchReel, thumbUrl, videoUrl, type LibraryReel } from '@/lib/api';
import { compact, date, duration, full, interval, longAge, multiple, oneIn, pct, perK, ratio, TIER_LABEL } from '@/lib/format';
import { computeMetrics, detailsFromRow, snapshotGrowth } from '@/lib/metrics';
import { followersWord, isLongVideo, platformOf, profileUrl, siteName } from '@/lib/platform';
import { REEL_STATUSES, type ProfileTier, type ReelStatus } from '@/lib/types';
import { hrefFor, patch, route } from './route';
import { reels, updateReel } from './store';
import { Cover, Icon, isTyping, plural, STATUS_LABEL } from './ui';

type NoteState = 'idle' | 'editing' | 'saving' | 'saved' | 'error';

export default function ReelSheet(props: { reel: () => LibraryReel }) {
  let heading: HTMLHeadingElement | undefined;
  let body: HTMLDivElement | undefined;
  const r = () => props.reel();
  const close = () => patch({ reel: null });

  // ---- notes: debounced autosave, flushed on blur and when switching reels ----
  const [notes, setNotes] = createSignal(untrack(() => r().notes ?? ''));
  const [noteState, setNoteState] = createSignal<NoteState>('idle');
  let timer: ReturnType<typeof setTimeout> | undefined;
  let dirty = false;
  let forCode = untrack(() => r().shortcode);

  async function saveNotes() {
    clearTimeout(timer);
    if (!dirty) return;
    dirty = false;
    const code = forCode;
    const value = notes();
    setNoteState('saving');
    try {
      updateReel(await patchReel(code, { notes: value.trim() ? value : null }));
      if (code === forCode) setNoteState(dirty ? 'editing' : 'saved');
    } catch {
      if (code === forCode) {
        dirty = true;
        setNoteState('error');
      }
    }
  }
  createEffect(
    on(
      () => r().shortcode,
      (code) => {
        if (code === forCode) return;
        void saveNotes();
        forCode = code;
        setNotes(r().notes ?? '');
        setNoteState('idle');
        setCaptionOpen(false);
        body?.scrollTo({ top: 0 });
      },
      { defer: true },
    ),
  );
  onCleanup(() => void saveNotes());

  const [statusError, setStatusError] = createSignal(false);
  async function setStatus(status: ReelStatus) {
    const before = r();
    setStatusError(false);
    updateReel({ ...before, status });
    try {
      updateReel(await patchReel(before.shortcode, { status }));
    } catch {
      updateReel({ ...before });
      setStatusError(true);
    }
  }

  const [captionOpen, setCaptionOpen] = createSignal(false);
  const longCaption = () => (r().caption?.length ?? 0) > 220 || (r().caption?.split('\n').length ?? 0) > 4;

  onMount(() => {
    heading?.focus({ preventScroll: true });
    onCleanup(() => {
      const code = forCode;
      queueMicrotask(() => document.querySelector<HTMLElement>(`[data-reel="${CSS.escape(code)}"] .row-link`)?.focus({ preventScroll: true }));
    });
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (isTyping(e.target) && (e.target as HTMLElement).closest('.sheet') == null) return;
      if (isTyping(e.target)) (e.target as HTMLElement).blur();
      close();
    };
    window.addEventListener('keydown', onKey);
    onCleanup(() => window.removeEventListener('keydown', onKey));
  });

  const followers = () => r().latest_author_followers ?? r().author_followers;
  const yt = () => platformOf(r().platform) === 'youtube';

  return (
    <aside class="sheet" aria-labelledby="sheet-title">
      <header class="sheet-bar">
        <h2 id="sheet-title" ref={heading} tabIndex={-1}>
          <a href={profileUrl(r().platform, r().author_username)} target="_blank" rel="noreferrer">
            @{r().author_username}
          </a>
          <Show when={yt()}>
            <span class="site-tag">YouTube</span>
          </Show>
        </h2>
        <button type="button" class="icon-btn" onClick={close} aria-label="Close" title="Close (Esc)">
          <Icon name="close" />
        </button>
      </header>

      <div class="sheet-body" ref={body}>
        <section class="reel-hero">
          <Cover reel={r()} class="cover-hero" eager />
          <div class="reel-numbers">
            <Show when={r().author_full_name}>
              <p class="reel-name">{r().author_full_name}</p>
            </Show>
            <p class="big-number">
              {compact(r().latest_views)}
              <span>views</span>
            </p>
            <dl class="reel-mults">
              <div>
                <dt>vs their usual</dt>
                <dd>
                  <span class="mult" data-tier={r().channel_tier ?? 'normal'}>{multiple(r().channel_multiple)}</span>
                  <Show when={r().channel_tier && r().channel_tier! in TIER_LABEL}>
                    <span class="mult-tier">{TIER_LABEL[r().channel_tier as ProfileTier]}</span>
                  </Show>
                </dd>
              </div>
              <div>
                <dt>vs {followersWord(r().platform)}</dt>
                <dd>{ratio(r().views_per_follower)}</dd>
              </div>
            </dl>
            <p class="reel-explain">
              <Show
                when={r().channel_baseline_views != null}
                fallback={
                  <>
                    {compact(followers())} {followersWord(r().platform)}.{' '}
                    {yt()
                      ? `Scan the creator's channel to see how this compares with their usual ${isLongVideo(r()) ? 'video' : 'Short'}.`
                      : "Scan the creator's profile to see how this compares with their usual reel."}
                  </>
                }
              >
                Their typical {yt() ? (isLongVideo(r()) ? 'video' : 'Short') : 'reel'} gets {compact(r().channel_baseline_views)} views; {compact(followers())}{' '}
                {followersWord(r().platform)}.
              </Show>{' '}
              <Show when={r().age_hours != null}>{longAge(r().age_hours)} old when saved.</Show>
            </p>
            <div class="reel-actions">
              <a class="btn" href={r().url} target="_blank" rel="noreferrer">
                Open on {siteName(r().platform)} <Icon name="external" size={14} />
              </a>
            </div>
          </div>
        </section>

        <Performance reel={r()} />

        <section class="sheet-section">
          <h3>Video</h3>
          <Show
            when={r().has_video}
            fallback={
              <p class="dim">
                No copy of the video was saved. The server downloads it right after a save; open it on {siteName(r().platform)} and
                save it again to retry.
              </p>
            }
          >
            <Show when={r().shortcode} keyed>
              {(code) => (
                <video
                  class="sheet-video"
                  data-wide={isLongVideo(r()) ? '' : undefined}
                  src={videoUrl(code)}
                  poster={r().has_thumb ? thumbUrl(code) : undefined}
                  controls
                  playsinline
                  preload="metadata"
                />
              )}
            </Show>
          </Show>
        </section>

        <section class="sheet-section">
          <h3>Caption</h3>
          <Show when={r().caption} fallback={<p class="dim">No caption captured.</p>}>
            <p class="caption" classList={{ 'is-clamped': longCaption() && !captionOpen() }}>
              {r().caption}
            </p>
            <Show when={longCaption()}>
              <button type="button" class="text-btn" onClick={() => setCaptionOpen(!captionOpen())} aria-expanded={captionOpen()}>
                {captionOpen() ? 'Show less' : 'Show all'}
              </button>
            </Show>
          </Show>
        </section>

        <section class="sheet-section">
          <header class="sheet-section-head">
            <h3>
              <label for="reel-notes">Notes</label>
            </h3>
            <span class="note-state" data-state={noteState()} aria-live="polite">
              {{ idle: '', editing: 'Editing', saving: 'Saving', saved: 'Saved', error: 'Not saved. Is the server running?' }[noteState()]}
            </span>
          </header>
          <textarea
            id="reel-notes"
            class="notes"
            rows={3}
            value={notes()}
            placeholder="What stands out about it"
            onInput={(e) => {
              setNotes(e.currentTarget.value);
              dirty = true;
              setNoteState('editing');
              clearTimeout(timer);
              timer = setTimeout(() => void saveNotes(), 700);
            }}
            onBlur={() => void saveNotes()}
          />
          <label class="select select-block">
            <span class="select-label">Marked</span>
            <select value={r().status} onChange={(e) => void setStatus(e.currentTarget.value as ReelStatus)}>
              <For each={REEL_STATUSES}>{(s) => <option value={s}>{STATUS_LABEL[s]}</option>}</For>
            </select>
          </label>
          <Show when={statusError()}>
            <p class="err">Couldn't save that. Is the server running?</p>
          </Show>
        </section>

        <MoreFrom reel={r()} />

        <section class="sheet-section">
          <h3>Details</h3>
          <dl class="details">
            <div><dt>Likes</dt><dd>{full(r().latest_like_count)}</dd></div>
            <div><dt>Comments</dt><dd>{full(r().latest_comment_count)}</dd></div>
            <div><dt>Shares</dt><dd>{full(r().latest_share_count)}</dd></div>
            <div><dt>Views per hour</dt><dd>{full(r().views_per_hour)}</dd></div>
            <div><dt>Length</dt><dd>{duration(r().duration_sec)}</dd></div>
            <div><dt>Uploaded</dt><dd>{date(r().taken_at)}</dd></div>
            <div><dt>Saved</dt><dd>{date(r().first_saved_at, true)}</dd></div>
            <div class="wide"><dt>Audio</dt><dd>{r().audio_title ?? '–'}</dd></div>
          </dl>
        </section>
      </div>
    </aside>
  );
}

/**
 * The numbers the site hides: rates from the latest snapshot (ages as of that
 * save), what the saved raw data says about audio, collabs and format, and
 * the growth between the first and latest save (lib/metrics.ts).
 */
function Performance(props: { reel: LibraryReel }) {
  const details = createMemo(() => detailsFromRow(props.reel));
  const m = createMemo(() => {
    const at = Date.parse(props.reel.snapshot_captured_at);
    return computeMetrics(details().post, Number.isNaN(at) ? Date.now() : at);
  });
  const yt = () => platformOf(props.reel.platform) === 'youtube';
  // Snapshots only come with the one-reel endpoint; refetched when a new save adds one.
  const [snaps] = createResource(
    () => `${props.reel.shortcode}|${props.reel.snapshot_id}`,
    async () => (await getReel(props.reel.shortcode)).snapshots,
  );
  const growth = createMemo(() => {
    const list = snaps.latest;
    return list ? snapshotGrowth(list) : null;
  });

  const rates = () => {
    const x = m();
    const young = x.ageHours != null && x.ageHours < 48;
    return [
      { label: 'Engagement', value: pct(x.engagementRate), on: x.engagementRate != null, title: x.engagementHasShares ? 'Likes, comments and shares per view' : 'Likes and comments per view (no share count)' },
      { label: 'Like rate', value: pct(x.likeRate), on: x.likeRate != null, title: 'Likes per view' },
      { label: 'Comments / 1K views', value: perK(x.commentsPer1k), on: x.commentsPer1k != null, title: 'Comments for every 1,000 views' },
      { label: 'Shares / 1K views', value: perK(x.sharesPer1k), on: x.sharesPer1k != null, title: 'Shares for every 1,000 views' },
      { label: 'Comment : like', value: oneIn(x.commentLikeRatio), on: x.commentLikeRatio != null, title: 'One comment for every N likes' },
      { label: `Views / ${yt() ? 'subscriber' : 'follower'}`, value: multiple(x.viewsPerFollower), on: x.viewsPerFollower != null, title: `Views divided by ${followersWord(props.reel.platform)} at the save` },
      young
        ? { label: 'Views / hour', value: compact(x.viewsPerHour), on: x.viewsPerHour != null, title: 'Average views per hour from upload to the save' }
        : { label: 'Views / day', value: compact(x.viewsPerDay), on: x.viewsPerDay != null, title: 'Average views per day from upload to the save' },
    ].filter((r) => r.on);
  };

  const facts = () => {
    const x = details().extras;
    const out: Array<{ label: string; value: string }> = [];
    if (x.audio) {
      const a = x.audio;
      const name = a.original ? (a.title && !/^original audio$/i.test(a.title) ? a.title : 'Original audio') : (a.title ?? 'Licensed track');
      out.push({ label: 'Audio', value: a.artist ? `${name} · ${a.original ? '@' : ''}${a.artist}` : name });
    }
    if (x.collaborators) out.push({ label: 'Collab with', value: x.collaborators.map((u) => `@${u}`).join(', ') });
    if (x.paidPartnership) out.push({ label: 'Partnership', value: x.sponsors ? `Paid, with ${x.sponsors.map((u) => `@${u}`).join(', ')}` : 'Paid' });
    if (x.likesHidden) out.push({ label: 'Likes', value: 'Hidden by the creator' });
    if (x.category) out.push({ label: 'Category', value: x.category });
    if (x.resolution) out.push({ label: 'Quality', value: x.resolution });
    if (x.chapters) out.push({ label: 'Chapters', value: full(x.chapters) });
    if (x.liveStatus) out.push({ label: 'Live', value: x.liveStatus === 'was_live' ? 'Was a live stream or premiere' : x.liveStatus.replace('_', ' ') });
    const c = m().caption;
    if (c) {
      out.push({
        label: yt() ? 'Title + description' : 'Caption',
        value: `${plural(c.length, 'character')} · ${plural(c.hashtags, 'hashtag')} · ${plural(c.mentions, 'mention')}`,
      });
    }
    if (x.tags?.length) out.push({ label: 'Tags', value: x.tags.slice(0, 10).join(', ') + (x.tags.length > 10 ? ` +${x.tags.length - 10}` : '') });
    return out;
  };

  const delta = (d: { delta: number; perDay: number | null } | null, what: string) =>
    d && (
      <div>
        <dt>{what}</dt>
        <dd>
          <span class="growth-num" data-neg={d.delta < 0 ? '' : undefined}>{d.delta >= 0 ? '+' : '−'}{compact(Math.abs(d.delta))}</span>
          <Show when={d.perDay != null}>
            <span class="dim"> · {d.perDay! >= 0 ? '+' : '−'}{compact(Math.abs(d.perDay!))}/day</span>
          </Show>
        </dd>
      </div>
    );

  return (
    <section class="sheet-section">
      <header class="sheet-section-head">
        <h3>Performance</h3>
        <Show when={m().ageHours != null}>
          <span class="note-state" title="Rates use the numbers from the latest save">
            as of the latest save, {longAge(m().ageHours)} after upload
          </span>
        </Show>
      </header>
      <Show when={rates().length > 0} fallback={<p class="dim">No view count was saved, so there are no rates.</p>}>
        <dl class="rates">
          <For each={rates()}>
            {(r) => (
              <div title={r.title}>
                <dt>{r.label}</dt>
                <dd>{r.value}</dd>
              </div>
            )}
          </For>
        </dl>
      </Show>
      <Show when={growth()}>
        {(g) => (
          <div class="growth">
            <p class="growth-head">
              Growth over {plural(snaps.latest?.length ?? 2, 'save')}, {interval(g().days)} apart
              <span class="dim">
                {' '}
                ({date(g().from)} to {date(g().to)})
              </span>
            </p>
            <dl class="details">
              {delta(g().views, 'Views')}
              {delta(g().likes, 'Likes')}
              {delta(g().comments, 'Comments')}
            </dl>
          </div>
        )}
      </Show>
      <Show when={facts().length > 0}>
        <dl class="details facts">
          <For each={facts()}>
            {(f) => (
              <div class={f.label === 'Tags' || f.label === 'Caption' || f.label === 'Title + description' || f.label === 'Audio' ? 'wide' : undefined}>
                <dt>{f.label}</dt>
                <dd>{f.value}</dd>
              </div>
            )}
          </For>
        </dl>
      </Show>
    </section>
  );
}

/** The creator's other saved reels, newest first, and where to see them all. */
function MoreFrom(props: { reel: LibraryReel }) {
  const others = () =>
    reels()
      .filter(
        (x) =>
          x.shortcode !== props.reel.shortcode &&
          x.author_username.toLowerCase() === props.reel.author_username.toLowerCase() &&
          platformOf(x.platform) === platformOf(props.reel.platform),
      )
      .sort((a, b) => Date.parse(b.last_saved_at) - Date.parse(a.last_saved_at));
  const filter = { author: props.reel.author_username.toLowerCase() };
  return (
    <Show when={others().length > 0}>
      <section class="sheet-section">
        <header class="sheet-section-head">
          <h3>More from @{props.reel.author_username}</h3>
          <span class="more-links">
            <a class="text-link" href={hrefFor({ view: 'reels', ...filter })}>
              {plural(others().length + 1, 'reel')}
            </a>
          </span>
        </header>
        <ul class="more-row">
          <For each={others().slice(0, 6)}>
            {(x) => (
              <li>
                <a
                  href={hrefFor({ ...route(), reel: x.shortcode })}
                  title={x.caption?.split('\n').find((l) => l.trim()) ?? `@${x.author_username}`}
                  onClick={(e) => {
                    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
                    e.preventDefault();
                    patch({ reel: x.shortcode }, { replace: true });
                  }}
                >
                  <Cover reel={x} class="cover-more" />
                  <Show when={(x.channel_multiple ?? 0) >= 2}>
                    <span class="poster-mult">{multiple(x.channel_multiple)}</span>
                  </Show>
                </a>
              </li>
            )}
          </For>
        </ul>
      </section>
    </Show>
  );
}
