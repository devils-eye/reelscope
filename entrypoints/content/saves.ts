// One save state per shortcode, shared by every surface that can save a reel
// (inline post buttons, Alt+S, the profile panel), so the same reel never
// shows "Saved" in one place and "Save" in another.
import { createSignal, type Accessor, type Setter } from 'solid-js';
import type { ChannelContext, ReelLatestRow, SaveResult } from '@/lib/types';
import type { PanelDeps } from './panel-deps';

export type SaveState =
  | { kind: 'idle' }
  | { kind: 'saving' }
  /** `row` is set when saved in this session; absent when known from the library. */
  | { kind: 'saved'; row?: ReelLatestRow; isNew?: boolean }
  | { kind: 'queued' }
  | { kind: 'error'; message: string };

export type ToastMsg =
  | { kind: 'saving'; code: string }
  | { kind: 'saved'; code: string; row: ReelLatestRow; isNew: boolean }
  | { kind: 'queued'; code: string }
  | { kind: 'error'; code: string | null; message: string };

const ERRORS: Record<string, string> = {
  'no-reel-found': 'No reel in view',
  'no-background-response': 'Extension not responding. Reload the page',
  'instagram-rate-limited': 'Instagram is limiting requests. Try again in a few minutes',
};

export function saveErrorText(error: string | undefined): string {
  if (!error) return 'Save failed';
  if (ERRORS[error]) return ERRORS[error];
  if (/media info responded (401|403)/.test(error)) return 'Instagram refused (logged out?)';
  if (/media info|items\[0\]/.test(error)) return "Couldn't read this reel from Instagram";
  return error;
}

const LOOKUP_DELAY_MS = 300;
const LOOKUP_CHUNK = 50;

export interface SaveController {
  state(code: string): SaveState;
  /** Ask the library (batched) whether these reels are already saved. */
  watch(codes: readonly string[]): void;
  save(code: string, opts?: { channel?: ChannelContext; toast?: boolean }): Promise<SaveResult | null>;
  toast: Accessor<{ id: number; msg: ToastMsg } | null>;
  showToast(msg: ToastMsg): void;
  dismissToast(): void;
}

export function createSaveController(deps: Pick<PanelDeps, 'saveReel' | 'savedShortcodes'>): SaveController {
  const states = new Map<string, [Accessor<SaveState>, Setter<SaveState>]>();
  const sig = (code: string) => {
    let s = states.get(code);
    if (!s) {
      s = createSignal<SaveState>({ kind: 'idle' });
      states.set(code, s);
    }
    return s;
  };

  const looked = new Set<string>();
  const pending = new Set<string>();
  let timer: ReturnType<typeof setTimeout> | undefined;

  async function flush() {
    timer = undefined;
    const codes = [...pending];
    pending.clear();
    for (let i = 0; i < codes.length; i += LOOKUP_CHUNK) {
      const chunk = codes.slice(i, i + LOOKUP_CHUNK);
      let saved: string[] = [];
      try {
        saved = await deps.savedShortcodes(chunk);
      } catch {
        // Server down: leave them idle; saving still queues.
      }
      for (const code of saved) {
        const [get, set] = sig(code);
        if (get().kind === 'idle') set({ kind: 'saved' });
      }
    }
  }

  const [toast, setToast] = createSignal<{ id: number; msg: ToastMsg } | null>(null);
  let toastId = 0;
  const showToast = (msg: ToastMsg) => setToast({ id: ++toastId, msg });

  async function doSave(code: string, opts: { channel?: ChannelContext; toast?: boolean }) {
    const [, set] = sig(code);
    set({ kind: 'saving' });
    if (opts.toast) showToast({ kind: 'saving', code });
    let res: SaveResult;
    try {
      res = await deps.saveReel(code, opts.channel);
    } catch (e) {
      res = { ok: false, queued: false, error: e instanceof Error ? e.message : String(e) };
    }
    if (res.ok) {
      set({ kind: 'saved', row: res.data, isNew: res.isNew });
      if (opts.toast) showToast({ kind: 'saved', code, row: res.data, isNew: res.isNew });
    } else if (res.queued) {
      set({ kind: 'queued' });
      if (opts.toast) showToast({ kind: 'queued', code });
    } else {
      const message = saveErrorText(res.error);
      set({ kind: 'error', message });
      if (opts.toast) showToast({ kind: 'error', code, message });
    }
    return res;
  }

  /** One save per reel at a time: a second click while saving gets the same promise. */
  const inflight = new Map<string, Promise<SaveResult>>();

  return {
    state: (code) => sig(code)[0](),
    watch(codes) {
      for (const code of codes) {
        if (looked.has(code)) continue;
        looked.add(code);
        pending.add(code);
      }
      if (pending.size > 0 && timer === undefined) timer = setTimeout(() => void flush(), LOOKUP_DELAY_MS);
    },
    save(code, opts = {}) {
      const running = inflight.get(code);
      if (running) return running;
      const p = doSave(code, opts).finally(() => inflight.delete(code));
      inflight.set(code, p);
      return p;
    },
    toast,
    showToast,
    dismissToast: () => setToast(null),
  };
}
