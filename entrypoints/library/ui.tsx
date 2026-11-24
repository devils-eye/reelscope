// Small shared pieces: icons, covers, status words, copy buttons and the
// empty/error state block.
import { createSignal, onCleanup, Show, type JSX } from 'solid-js';
import { thumbUrl, type LibraryReel } from '@/lib/api';
import type { ReelStatus } from '@/lib/types';

// ---- icons (16px grid, stroke follows currentColor) --------------------------
// Functions, not elements: Solid JSX makes real DOM nodes, and one node can
// only sit in one place.

const PATHS = {
  search: () => <><circle cx="7" cy="7" r="4.5" /><path d="M10.4 10.4L14 14" /></>,
  close: () => <path d="M4 4l8 8M12 4l-8 8" />,
  external: () => <path d="M9.5 2.5h4v4M13.5 2.5L7.5 8.5M12 9.5v3a1 1 0 01-1 1H3.5a1 1 0 01-1-1V5a1 1 0 011-1h3" />,
  copy: () => <><rect x="5.5" y="5.5" width="8" height="8" rx="1.5" /><path d="M10.5 5.5V3.5a1 1 0 00-1-1h-6a1 1 0 00-1 1v6a1 1 0 001 1h2" /></>,
  check: () => <path d="M3 8.5l3.2 3L13 4.5" />,
  sun: () => <><circle cx="8" cy="8" r="2.8" /><path d="M8 1.5v1.6M8 12.9v1.6M1.5 8h1.6M12.9 8h1.6M3.4 3.4l1.1 1.1M11.5 11.5l1.1 1.1M3.4 12.6l1.1-1.1M11.5 4.5l1.1-1.1" /></>,
  moon: () => <path d="M13 9.6A5.5 5.5 0 016.4 3a5.5 5.5 0 106.6 6.6z" />,
  chevron: () => <path d="M4 6l4 4 4-4" />,
  people: () => <><circle cx="6" cy="5.5" r="2.3" /><path d="M1.8 13.2c.5-2.3 2.2-3.6 4.2-3.6s3.7 1.3 4.2 3.6" /><path d="M10.6 3.4a2.2 2.2 0 010 4.3M12 9.8c1.3.4 2.1 1.6 2.3 3.4" /></>,
} as const;

export type IconName = keyof typeof PATHS;

export function Icon(props: { name: IconName; size?: number; class?: string }) {
  return (
    <svg
      class={`icon ${props.class ?? ''}`}
      viewBox="0 0 16 16"
      width={props.size ?? 16}
      height={props.size ?? 16}
      fill="none"
      stroke="currentColor"
      stroke-width="1.5"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      {PATHS[props.name]()}
    </svg>
  );
}

// ---- reel cover ---------------------------------------------------------------

/** 9:16 cover: the cached thumbnail, or the creator's initial on a quiet tile. */
export function Cover(props: { reel: Pick<LibraryReel, 'shortcode' | 'author_username' | 'has_thumb'>; class?: string; eager?: boolean }) {
  const [failed, setFailed] = createSignal(false);
  /** A long YouTube video's 16:9 thumbnail: shown whole, over a blurred copy of itself. */
  const [wide, setWide] = createSignal(false);
  return (
    <span class={`cover ${props.class ?? ''}`} data-wide={wide() ? '' : undefined}>
      <Show
        when={props.reel.has_thumb !== false && !failed()}
        fallback={<span class="cover-ph" aria-hidden="true">{props.reel.author_username.slice(0, 1)}</span>}
      >
        <Show when={wide()}>
          <img class="cover-blur" src={thumbUrl(props.reel.shortcode)} alt="" aria-hidden="true" />
        </Show>
        <img
          src={thumbUrl(props.reel.shortcode)}
          alt=""
          loading={props.eager ? 'eager' : 'lazy'}
          decoding="async"
          onLoad={(e) => setWide(e.currentTarget.naturalWidth > e.currentTarget.naturalHeight * 1.1)}
          onError={() => setFailed(true)}
        />
      </Show>
    </span>
  );
}

// ---- review status -------------------------------------------------------------

export const STATUS_LABEL: Record<ReelStatus, string> = {
  new: 'New',
  analyzed: 'Analyzed',
  in_report: 'In a report',
  rejected: 'Rejected',
};

/** How the status chip reads: still to do, done, or set aside. */
export const STATUS_TONE: Record<ReelStatus, 'wait' | 'done' | 'off'> = {
  new: 'wait',
  analyzed: 'done',
  in_report: 'done',
  rejected: 'off',
};

// ---- clipboard ---------------------------------------------------------------

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Older/locked-down contexts: fall back to a hidden textarea.
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.append(ta);
    ta.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    ta.remove();
    return ok;
  }
}

/** "Copied" for a moment after a successful copy. */
export function useCopied(ms = 1800) {
  const [state, setState] = createSignal<'idle' | 'copied' | 'failed'>('idle');
  let t: ReturnType<typeof setTimeout> | undefined;
  onCleanup(() => clearTimeout(t));
  async function copy(text: string) {
    const ok = await copyText(text);
    setState(ok ? 'copied' : 'failed');
    clearTimeout(t);
    t = setTimeout(() => setState('idle'), ms);
  }
  return [state, copy] as const;
}

/** A shell command with a copy button. */
export function Command(props: { cmd: string }) {
  const [state, copy] = useCopied();
  return (
    <span class="command">
      <code>{props.cmd}</code>
      <button type="button" class="command-copy" onClick={() => void copy(props.cmd)} aria-label={`Copy ${props.cmd}`}>
        <Icon name={state() === 'copied' ? 'check' : 'copy'} size={14} />
        <span aria-live="polite" class="sr-only">{state() === 'copied' ? 'Copied' : ''}</span>
      </button>
    </span>
  );
}

// ---- states ------------------------------------------------------------------

export function StateBlock(props: { title: string; children?: JSX.Element; tone?: 'quiet' | 'bad'; class?: string }) {
  return (
    <section class={`state ${props.tone === 'bad' ? 'state-bad' : ''} ${props.class ?? ''}`}>
      <h2>{props.title}</h2>
      {props.children}
    </section>
  );
}

export function isTyping(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  return el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName);
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;
}
