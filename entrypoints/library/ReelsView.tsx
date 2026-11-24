// Reels: every saved reel and YouTube video with how far it outran its
// creator, and where it stands in your review (its status). A row opens the
// reel sheet.
import { createMemo, createSignal, For, Match, Show, Switch } from 'solid-js';
import type { LibraryReel } from '@/lib/api';
import { age, ago, compact, multiple, outlierTier, pct, ratio } from '@/lib/format';
import { platformOf } from '@/lib/platform';
import { byCreator, bySite, CreatorPicker, ResultLine, SitePicker, storedChoice, useListKeys } from './filters';
import { hrefFor, patch, route } from './route';
import { reels } from './store';
import { Cover, Icon, plural, StateBlock, STATUS_LABEL, STATUS_TONE } from './ui';
import type { ReelStatus } from '@/lib/types';

type Filter = 'all' | ReelStatus;
type Sort = 'saved' | 'views' | 'channel' | 'followers' | 'engagement';
/** Minimum multiple of the creator's usual views (0: any). */
type Beat = '0' | '2' | '5' | '10';

const BEATS: Array<{ id: Beat; label: string; title: string }> = [
  { id: '0', label: 'Any', title: 'Every reel' },
  { id: '2', label: '2x+', title: 'At least twice the creator’s usual views' },
  { id: '5', label: '5x+', title: 'Five times their usual or more' },
  { id: '10', label: '10x+', title: 'Breakouts: ten times their usual or more' },
];

/** (likes + comments) ÷ views, or null when a number is missing. */
export const engagement = (r: LibraryReel): number | null =>
  r.latest_views && r.latest_like_count != null ? (r.latest_like_count + (r.latest_comment_count ?? 0)) / r.latest_views : null;

const FILTERS: { id: Filter; label: string; title: string }[] = [
  { id: 'all', label: 'All', title: 'Every saved reel' },
  { id: 'new', label: STATUS_LABEL.new, title: 'Saved, not looked at yet' },
  { id: 'analyzed', label: STATUS_LABEL.analyzed, title: 'You looked at it' },
  { id: 'in_report', label: STATUS_LABEL.in_report, title: 'Picked for a report' },
  { id: 'rejected', label: STATUS_LABEL.rejected, title: 'Not worth keeping' },
];

const inFilter = (r: LibraryReel, f: Filter) => f === 'all' || r.status === f;

function matches(r: LibraryReel, words: string[]): boolean {
  if (!words.length) return true;
  const hay = [r.author_username, r.author_full_name, r.caption, r.notes, r.audio_title].filter(Boolean).join('\n').toLowerCase();
  return words.every((w) => hay.includes(w));
}

function sortReels(rows: LibraryReel[], sort: Sort): LibraryReel[] {
  const time = (s: string | null) => (s ? Date.parse(s) || 0 : 0);
  const key: (r: LibraryReel) => number | null = {
    saved: (r: LibraryReel) => time(r.last_saved_at),
    views: (r: LibraryReel) => r.latest_views,
    channel: (r: LibraryReel) => r.channel_multiple,
    followers: (r: LibraryReel) => r.views_per_follower,
    engagement,
  }[sort];
  return [...rows].sort((a, b) => {
    const ka = key(a);
    const kb = key(b);
    if (ka !== kb) {
      if (ka == null) return 1;
      if (kb == null) return -1;
      return kb - ka;
    }
    return time(b.last_saved_at) - time(a.last_saved_at);
  });
}

export default function ReelsView() {
  const [filter, setFilter] = createSignal<Filter>('all');
  const [sort, setSort] = storedChoice<Sort>('reels.sort', 'saved', ['saved', 'views', 'channel', 'followers', 'engagement']);
  const [beat, setBeat] = storedChoice<Beat>('reels.beat', '0', BEATS.map((b) => b.id));
  const [query, setQuery] = createSignal('');
  let searchEl: HTMLInputElement | undefined;

  const author = () => route().author;
  const site = () => route().site;
  const words = createMemo(() =>
    query()
      .trim()
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean)
      .map((w) => w.replace(/^@/, '')),
  );
  const library = reels;
  const beats = (r: LibraryReel) => beat() === '0' || (r.channel_multiple ?? 0) >= Number(beat());
  // Each picker counts what the other filters leave, so its numbers match what picking shows.
  const forCreators = createMemo(() => library().filter((r) => bySite(r, site())));
  const forSites = createMemo(() => library().filter((r) => byCreator(r, author())));
  const base = createMemo(() => library().filter((r) => byCreator(r, author()) && bySite(r, site()) && beats(r) && matches(r, words())));
  const counts = createMemo(() => {
    const c: Record<Filter, number> = { all: 0, new: 0, analyzed: 0, in_report: 0, rejected: 0 };
    for (const r of base()) for (const f of FILTERS) if (inFilter(r, f.id)) c[f.id]++;
    return c;
  });
  const visible = createMemo(() => sortReels(base().filter((r) => inFilter(r, filter())), sort()));
  const filtered = () => !!(author() || site() || beat() !== '0' || filter() !== 'all' || words().length);
  const clear = () => {
    setQuery('');
    setBeat('0');
    setFilter('all');
    patch({ author: null, site: null }, { replace: true });
  };

  const summary = createMemo(() => {
    const all = library();
    return {
      total: all.length,
      creators: new Set(all.map((r) => `${platformOf(r.platform)}:${r.author_username.toLowerCase()}`)).size,
      outliers: all.filter((r) => (r.channel_multiple ?? 0) >= 2).length,
    };
  });

  // Keep the open row in view when stepping with j/k.
  function openAt(delta: number) {
    const list = visible();
    if (!list.length) return;
    const i = list.findIndex((r) => r.shortcode === route().reel);
    const next = list[i < 0 ? (delta > 0 ? 0 : list.length - 1) : Math.min(list.length - 1, Math.max(0, i + delta))]!;
    patch({ reel: next.shortcode }, { replace: true });
    queueMicrotask(() => document.querySelector(`[data-reel="${CSS.escape(next.shortcode)}"]`)?.scrollIntoView({ block: 'nearest' }));
  }

  useListKeys({ search: () => searchEl, query, clear: () => setQuery(''), step: openAt, blocked: () => false });

  const SortHead = (p: { id: Sort; label: string; title?: string }) => (
    <th class="num" aria-sort={sort() === p.id ? 'descending' : undefined}>
      <button type="button" class="th-sort" onClick={() => setSort(p.id)} title={p.title}>
        {p.label}
      </button>
    </th>
  );

  return (
    <div class="page page-pad">
      <header class="page-head">
        <h1 class="display">Reels</h1>
        <Show when={summary().total > 0}>
          <p class="lede">
            {plural(summary().total, 'reel')} saved from {plural(summary().creators, 'creator')}
            <Show when={summary().outliers > 0}>, {summary().outliers} at twice their creator's usual views or more</Show>.
          </p>
        </Show>
      </header>

      <Show when={summary().total > 0}>
        <div class="controls">
          <div class="seg" role="group" aria-label="Status">
            <For each={FILTERS}>
              {(f) => (
                <button type="button" aria-pressed={filter() === f.id} onClick={() => setFilter(f.id)} title={f.title}>
                  {f.label}
                  <span class="seg-n">{counts()[f.id]}</span>
                </button>
              )}
            </For>
          </div>
          <CreatorPicker rows={forCreators()} value={author()} onChange={(a) => patch({ author: a }, { replace: true })} />
          <SitePicker rows={forSites()} value={site()} onChange={(s) => patch({ site: s }, { replace: true })} />
          <div class="seg" role="group" aria-label="Against the creator's usual views">
            <span class="seg-label">vs usual</span>
            <For each={BEATS}>
              {(b) => (
                <button type="button" aria-pressed={beat() === b.id} title={b.title} onClick={() => setBeat(b.id)}>
                  {b.label}
                </button>
              )}
            </For>
          </div>
          <label class="search search-inline">
            <Icon name="search" size={15} />
            <input
              ref={searchEl}
              type="search"
              placeholder="Search reels"
              aria-label="Search reels: creators, captions, notes, audio"
              value={query()}
              onInput={(e) => setQuery(e.currentTarget.value)}
            />
            <kbd aria-hidden="true">/</kbd>
          </label>
        </div>
      </Show>

      <Show when={summary().total > 0}>
        <div class="result-row">
          <ResultLine shown={visible().length} total={summary().total} noun="reel" filtered={filtered()} onClear={clear} />
        </div>
      </Show>

      <Switch>
        <Match when={summary().total === 0}>
          <StateBlock title="Nothing saved yet">
            <p>
              On Instagram, every video post has a <b>Save reel</b> button next to like, comment and share; on YouTube,{' '}
              <b>Save video</b> sits next to Subscribe and at the top of a Short's buttons (or press{' '}
              <span class="nowrap"><kbd>Alt</kbd>+<kbd>S</kbd></span>). Saved videos land here with their numbers and a copy of the video.
            </p>
          </StateBlock>
        </Match>
        <Match when={visible().length === 0}>
          <StateBlock title={words().length ? `No reels match “${query().trim()}”` : 'No reels fit these filters'}>
            <p>
              {words().length
                ? 'Search covers creators, captions, notes and audio.'
                : 'Loosen one of them, or start over.'}
            </p>
            <button type="button" class="btn" onClick={clear}>
              Clear filters
            </button>
          </StateBlock>
        </Match>
        <Match when={visible().length > 0}>
          <div class="table-wrap">
            <table class="table reels-table">
              <thead>
                <tr>
                  <th class="col-reel" colSpan={2}>
                    Reel
                  </th>
                  <SortHead id="views" label="Views" />
                  <SortHead id="channel" label="vs usual" title="Views against the creator's typical reel (from a profile scan)" />
                  <SortHead id="followers" label="vs followers" title="Views divided by followers" />
                  <SortHead id="engagement" label="Eng." title="(Likes + comments) ÷ views" />
                  <th class="num" title="Age of the reel when it was saved">Age</th>
                  <th class="col-status">Status</th>
                  <SortHead id="saved" label="Saved" />
                </tr>
              </thead>
              <tbody>
                <For each={visible()}>
                  {(r) => {
                    return (
                      <tr
                        data-reel={r.shortcode}
                        aria-selected={route().reel === r.shortcode}
                        onClick={(e) => {
                          if ((e.target as HTMLElement).closest('a')) return;
                          patch({ reel: r.shortcode });
                        }}
                      >
                        <td class="col-cover">
                          <Cover reel={r} class="cover-row" />
                        </td>
                        <td class="col-reel">
                          <a
                            class="row-link"
                            href={hrefFor({ ...route(), reel: r.shortcode })}
                            onClick={(e) => {
                              e.preventDefault();
                              patch({ reel: r.shortcode });
                            }}
                          >
                            @{r.author_username}
                          </a>
                          <Show when={platformOf(r.platform) === 'youtube'}>
                            <span class="site-tag">YouTube</span>
                          </Show>
                          <span class="row-caption">{r.caption?.split('\n').find((l) => l.trim()) ?? 'No caption'}</span>
                        </td>
                        <td class="num strong">{compact(r.latest_views)}</td>
                        <td class="num">
                          <span class="mult" data-tier={r.channel_tier ?? 'normal'}>
                            {multiple(r.channel_multiple)}
                          </span>
                        </td>
                        <td class="num">
                          <span class="mult" data-hot={outlierTier(r.views_per_follower) === 'hot' || outlierTier(r.views_per_follower) === 'blaze'}>
                            {ratio(r.views_per_follower)}
                          </span>
                        </td>
                        <td class="num">{pct(engagement(r))}</td>
                        <td class="num dim">{age(r.age_hours)}</td>
                        <td class="col-status">
                          <span class="pipe" data-tone={STATUS_TONE[r.status]}>{STATUS_LABEL[r.status]}</span>
                        </td>
                        <td class="num dim" title={new Date(r.last_saved_at).toLocaleString()}>
                          {ago(r.last_saved_at)}
                        </td>
                      </tr>
                    );
                  }}
                </For>
              </tbody>
            </table>
          </div>
          <p class="foot-keys" aria-hidden="true">
            <kbd>/</kbd> search <kbd>J</kbd> <kbd>K</kbd> next and previous reel <kbd>Esc</kbd> close
          </p>
        </Match>
      </Switch>
    </div>
  );
}
