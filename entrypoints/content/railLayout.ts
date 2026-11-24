// Room for the outlier rail: slide Instagram's profile column left (CSS
// `translate`, so Instagram's own layout, transforms and React state are
// untouched) and place the rail in the space it frees on the right. The
// column is found, not assumed: the lowest element holding both the profile
// header and the grid. Restored exactly (the inline `translate` and
// `transition` it had before) when the rail goes away.
import { EDGE, railGeometry, type RailGeom } from '@/lib/railGeometry';
import { gridTiles, HOST_ATTR, profileHeader } from './dom';

export type { RailGeom };

const EASE = 'translate 0.34s cubic-bezier(0.2, 0.7, 0.2, 1)';

/** Profile column: lowest ancestor of the profile header that also holds the grid. */
export function profileColumn(): HTMLElement | null {
  const header = profileHeader();
  const tile = gridTiles()[0]?.a;
  if (!header || !tile) return null;
  const main = header.closest('main');
  let el = header.parentElement;
  while (el && el !== main && !el.contains(tile)) el = el.parentElement;
  return el && el !== main ? el : null;
}

export interface ContentShift {
  /** Shift the column (if it fits) and return where the rail goes; null = no room. */
  apply(): RailGeom | null;
  /** True when the shifted column is gone (Instagram re-rendered it). */
  stale(): boolean;
  restore(): void;
}

export function createContentShift(): ContentShift {
  let el: HTMLElement | null = null;
  let saved = { translate: '', transition: '' };
  let shift = 0;
  let restoreTimer: ReturnType<typeof setTimeout> | undefined;

  /**
   * Where the visible content sits with our shift undone: the union of the
   * profile header, the grid tiles and the strip. Not the column's own box,
   * which may be a full-width wrapper that centres narrower children.
   */
  function untranslatedContent(target: HTMLElement): { left: number; right: number } {
    const cur = target.style.translate;
    const tr = target.style.transition;
    target.style.transition = 'none';
    target.style.translate = saved.translate;
    let left = Infinity;
    let right = -Infinity;
    const parts: Element[] = [profileHeader(), target.querySelector(`[${HOST_ATTR}="strip"]`), ...gridTiles().slice(0, 36).map((t) => t.a)].filter(
      (e): e is Element => !!e && target.contains(e),
    );
    for (const e of parts) {
      const r = e.getBoundingClientRect();
      if (r.width === 0) continue;
      left = Math.min(left, r.left);
      right = Math.max(right, r.right);
    }
    if (!Number.isFinite(left)) ({ left, right } = target.getBoundingClientRect());
    target.style.translate = cur;
    void target.offsetWidth; // commit without animating
    target.style.transition = tr;
    return { left, right };
  }

  function release(animate: boolean) {
    const target = el;
    el = null;
    shift = 0;
    if (!target) return;
    const s = saved;
    if (animate && target.isConnected) {
      target.style.transition = EASE;
      target.style.translate = s.translate;
      clearTimeout(restoreTimer);
      restoreTimer = setTimeout(() => {
        if (el !== target) target.style.transition = s.transition;
      }, 400);
    } else {
      target.style.translate = s.translate;
      target.style.transition = s.transition;
    }
  }

  return {
    apply() {
      const col = profileColumn();
      if (!col) {
        release(true);
        return null;
      }
      if (col !== el) {
        release(false);
        clearTimeout(restoreTimer);
        el = col;
        saved = { translate: col.style.translate, transition: col.style.transition };
      }
      const nat = untranslatedContent(col);
      const mainLeft = col.closest('main')?.getBoundingClientRect().left ?? 0;
      const g = railGeometry(nat, Math.max(0, mainLeft) + EDGE, { width: window.innerWidth, height: window.innerHeight });
      if (!g) {
        release(true);
        return null;
      }
      if (g.shift !== shift) {
        col.style.transition = EASE;
        col.style.translate = g.shift ? `${-g.shift}px 0` : saved.translate;
        shift = g.shift;
      }
      return g.rail;
    },
    stale: () => el !== null && !el.isConnected,
    restore: () => release(true),
  };
}
