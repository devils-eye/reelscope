// Instagram is an SPA. WXT's `wxt:locationchange` is dispatched from the
// Navigation API's `navigate` event, which fires *before* the URL commits, so
// reading `location` in that handler gives the previous page (that is how the
// home feed ended up saying "Analyze @sebastien"). Polling `location.href` is
// cheap, browser-agnostic and always sees the committed URL; popstate and
// history calls just make it react sooner.

export interface Timers {
  setInterval(fn: () => void, ms: number): unknown;
  setTimeout(fn: () => void, ms: number): unknown;
  addEventListener(target: EventTarget, type: string, fn: (e: Event) => void): void;
}

export const windowTimers: Timers = {
  setInterval: (fn, ms) => window.setInterval(fn, ms),
  setTimeout: (fn, ms) => window.setTimeout(fn, ms),
  addEventListener: (t, type, fn) => t.addEventListener(type, fn),
};

const POLL_MS = 400;

export function watchLocation(timers: Timers, onChange: (url: URL) => void): () => void {
  let last = location.href;
  let stopped = false;
  const check = () => {
    if (stopped || location.href === last) return;
    last = location.href;
    onChange(new URL(last));
  };
  timers.setInterval(check, POLL_MS);
  // Next tick: by then pushState/popstate have committed the new URL.
  const soon = () => void timers.setTimeout(check, 0);
  timers.addEventListener(window, 'popstate', soon);
  timers.addEventListener(window, 'wxt:locationchange', soon);
  return () => {
    stopped = true;
  };
}
