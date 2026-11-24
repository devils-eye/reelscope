// The site's own theme (it can differ from the OS setting). Meta's web apps
// mark <html> with __fb-dark-mode / __fb-light-mode and YouTube sets a `dark`
// attribute; failing that, read the page background, and only then fall back
// to prefers-color-scheme.
import { createSignal, type Accessor } from 'solid-js';

export type Theme = 'dark' | 'light';

function luminance(css: string): number | null {
  const m = css.match(/rgba?\(([^)]+)\)/);
  if (!m) return null;
  const [r, g, b, a = 1] = m[1]!.split(/[\s,/]+/).filter(Boolean).map(Number);
  if (a !== undefined && a < 0.5) return null;
  if (![r, g, b].every((v) => Number.isFinite(v))) return null;
  return (0.2126 * r! + 0.7152 * g! + 0.0722 * b!) / 255;
}

export function detectTheme(): Theme {
  const html = document.documentElement;
  if (html.classList.contains('__fb-dark-mode')) return 'dark';
  if (html.classList.contains('__fb-light-mode')) return 'light';
  if (html.hasAttribute('dark')) return 'dark';
  // YouTube's light theme: no `dark`, and <ytd-app> paints the background, not <body>.
  if (document.querySelector('ytd-app')) return 'light';
  for (const el of [document.body, html]) {
    if (!el) continue;
    const l = luminance(getComputedStyle(el).backgroundColor);
    if (l != null) return l < 0.5 ? 'dark' : 'light';
  }
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/** Theme signal, re-read when <html>/<body> attributes or the OS scheme change. */
export function createThemeWatcher(): { theme: Accessor<Theme>; refresh(): void; stop(): void } {
  const [theme, setTheme] = createSignal<Theme>(detectTheme());
  const refresh = () => setTheme(detectTheme());
  const mo = new MutationObserver(refresh);
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'style', 'data-theme', 'dark'] });
  if (document.body) mo.observe(document.body, { attributes: true, attributeFilter: ['class', 'style'] });
  const mq = matchMedia('(prefers-color-scheme: dark)');
  mq.addEventListener('change', refresh);
  return {
    theme,
    refresh,
    stop() {
      mo.disconnect();
      mq.removeEventListener('change', refresh);
    },
  };
}
