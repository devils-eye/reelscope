// Hash routes, so views and the open reel survive reloads, work with Back,
// and can be linked to from the popup:
//   #/reels                                   every saved reel and video
//   #/reels?author=zackdfilms&site=youtube    one creator, one site
//   #/reels?reel=DUm_MGfjNan                  ...with that reel's sheet open
//   #/creators                                every scanned creator (site= too)
// `reel` opens the reel sheet, so it works on any view.
import { createSignal } from 'solid-js';
import type { Platform } from '@/lib/types';

export type View = 'reels' | 'creators';

export interface Route {
  view: View;
  /** Open reel shortcode (the reel sheet opens over any view). */
  reel: string | null;
  /** Reels: only this creator's. */
  author: string | null;
  /** Reels and Creators: only this site. */
  site: Platform | null;
}

const VIEWS: readonly View[] = ['reels', 'creators'];

export function parseHash(hash: string): Route {
  const raw = hash.replace(/^#\/?/, '');
  const [path = '', query = ''] = raw.split('?');
  const first = decodeURIComponent(path.split('/')[0] ?? '');
  const q = new URLSearchParams(query);
  const view = (VIEWS as readonly string[]).includes(first) ? (first as View) : 'reels';
  const site = q.get('site');
  return {
    view,
    reel: q.get('reel') || null,
    author: view === 'reels' ? q.get('author') || null : null,
    site: site === 'instagram' || site === 'youtube' ? site : null,
  };
}

export function toHash(r: Partial<Route> & { view: View }): string {
  const q = new URLSearchParams();
  if (r.view === 'reels' && r.author) q.set('author', r.author);
  if (r.site) q.set('site', r.site);
  if (r.reel) q.set('reel', r.reel);
  const s = q.toString();
  return s ? `#/${r.view}?${s}` : `#/${r.view}`;
}

const [route, setRoute] = createSignal<Route>(parseHash(location.hash));
window.addEventListener('hashchange', () => setRoute(parseHash(location.hash)));

export { route };

/** Go somewhere. `replace` keeps Back from stepping through every small change. */
export function go(next: Partial<Route> & { view: View }, opts: { replace?: boolean } = {}): void {
  const hash = toHash(next);
  if (hash === location.hash) return;
  if (opts.replace) {
    history.replaceState(null, '', hash);
    setRoute(parseHash(hash));
  } else {
    location.hash = hash;
  }
}

/** Change part of the current route. */
export function patch(change: Partial<Route>, opts: { replace?: boolean } = {}): void {
  go({ ...route(), ...change }, opts);
}

export function hrefFor(r: Partial<Route> & { view: View }): string {
  return toHash(r);
}
