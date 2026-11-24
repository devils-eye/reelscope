// A small shadow-root host for UI we put inside the site's own DOM (Save
// buttons, grid badges, the profile strip): the site's CSS can't reach in,
// and clicks on our UI never reach the site's handlers. Shared by the
// Instagram and YouTube runtimes.
import type { JSX } from 'solid-js';
import { render } from 'solid-js/web';
import { HOST_ATTR } from './dom';
import inlineCss from './inline.css?inline';

export interface Mounted {
  host: HTMLElement;
  dispose: () => void;
}

const STOP_EVENTS = ['click', 'dblclick', 'pointerdown', 'pointerup', 'mousedown', 'mouseup', 'touchstart', 'touchend'];
const stop = (e: Event) => e.stopPropagation();

export function mountHost(kind: string, hostStyle: string, view: () => JSX.Element): Mounted {
  const host = document.createElement('span');
  host.setAttribute(HOST_ATTR, kind);
  host.style.cssText = hostStyle;
  const root = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = inlineCss;
  const mount = document.createElement('span');
  mount.className = 'rs-mount';
  root.append(style, mount);
  const dispose = render(view, mount);
  // Keep the site from treating clicks on our UI as clicks on the post.
  for (const t of STOP_EVENTS) host.addEventListener(t, stop);
  return { host, dispose };
}

export function unmount(m: Mounted) {
  m.dispose();
  m.host.remove();
}

/**
 * Mirror pointer hover and keyboard focus on `target` (a grid tile) as
 * `data-hover` on our host, so the host's sheet can style
 * `:host([data-hover])` while the host itself takes no pointer events and
 * never gets in the way of the tile's click. Returns the cleanup.
 */
export function hoverTarget(target: HTMLElement, host: HTMLElement): () => void {
  const on = () => host.setAttribute('data-hover', '');
  // Keyboard focus only: a mouse click focuses the tile too, and must not leave it open.
  const keyFocus = () => target.matches(':focus-visible') || !!target.querySelector(':focus-visible');
  const onFocus = () => keyFocus() && on();
  const off = (e: Event) => {
    if (e.type === 'focusout' && target.contains((e as FocusEvent).relatedTarget as Node | null)) return;
    if (e.type === 'pointerleave' && keyFocus()) return;
    host.removeAttribute('data-hover');
  };
  target.addEventListener('pointerenter', on);
  target.addEventListener('pointerleave', off);
  target.addEventListener('focusin', onFocus);
  target.addEventListener('focusout', off);
  return () => {
    target.removeEventListener('pointerenter', on);
    target.removeEventListener('pointerleave', off);
    target.removeEventListener('focusin', onFocus);
    target.removeEventListener('focusout', off);
    host.removeAttribute('data-hover');
  };
}
