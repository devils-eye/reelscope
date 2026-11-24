// Filters shared by Reels and Creators: a searchable creator picker,
// the Instagram / YouTube switch, and the "Showing 12 of 226" line with its
// way out. Creator and site live in the URL (route.ts), so a filtered view
// survives reloads and can be linked to.
import { createEffect, createMemo, createSignal, For, onCleanup, Show } from 'solid-js';
import type { LibraryReel } from '@/lib/api';
import { platformOf } from '@/lib/platform';
import type { Platform } from '@/lib/types';
import { Icon, isTyping, plural } from './ui';

export interface CreatorOption {
  /** Lowercase username: what the route stores. */
  key: string;
  username: string;
  n: number;
  /** Sites they were saved from. */
  sites: Platform[];
}

/** Anything with a creator. */
export type Authored = { author_username: string | null; platform?: unknown };

/** The creators behind these rows, most rows first. */
export function creatorsIn(rows: readonly Authored[]): CreatorOption[] {
  const by = new Map<string, CreatorOption>();
  for (const r of rows) {
    if (!r.author_username) continue;
    const key = r.author_username.toLowerCase();
    const site = platformOf(r.platform);
    const cur = by.get(key);
    if (cur) {
      cur.n++;
      if (!cur.sites.includes(site)) cur.sites.push(site);
    } else by.set(key, { key, username: r.author_username, n: 1, sites: [site] });
  }
  return [...by.values()].sort((a, b) => b.n - a.n || a.username.localeCompare(b.username));
}

export const byCreator = (r: Authored, author: string | null) => !author || r.author_username?.toLowerCase() === author.toLowerCase();
export const bySite = (r: LibraryReel, site: Platform | null) => !site || platformOf(r.platform) === site;

/**
 * "Creator: Anyone" button that opens a searchable list of the creators in
 * `rows`, with how many rows each has there. Arrow keys move, Enter picks,
 * Esc closes.
 */
export function CreatorPicker(props: { rows: readonly Authored[]; value: string | null; onChange: (key: string | null) => void; noun?: string }) {
  const [open, setOpen] = createSignal(false);
  const [q, setQ] = createSignal('');
  const [active, setActive] = createSignal(0);
  let root: HTMLDivElement | undefined;
  let input: HTMLInputElement | undefined;
  let list: HTMLUListElement | undefined;

  const all = createMemo(() => creatorsIn(props.rows));
  const shown = createMemo(() => {
    const w = q().trim().toLowerCase().replace(/^@/, '');
    return w ? all().filter((c) => c.key.includes(w)) : all();
  });
  /** Row 0 is "Anyone" while not searching. */
  const options = createMemo<Array<CreatorOption | null>>(() => (q().trim() ? shown() : [null, ...shown()]));
  const current = () => all().find((c) => c.key === props.value?.toLowerCase());

  const pick = (c: CreatorOption | null) => {
    props.onChange(c ? c.key : null);
    setOpen(false);
  };

  createEffect(() => {
    if (!open()) return;
    setQ('');
    const i = options().findIndex((c) => (c?.key ?? null) === (props.value?.toLowerCase() ?? null));
    setActive(Math.max(0, i));
    queueMicrotask(() => {
      input?.focus();
      list?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
    });
    const away = (e: PointerEvent) => !root?.contains(e.target as Node) && setOpen(false);
    document.addEventListener('pointerdown', away);
    onCleanup(() => document.removeEventListener('pointerdown', away));
  });

  const move = (d: number) => {
    const n = options().length;
    if (!n) return;
    setActive((i) => (i + d + n) % n);
    queueMicrotask(() => list?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' }));
  };

  return (
    <div class="picker" ref={root}>
      <button
        type="button"
        class="picker-btn"
        classList={{ 'is-set': !!props.value }}
        aria-haspopup="listbox"
        aria-expanded={open()}
        onClick={() => setOpen(!open())}
      >
        <span class="select-label">Creator</span>
        <span class="picker-value">{props.value ? `@${current()?.username ?? props.value}` : 'Anyone'}</span>
        <Icon name="chevron" size={12} />
      </button>
      <Show when={props.value}>
        <button type="button" class="picker-clear" aria-label="Show every creator" title="Every creator" onClick={() => props.onChange(null)}>
          <Icon name="close" size={12} />
        </button>
      </Show>
      <Show when={open()}>
        <div class="picker-pop" role="dialog" aria-label="Pick a creator">
          <label class="picker-search">
            <Icon name="search" size={14} />
            <input
              ref={input}
              type="search"
              placeholder={`Find among ${plural(all().length, 'creator')}`}
              aria-controls="picker-list"
              aria-activedescendant={`picker-opt-${active()}`}
              value={q()}
              onInput={(e) => {
                setQ(e.currentTarget.value);
                setActive(0);
              }}
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown') (e.preventDefault(), move(1));
                else if (e.key === 'ArrowUp') (e.preventDefault(), move(-1));
                else if (e.key === 'Enter') {
                  e.preventDefault();
                  const c = options()[active()];
                  if (c !== undefined) pick(c);
                } else if (e.key === 'Escape') {
                  e.stopPropagation();
                  setOpen(false);
                }
              }}
            />
          </label>
          <ul class="picker-list" id="picker-list" role="listbox" ref={list}>
            <For each={options()} fallback={<li class="picker-none">No creator matches “{q().trim()}”</li>}>
              {(c, i) => (
                <li
                  id={`picker-opt-${i()}`}
                  role="option"
                  aria-selected={i() === active()}
                  data-current={(c?.key ?? null) === (props.value?.toLowerCase() ?? null) ? '' : undefined}
                  onPointerEnter={() => setActive(i())}
                  onClick={() => pick(c)}
                >
                  <Show
                    when={c}
                    fallback={
                      <>
                        <span class="avatar avatar-sm" aria-hidden="true">
                          <Icon name="people" size={12} />
                        </span>
                        <span class="picker-name">Anyone</span>
                        <span class="picker-n">{props.rows.length}</span>
                      </>
                    }
                  >
                    {(o) => (
                      <>
                        <span class="avatar avatar-sm" aria-hidden="true">{o().username.slice(0, 1)}</span>
                        <span class="picker-name">@{o().username}</span>
                        <Show when={o().sites.includes('youtube')}>
                          <span class="site-tag">YouTube</span>
                        </Show>
                        <span class="picker-n">{o().n}</span>
                      </>
                    )}
                  </Show>
                </li>
              )}
            </For>
          </ul>
        </div>
      </Show>
    </div>
  );
}

/** All / Instagram / YouTube, with counts. Hidden while every row is from one site (and no site is picked). */
export function SitePicker(props: { rows: readonly LibraryReel[]; value: Platform | null; onChange: (site: Platform | null) => void }) {
  const counts = createMemo(() => {
    let yt = 0;
    for (const r of props.rows) if (platformOf(r.platform) === 'youtube') yt++;
    return { all: props.rows.length, instagram: props.rows.length - yt, youtube: yt };
  });
  const opts: Array<{ id: Platform | null; label: string }> = [
    { id: null, label: 'All sites' },
    { id: 'instagram', label: 'Instagram' },
    { id: 'youtube', label: 'YouTube' },
  ];
  return (
    <Show when={props.value || (counts().instagram > 0 && counts().youtube > 0)}>
      <div class="seg" role="group" aria-label="Site">
        <For each={opts}>
          {(o) => (
            <button type="button" aria-pressed={props.value === o.id} onClick={() => props.onChange(o.id)}>
              {o.label}
              <span class="seg-n">{counts()[o.id ?? 'all']}</span>
            </button>
          )}
        </For>
      </div>
    </Show>
  );
}

/** "Showing 12 of 226 reels · Clear filters", only while something narrows the list. */
export function ResultLine(props: { shown: number; total: number; noun: string; filtered: boolean; onClear: () => void; children?: unknown }) {
  return (
    <Show when={props.filtered}>
      <p class="result-line" role="status">
        Showing <b>{props.shown.toLocaleString('en-US')}</b> of {plural(props.total, props.noun)}
        <button type="button" class="text-btn" onClick={() => props.onClear()}>
          Clear filters
        </button>
      </p>
    </Show>
  );
}

/** A select kept in localStorage under `library.<key>`. */
export function storedChoice<T extends string>(key: string, initial: T, allowed: readonly T[]) {
  const v = localStorage.getItem(`library.${key}`) as T | null;
  const [get, set] = createSignal<T>(v && allowed.includes(v) ? v : initial);
  createEffect(() => localStorage.setItem(`library.${key}`, get()));
  return [get, set] as const;
}

/** `/` focuses the search box; Esc in it clears, then leaves. j/k step through `step` when given. */
export function useListKeys(opts: { search: () => HTMLInputElement | undefined; query: () => string; clear: () => void; step?: (d: number) => void; blocked: () => boolean }) {
  const onKey = (e: KeyboardEvent) => {
    if (e.metaKey || e.ctrlKey || e.altKey || opts.blocked()) return;
    const el = opts.search();
    if (isTyping(e.target)) {
      if (e.key === 'Escape' && e.target === el) {
        if (opts.query()) opts.clear();
        else el?.blur();
      }
      return;
    }
    if (e.key === '/') {
      e.preventDefault();
      el?.focus();
      el?.select();
    } else if (opts.step && (e.key === 'j' || e.key === 'k')) {
      opts.step(e.key === 'j' ? 1 : -1);
    }
  };
  window.addEventListener('keydown', onKey);
  onCleanup(() => window.removeEventListener('keydown', onKey));
}
