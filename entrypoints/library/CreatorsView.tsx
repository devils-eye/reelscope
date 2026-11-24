// Creators: every profile you've scanned, with its baseline and how often it
// breaks out, and how many of their reels you saved. Sortable;
// a row leads to the reels you saved from that creator.
import { createMemo, createSignal, For, Show } from 'solid-js';
import { ago, compact, pct } from '@/lib/format';
import { platformOf, profileUrl } from '@/lib/platform';
import type { ProfileScanSummary } from '@/lib/types';
import { ResultLine, storedChoice, useListKeys } from './filters';
import { go, hrefFor, patch, route } from './route';
import { profiles, savedCountFor } from './store';
import { Icon, plural, StateBlock } from './ui';

type Sort = 'scanned' | 'followers' | 'baseline' | 'outliers' | 'hit' | 'saved';
const SORTS: Sort[] = ['scanned', 'followers', 'baseline', 'outliers', 'hit', 'saved'];
/** A scan older than this is worth running again. */
const STALE_DAYS = 14;

export default function CreatorsView() {
  const [sort, setSort] = storedChoice<Sort>('creators.sort', 'scanned', SORTS);
  const [query, setQuery] = createSignal('');
  let searchEl: HTMLInputElement | undefined;

  const site = () => route().site;
  const saved = (p: ProfileScanSummary) => savedCountFor(p.platform, p.username);
  const key = (p: ProfileScanSummary): number | null =>
    ({
      scanned: Date.parse(p.scanned_at) || 0,
      followers: p.followers,
      baseline: p.baseline_views,
      outliers: p.outlier_count,
      hit: p.hit_rate,
      saved: saved(p),
    })[sort()];
  const all = createMemo(() => profiles());
  const hasYouTube = createMemo(() => all().some((p) => platformOf(p.platform) === 'youtube'));
  const rows = createMemo(() => {
    const q = query().trim().toLowerCase().replace(/^@/, '');
    return all()
      .filter((p) => (!site() || platformOf(p.platform) === site()) && (!q || p.username.toLowerCase().includes(q)))
      .sort((a, b) => {
        const ka = key(a);
        const kb = key(b);
        if (ka !== kb) {
          if (ka == null) return 1;
          if (kb == null) return -1;
          return kb - ka;
        }
        return a.username.localeCompare(b.username);
      });
  });
  const filtered = () => !!(site() || query().trim());

  useListKeys({ search: () => searchEl, query, clear: () => setQuery(''), blocked: () => false });

  const Head = (p: { id: Sort; label: string; title?: string }) => (
    <th class="num" aria-sort={sort() === p.id ? 'descending' : undefined}>
      <button type="button" class="th-sort" onClick={() => setSort(p.id)} title={p.title ? `${p.title}. Sort by it` : 'Sort by it'}>
        {p.label}
      </button>
    </th>
  );

  return (
    <div class="page page-pad">
      <header class="page-head">
        <h1 class="display">Creators</h1>
        <Show when={all().length > 0}>
          <p class="lede">
            {plural(all().length, 'creator')} scanned. A creator's baseline is their typical reel, Short or video: the median views
            of the ones older than three days. A YouTube channel's videos and Shorts are scored apart. Outliers beat it by 2x or more.
          </p>
        </Show>
      </header>
      <Show
        when={all().length > 0}
        fallback={
          <StateBlock title="No creators scanned yet">
            <p>
              On a creator's Instagram profile, the strip under their header offers <b>Scan last 36 reels</b>; on a YouTube
              channel, the same strip scans their videos or their Shorts. Each scan lands here with the creator's baseline and outliers, and
              everything you save from them is measured against it.
            </p>
          </StateBlock>
        }
      >
        <div class="controls">
          <Show when={hasYouTube() || site()}>
            <div class="seg" role="group" aria-label="Site">
              <For each={[null, 'instagram', 'youtube'] as const}>
                {(s) => (
                  <button type="button" aria-pressed={site() === s} onClick={() => patch({ site: s }, { replace: true })}>
                    {s === null ? 'All sites' : s === 'youtube' ? 'YouTube' : 'Instagram'}
                    <span class="seg-n">{s === null ? all().length : all().filter((p) => platformOf(p.platform) === s).length}</span>
                  </button>
                )}
              </For>
            </div>
          </Show>
          <label class="search search-inline">
            <Icon name="search" size={15} />
            <input
              ref={searchEl}
              type="search"
              placeholder="Find a creator"
              aria-label="Find a creator by username"
              value={query()}
              onInput={(e) => setQuery(e.currentTarget.value)}
            />
            <kbd aria-hidden="true">/</kbd>
          </label>
        </div>
        <div class="result-row">
          <ResultLine
            shown={rows().length}
            total={all().length}
            noun="creator"
            filtered={filtered()}
            onClear={() => (setQuery(''), patch({ site: null }, { replace: true }))}
          />
        </div>
        <Show
          when={rows().length > 0}
          fallback={
            <StateBlock title={`No creator matches “${query().trim()}”`}>
              <button type="button" class="btn" onClick={() => setQuery('')}>
                Clear search
              </button>
            </StateBlock>
          }
        >
          <div class="table-wrap">
            <table class="table creators-table">
              <thead>
                <tr>
                  <th>Creator</th>
                  <Head id="followers" label="Followers" />
                  <Head id="baseline" label="Baseline" title="Median views of reels older than three days" />
                  <Head id="outliers" label="Outliers" title="Outliers in their last scan" />
                  <Head id="hit" label="Hit rate" title="Share of scanned reels that are outliers" />
                  <Head id="saved" label="Saved" title="Reels and videos you saved from them" />
                  <Head id="scanned" label="Scanned" />
                </tr>
              </thead>
              <tbody>
                <For each={rows()}>
                  {(p) => {
                    const n = () => saved(p);
                    const yt = platformOf(p.platform) === 'youtube';
                    const s = yt ? 'youtube' : 'instagram';
                    const unit = yt ? 'video' : 'reel';
                    const stale = () => Date.now() - Date.parse(p.scanned_at) > STALE_DAYS * 86400_000;
                    return (
                      <tr
                        onClick={(e) => {
                          if ((e.target as HTMLElement).closest('a')) return;
                          if (n() > 0) go({ view: 'reels', author: p.username, site: hasYouTube() ? s : null });
                        }}
                        classList={{ 'is-static': n() === 0 }}
                      >
                        <td>
                          <span class="creator">
                            <span class="avatar" aria-hidden="true">{p.username.slice(0, 1)}</span>
                            <a class="row-link" href={profileUrl(p.platform, p.username)} target="_blank" rel="noreferrer">
                              @{p.username}
                              <Icon name="external" size={12} />
                            </a>
                            <Show when={yt}>
                              <span
                                class="site-tag"
                                title={p.format === 'long' ? 'This scan scores their long-form videos' : 'This scan scores their Shorts'}
                              >
                                {p.format === 'long' ? 'YouTube videos' : 'YouTube Shorts'}
                              </span>
                            </Show>
                          </span>
                        </td>
                        <td class="num">{compact(p.followers)}</td>
                        <td class="num strong">{compact(p.baseline_views)}</td>
                        <td class="num">
                          <span class="mult" data-hot={p.outlier_count > 0}>{p.outlier_count}</span>
                          <span class="dim"> of {p.sample_size}</span>
                        </td>
                        <td class="num">{pct(p.hit_rate)}</td>
                        <td class="num">
                          <Show when={n() > 0} fallback={<span class="dim">–</span>}>
                            <a class="text-link" href={hrefFor({ view: 'reels', author: p.username, site: hasYouTube() ? s : null })}>
                              {plural(n(), unit)}
                            </a>
                          </Show>
                        </td>
                        <td
                          class="num"
                          classList={{ dim: !stale(), 'is-stale': stale() }}
                          title={`${new Date(p.scanned_at).toLocaleString()}${stale() ? `. Over ${STALE_DAYS} days old: scan them again for a current baseline` : ''}`}
                        >
                          {ago(p.scanned_at)}
                        </td>
                      </tr>
                    );
                  }}
                </For>
              </tbody>
            </table>
          </div>
        </Show>
      </Show>
    </div>
  );
}
