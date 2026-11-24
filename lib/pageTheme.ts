// Light/dark for the extension pages (library + popup). Both pages share the
// extension origin, so one stored choice covers both; without one they follow
// the system.
import { tierVars } from './format';

export type Theme = 'light' | 'dark';
const KEY = 'library.theme';

export function storedTheme(): Theme | null {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : null;
  } catch {
    return null;
  }
}

export function systemTheme(): Theme {
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function currentTheme(): Theme {
  return storedTheme() ?? systemTheme();
}

export function storeTheme(t: Theme): void {
  try {
    localStorage.setItem(KEY, t);
  } catch {
    // storage unavailable: the choice lasts for this page only
  }
}

/** Set data-theme plus the channel-tier colours shared with the in-page UI. */
export function applyTheme(t: Theme, root: HTMLElement = document.documentElement): void {
  root.dataset.theme = t;
  for (const [k, v] of Object.entries(tierVars(t))) root.style.setProperty(k, v);
}
