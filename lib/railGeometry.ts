// Where the outlier rail goes next to Instagram's profile column. Pure, unit
// tested in lib/railGeometry.test.ts; the DOM side is
// entrypoints/content/railLayout.ts.

export interface RailGeom {
  left: number;
  top: number;
  width: number;
  maxHeight: number;
}

const GAP = 24;
export const EDGE = 16;
const RAIL_MIN = 280;
const RAIL_MAX = 340;
const TOP = 16;
/** Instagram's Messages bar sits bottom-right. */
const BOTTOM_RESERVE = 96;

/**
 * Pure geometry: where the column and the rail go. `col` is the column's
 * untranslated rect, `leftLimit` the left edge content may move to (right of
 * Instagram's nav). The column + rail group is centred in the free width;
 * null when the rail can't get RAIL_MIN without overlapping the column.
 */
export function railGeometry(
  col: { left: number; right: number },
  leftLimit: number,
  viewport: { width: number; height: number },
): { shift: number; rail: RailGeom } | null {
  const avail = viewport.width - EDGE - leftLimit;
  const colW = col.right - col.left;
  const room = avail - colW - GAP;
  if (room < RAIL_MIN) return null;
  const width = Math.min(RAIL_MAX, room);
  const groupLeft = leftLimit + (avail - (colW + GAP + width)) / 2;
  // Only ever move content left; when it already sits further left, leave it.
  const shift = Math.max(0, Math.round(col.left - groupLeft));
  const left = col.right - shift + GAP;
  if (left + width > viewport.width - EDGE) return null;
  return { shift, rail: { left: Math.round(left), top: TOP, width: Math.round(width), maxHeight: viewport.height - TOP - BOTTOM_RESERVE } };
}

