// Runs in the PAGE's JavaScript world (entrypoints/ig-hook.content.ts, at
// document_start), never in the content script. It watches the responses
// Instagram's own app already receives and forwards the media items and user
// objects in them to the content script, so we never call Instagram's API
// ourselves.
//
// Rules: never change what the page sees. The original fetch promise is
// returned untouched, bodies are read from a clone(), XHR is only observed
// through a 'load' listener, and every step is wrapped in try/catch.
import {
  decodeMessage,
  encodeMessage,
  extractCaptures,
  isCaptureUrl,
  mayHoldCaptures,
  parseResponseText,
  type CapturedUser,
  type Media,
} from './igCapture';

const INSTALLED = Symbol.for('reelscope.page-hook');
const MAX_BODY = 20_000_000;
/** Kept for the content script's startup replay (it starts after document_idle). */
const REPLAY_MEDIA = 400;
const REPLAY_USERS = 300;

type HookWindow = Window & typeof globalThis & { [INSTALLED]?: true };

export function installPageHook(win: HookWindow = window as HookWindow): void {
  if (win[INSTALLED]) return;
  win[INSTALLED] = true;

  const recentMedia = new Map<string, Media>();
  const recentUsers = new Map<string, CapturedUser>();
  const origin = win.location.origin;

  function post(media: Media[], users: CapturedUser[]) {
    if (media.length === 0 && users.length === 0) return;
    for (const m of media) {
      recentMedia.delete(m.code);
      recentMedia.set(m.code, m);
    }
    for (const u of users) recentUsers.set(u.username.toLowerCase(), u);
    while (recentMedia.size > REPLAY_MEDIA) recentMedia.delete(recentMedia.keys().next().value!);
    while (recentUsers.size > REPLAY_USERS) recentUsers.delete(recentUsers.keys().next().value!);
    try {
      win.postMessage(encodeMessage({ kind: 'capture', media, users }), origin);
    } catch {
      // unserialisable item: drop it
    }
  }

  function handleText(text: string) {
    if (!text || text.length > MAX_BODY) return;
    const media: Media[] = [];
    const users: CapturedUser[] = [];
    for (const doc of parseResponseText(text)) {
      const got = extractCaptures(doc);
      media.push(...got.media);
      users.push(...got.users);
    }
    post(media, users);
  }

  const later = (fn: () => void) => {
    try {
      win.setTimeout(() => {
        try {
          fn();
        } catch {
          // never surface into the page
        }
      }, 0);
    } catch {
      // ignore
    }
  };

  // ---- fetch -------------------------------------------------------------------
  const origFetch = win.fetch;
  if (typeof origFetch === 'function') {
    const wrapped = function fetch(this: unknown, ...args: Parameters<typeof win.fetch>): Promise<Response> {
      const p = origFetch.apply(this ?? win, args) as Promise<Response>;
      try {
        const input = args[0];
        const url = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request)?.url;
        if (typeof url === 'string' && isCaptureUrl(url, origin)) {
          p.then(
            (res) => {
              try {
                if (!res.ok || res.type === 'opaque') return;
                res
                  .clone()
                  .text()
                  .then((t) => later(() => handleText(t)), () => {});
              } catch {
                // body already used / locked: skip
              }
            },
            () => {},
          );
        }
      } catch {
        // never break the page's request
      }
      return p;
    };
    try {
      Object.defineProperty(wrapped, 'name', { value: 'fetch' });
      Object.defineProperty(wrapped, 'toString', { value: () => origFetch.toString(), configurable: true });
      win.fetch = wrapped as typeof win.fetch;
    } catch {
      // read-only fetch: give up on fetch, XHR still works
    }
  }

  // ---- XMLHttpRequest ---------------------------------------------------------------
  try {
    const proto = win.XMLHttpRequest.prototype;
    const origOpen = proto.open;
    const origSend = proto.send;
    const urls = new WeakMap<XMLHttpRequest, string>();
    proto.open = function open(this: XMLHttpRequest, ...args: unknown[]) {
      try {
        const u = args[1];
        urls.set(this, typeof u === 'string' ? u : u instanceof URL ? u.href : String(u));
      } catch {
        // ignore
      }
      return (origOpen as (...a: unknown[]) => void).apply(this, args);
    } as typeof proto.open;
    proto.send = function send(this: XMLHttpRequest, ...args: unknown[]) {
      try {
        const url = urls.get(this);
        if (url && isCaptureUrl(url, origin)) {
          const xhr = this;
          xhr.addEventListener('load', () => {
            try {
              if (xhr.status < 200 || xhr.status >= 300) return;
              const rt = xhr.responseType;
              if (rt === '' || rt === 'text') {
                const t = xhr.responseText;
                later(() => handleText(t));
              } else if (rt === 'json' && xhr.response) {
                const doc = xhr.response as unknown;
                later(() => {
                  const got = extractCaptures(doc);
                  post(got.media, got.users);
                });
              }
            } catch {
              // ignore
            }
          });
        }
      } catch {
        // ignore
      }
      return (origSend as (...a: unknown[]) => void).apply(this, args);
    } as typeof proto.send;
  } catch {
    // no XHR to observe
  }

  // ---- SSR JSON blobs ------------------------------------------------------------------
  // The first page of a profile or feed usually arrives inside the HTML as
  // <script type="application/json"> blobs. Parser-inserted scripts get their
  // text in chunks, so blobs are only read once the document has parsed; ones
  // added later (SPA navigation) are read when they appear.
  const seen = new WeakSet<Element>();
  function readBlob(el: Element) {
    if (seen.has(el)) return;
    const text = el.textContent ?? '';
    if (!text || !mayHoldCaptures(text)) {
      seen.add(el);
      return;
    }
    let doc: unknown;
    try {
      doc = JSON.parse(text);
    } catch {
      return; // incomplete; try again later
    }
    seen.add(el);
    const got = extractCaptures(doc);
    post(got.media, got.users);
  }
  const readAll = () => {
    try {
      win.document.querySelectorAll('script[type="application/json"]').forEach(readBlob);
    } catch {
      // ignore
    }
  };
  let parsed = win.document.readyState !== 'loading';
  if (parsed) later(readAll);
  else
    win.document.addEventListener('DOMContentLoaded', () => {
      parsed = true;
      later(readAll);
    });
  try {
    const mo = new win.MutationObserver((records) => {
      if (!parsed) return;
      let found = false;
      for (const r of records) {
        for (const n of Array.from(r.addedNodes)) {
          if (n.nodeName === 'SCRIPT' && (n as Element).getAttribute('type') === 'application/json') found = true;
        }
      }
      if (found) later(readAll);
    });
    mo.observe(win.document, { childList: true, subtree: true });
  } catch {
    // ignore
  }

  // ---- replay for a late content script -------------------------------------------------
  win.addEventListener('message', (e: MessageEvent) => {
    try {
      if (e.source !== win) return;
      const m = decodeMessage(e.data);
      if (m?.kind !== 'replay') return;
      post([...recentMedia.values()], [...recentUsers.values()]);
    } catch {
      // ignore
    }
  });
}
