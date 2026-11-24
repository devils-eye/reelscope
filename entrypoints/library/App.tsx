// The library: Reels (everything you saved, with its numbers and video) and
// Creators (profile and channel scans). A reel sheet opens over either.
import { createEffect, createSignal, Match, onCleanup, onMount, Show, Switch } from 'solid-js';
import { SERVER_BASE_URL } from '@/lib/config';
import { applyTheme, currentTheme, storeTheme, type Theme } from '@/lib/pageTheme';
import CreatorsView from './CreatorsView';
import ReelSheet from './ReelSheet';
import ReelsView from './ReelsView';
import { hrefFor, patch, route, type View } from './route';
import { errorText, profiles, reelBy, reels, refresh, state } from './store';
import { Command, Icon, StateBlock } from './ui';

const TITLES: Record<View, string> = { reels: 'Reels', creators: 'Creators' };

export default function App() {
  const [theme, setTheme] = createSignal<Theme>(currentTheme());
  createEffect(() => applyTheme(theme()));
  const flipTheme = () => {
    const next = theme() === 'dark' ? 'light' : 'dark';
    storeTheme(next);
    setTheme(next);
  };

  onMount(() => {
    void refresh();
    const onVisible = () => document.visibilityState === 'visible' && void refresh();
    document.addEventListener('visibilitychange', onVisible);
    onCleanup(() => document.removeEventListener('visibilitychange', onVisible));
  });

  createEffect(() => {
    document.title = `${TITLES[route().view]} – ReelScope`;
  });

  // A link to a reel that no longer exists just closes the sheet.
  createEffect(() => {
    if (state() !== 'ready') return;
    const r = route();
    if (r.reel && !reelBy(r.reel)) patch({ reel: null }, { replace: true });
  });

  const openReel = () => (state() === 'ready' && route().reel ? reelBy(route().reel!) : undefined);

  const NavLink = (p: { view: View; count: number }) => (
    <a class="nav-link" href={hrefFor({ view: p.view })} aria-current={route().view === p.view ? 'page' : undefined}>
      {TITLES[p.view]}
      <Show when={state() === 'ready'}>
        <span class="nav-n">{p.count}</span>
      </Show>
    </a>
  );

  return (
    <div class="app" classList={{ 'has-sheet': !!openReel() }}>
      <a class="skip" href="#main">
        Skip to content
      </a>
      <header class="topbar">
        <a class="wordmark" href={hrefFor({ view: 'reels' })}>
          ReelScope
        </a>
        <nav class="nav" aria-label="Library">
          <NavLink view="reels" count={reels().length} />
          <NavLink view="creators" count={profiles().length} />
        </nav>
        <div class="topbar-end">
          <Show when={state() === 'down'}>
            <span class="server-down" role="status">
              <i aria-hidden="true" />
              Server offline
            </span>
          </Show>
          <button
            type="button"
            class="icon-btn"
            onClick={flipTheme}
            aria-label={theme() === 'dark' ? 'Use the light theme' : 'Use the dark theme'}
            title={theme() === 'dark' ? 'Light theme' : 'Dark theme'}
          >
            <Icon name={theme() === 'dark' ? 'sun' : 'moon'} />
          </button>
        </div>
      </header>

      <main id="main" class="main" tabIndex={-1}>
        <Switch>
          <Match when={state() === 'loading'}>
            <p class="loading" role="status">
              Loading your library
            </p>
          </Match>
          <Match when={state() === 'down'}>
            <div class="page-pad">
              <StateBlock title="The library server isn't running">
                <p>
                  Saved reels and scans live in a small server on this computer ({SERVER_BASE_URL.replace(/^https?:\/\//, '')}). Start
                  it from the project folder:
                </p>
                <Command cmd="bun run server" />
                <p class="dim">This page reconnects on its own as soon as it's up.</p>
              </StateBlock>
            </div>
          </Match>
          <Match when={state() === 'error'}>
            <div class="page-pad">
              <StateBlock title="The server answered with an error" tone="bad">
                <p>
                  <code>{errorText()}</code>
                </p>
                <button type="button" class="btn" onClick={() => void refresh()}>
                  Try again
                </button>
              </StateBlock>
            </div>
          </Match>
          <Match when={route().view === 'reels'}>
            <ReelsView />
          </Match>
          <Match when={route().view === 'creators'}>
            <CreatorsView />
          </Match>
        </Switch>
      </main>

      <Show when={openReel()}>{(r) => <ReelSheet reel={r} />}</Show>
    </div>
  );
}
