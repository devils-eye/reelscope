import { describe, expect, test } from 'bun:test';
import { railGeometry } from './railGeometry';

describe('railGeometry', () => {
  test('wide screen: column slides left, rail sits in the freed space, group centred', () => {
    // 2000px viewport, 72px nav, a 1415px reels grid centred at 250..1665.
    const g = railGeometry({ left: 250, right: 1665 }, 88, { width: 2000, height: 1100 })!;
    expect(g.shift).toBeGreaterThan(0);
    const colLeft = 250 - g.shift;
    const colRight = 1665 - g.shift;
    expect(colLeft).toBeGreaterThan(87);
    expect(g.rail.left).toBe(colRight + 24);
    expect(g.rail.left + g.rail.width).toBeLessThanOrEqual(2000 - 16);
    // Centred: equal margins either side of the column + rail group (±1px rounding).
    const leftGap = colLeft - 88;
    const rightGap = 2000 - 16 - (g.rail.left + g.rail.width);
    expect(Math.abs(leftGap - rightGap) <= 1).toBe(true);
    expect(g.rail.maxHeight).toBe(1100 - 16 - 96);
  });

  test('content already far left: no shift, rail just goes right of it', () => {
    const g = railGeometry({ left: 100, right: 1000 }, 88, { width: 1920, height: 1000 })!;
    expect(g.shift).toBe(0);
    expect(g.rail.left).toBe(1024);
    expect(g.rail.width).toBe(340);
  });

  test('narrow viewport: no room, null (dimming only)', () => {
    // 1360px with a 244px nav and a 935px column.
    expect(railGeometry({ left: 334, right: 1269 }, 260, { width: 1360, height: 900 })).toBeNull();
  });

  test('rail width shrinks to fit, never under 280', () => {
    const g = railGeometry({ left: 400, right: 1300 }, 88, { width: 1700, height: 900 })!;
    expect(g.rail.width).toBeGreaterThan(279);
    expect(g.rail.width).toBeLessThanOrEqual(340);
    expect(railGeometry({ left: 400, right: 1300 }, 88, { width: 1290, height: 900 })).toBeNull();
  });
});
