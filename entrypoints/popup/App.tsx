// Toolbar popup: is the server up, what the library holds, the last few
// saves, and the way into the library.
import { createResource, For, Match, Show, Switch } from 'solid-js';
import { getSummary, listReels, ServerDownError, thumbUrl } from '@/lib/api';
import { ago, compact, multiple } from '@/lib/format';
import { siteName } from '@/lib/platform';
import type { StatusResult } from '@/lib/types';

const RECENT = 5;

async function queueStatus(): Promise<StatusResult | null> {
  try {
    return (await browser.runtime.sendMessage({ type: 'status' })) as StatusResult;
  } catch {
    return null;
  }
}

async function load() {
  try {
    const [summary, recent] = await Promise.all([
      getSummary(),
      listReels({ limit: RECENT, sort: 'saved' }),
    ]);
    return { up: true as const, summary, recent };
  } catch (e) {
    return { up: false as const, down: e instanceof ServerDownError };
  }
}

async function openLibrary(hash = '') {
  await browser.tabs.create({ url: browser.runtime.getURL(`/library.html${hash}`) });
  window.close();
}

export default function App() {
  const [data] = createResource(load);
  const [queue] = createResource(queueStatus);
  const queued = () => queue()?.pending ?? 0;
  const up = () => {
    const d = data();
    return d?.up ? d : undefined;
  };

  return (
    <main class="pop">
      <header class="pop-head">
        <h1>ReelScope</h1>
        <Show when={data()}>
          {(d) => (
            <span class="pop-status" data-up={d().up}>
              <i aria-hidden="true" />
              {d().up ? 'Server running' : 'Server offline'}
            </span>
          )}
        </Show>
      </header>

      <Switch>
        <Match when={data.loading}>
          <p class="pop-line dim">Checking the server</p>
        </Match>
        <Match when={data() && !data()!.up}>
          <section class="pop-offline">
            <p>
              Saves made now wait here
              <Show when={queued() > 0}> ({queued()} so far)</Show> and sync once the server is back. Start it from the project
              folder:
            </p>
            <code>bun run server</code>
          </section>
        </Match>
        <Match when={up()}>
          {(v) => {
            const s = v().summary;
            return (
              <>
                <p class="pop-line">
                  <Show
                    when={s.reels > 0}
                    fallback={
                      <>
                        Nothing saved yet. On Instagram or YouTube, click <b>Save</b> on a video (Alt+S), or scan a creator to find
                        their outliers.
                      </>
                    }
                  >
                    <b>{s.reels}</b> {s.reels === 1 ? 'video' : 'videos'} saved
                    <Show when={s.instagram > 0 && s.youtube > 0}>
                      {' '}
                      ({s.instagram} Instagram, {s.youtube} YouTube)
                    </Show>
                    .
                  </Show>
                  <Show when={s.creators > 0}>
                    {' '}
                    <b>{s.creators}</b> {s.creators === 1 ? 'creator' : 'creators'} scanned.
                  </Show>
                </p>
                <Show when={queued() > 0}>
                  <p class="pop-line pop-warn">
                    {queued()} {queued() === 1 ? 'save is' : 'saves are'} queued and will sync in a moment.
                  </p>
                </Show>
                <Show when={v().recent.length > 0}>
                  <section class="pop-recent" aria-labelledby="pop-recent-h">
                    <h2 id="pop-recent-h">Latest saves</h2>
                    <ul>
                      <For each={v().recent}>
                        {(r) => (
                          <li>
                            <button type="button" class="pop-row" onClick={() => void openLibrary(`#/reels?reel=${encodeURIComponent(r.shortcode)}`)}>
                              <span class="pop-thumb">
                                <Show when={r.has_thumb !== false} fallback={<span>{r.author_username.slice(0, 1)}</span>}>
                                  <img src={thumbUrl(r.shortcode)} alt="" loading="lazy" />
                                </Show>
                              </span>
                              <span class="pop-who">
                                <span class="pop-handle">@{r.author_username}</span>
                                <span class="pop-cap">{r.caption?.split('\n').find((l) => l.trim()) ?? 'No caption'}</span>
                              </span>
                              <span class="pop-nums">
                                <span class="pop-views">
                                  {compact(r.latest_views)}
                                  <Show when={r.channel_multiple != null}>
                                    {' '}
                                    <span class="pop-mult" data-tier={r.channel_tier ?? 'normal'}>
                                      {multiple(r.channel_multiple)}
                                    </span>
                                  </Show>
                                </span>
                                <span class="pop-pipe">
                                  {siteName(r.platform)}, {ago(r.last_saved_at)}
                                </span>
                              </span>
                            </button>
                          </li>
                        )}
                      </For>
                    </ul>
                  </section>
                </Show>
              </>
            );
          }}
        </Match>
      </Switch>

      <footer class="pop-foot">
        <button type="button" class="pop-open" onClick={() => void openLibrary()}>
          Open library
        </button>
      </footer>
    </main>
  );
}
