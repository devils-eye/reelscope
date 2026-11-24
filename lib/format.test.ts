import { describe, expect, test } from 'bun:test';
import { age, ago, compact, duration, full, interval, multiple, outlierTier, pct, ratio, tierVars, windowText } from './format';

describe('numbers', () => {
  test('compact', () => {
    expect(compact(999)).toBe('999');
    expect(compact(1234)).toBe('1.2K');
    expect(compact(34_000)).toBe('34K');
    expect(compact(612_000)).toBe('612K');
    expect(compact(1_200_000)).toBe('1.2M');
    expect(compact(2_000_000_000)).toBe('2B');
    expect(compact(null)).toBe('–');
    expect(compact(NaN)).toBe('–');
  });

  test('ratio, multiple, pct, full', () => {
    expect(ratio(3.42)).toBe('3.4x');
    expect(ratio(12.6)).toBe('13x');
    expect(multiple(5)).toBe('5x');
    expect(multiple(5.24)).toBe('5.2x');
    expect(multiple(0.05)).toBe('<0.1x');
    expect(multiple(0)).toBe('–');
    expect(pct(0.123)).toBe('12%');
    expect(pct(0.0456)).toBe('4.6%');
    expect(pct(0)).toBe('0%');
    expect(full(1234567)).toBe('1,234,567');
  });

  test('outlierTier buckets views per follower', () => {
    expect(outlierTier(null)).toBe('none');
    expect(outlierTier(0.4)).toBe('low');
    expect(outlierTier(1)).toBe('mid');
    expect(outlierTier(3)).toBe('hot');
    expect(outlierTier(10)).toBe('blaze');
  });
});

describe('time', () => {
  test('age and interval', () => {
    expect(age(0.5)).toBe('30m');
    expect(age(5)).toBe('5h');
    expect(age(72)).toBe('3d');
    expect(age(24 * 49)).toBe('7w');
    expect(age(-1)).toBe('–');
    expect(interval(0.25)).toBe('6h');
    expect(interval(2.4)).toBe('2.4d');
    expect(interval(12)).toBe('12d');
    expect(interval(70)).toBe('10w');
  });

  test('duration', () => {
    expect(duration(34)).toBe('0:34');
    expect(duration(725)).toBe('12:05');
    expect(duration(3723)).toBe('1:02:03');
    expect(duration(undefined)).toBe('–');
  });

  test('windowText', () => {
    expect(windowText(7)).toBe('the last 7 days');
    expect(windowText(30)).toBe('the last 30 days');
    expect(windowText(180)).toBe('the last 6 months');
    expect(windowText(365)).toBe('the last year');
    expect(windowText(730)).toBe('the last 2 years');
  });

  test('ago', () => {
    const now = Date.parse('2026-11-24T12:00:00Z');
    expect(ago('2026-11-24T11:59:59Z', now)).toBe('just now');
    expect(ago('2026-11-24T07:00:00Z', now)).toBe('5h ago');
    expect(ago('2026-11-21T12:00:00Z', now)).toBe('3d ago');
    expect(ago('not a date', now)).toBe('–');
  });
});

test('tierVars gives every tier a colour set per theme', () => {
  for (const theme of ['dark', 'light'] as const) {
    const v = tierVars(theme);
    expect(Object.keys(v)).toHaveLength(15);
    expect(v['--ct-breakout-bg']).toBe('#f4b740');
  }
});
