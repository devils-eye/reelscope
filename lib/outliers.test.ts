import { describe, expect, test } from 'bun:test';
import { COMMENT_BAIT_RE, analyzeProfile, cadence, channelBaseline } from './outliers';
import type { ProfileReel } from './types';

const NOW = new Date('2026-10-01T12:00:00.000Z');

function mkReel(shortcode: string, views: number, ageDays: number, extra: Partial<ProfileReel> = {}): ProfileReel {
  return {
    shortcode,
    url: `https://www.instagram.com/reel/${shortcode}/`,
    takenAt: new Date(NOW.getTime() - ageDays * 86400000).toISOString(),
    views,
    likes: Math.round(views * 0.05),
    comments: Math.round(views * 0.005),
    pinned: false,
    ...extra,
  };
}

describe('analyzeProfile', () => {
  test('an obvious outlier is found', () => {
    const reels = [
      ...[1000, 1100, 900, 1050, 950, 1020, 980, 1010].map((v, i) => mkReel(`m${i}`, v, 10 + i)),
      mkReel('viral', 50000, 10),
    ];
    const { stats, reels: scored } = analyzeProfile(reels, { followers: 10_000 }, { now: NOW });
    expect(stats.baselineViews > 900 && stats.baselineViews < 1100).toBe(true);
    const viral = scored.find((s) => s.shortcode === 'viral');
    expect(viral !== undefined).toBe(true);
    expect(viral!.isOutlier).toBe(true);
    expect(viral!.tier).toBe('breakout');
    expect(viral!.multiple > 10).toBe(true);
    expect(stats.best?.shortcode).toBe('viral');
    expect(stats.outlierCount >= 1).toBe(true);
    expect(stats.breakoutCount).toBe(1);
    // Newest first.
    for (let i = 1; i < scored.length; i++) {
      expect(Date.parse(scored[i - 1]!.takenAt) >= Date.parse(scored[i]!.takenAt)).toBe(true);
    }
  });

  test('the baseline ignores fresh reels', () => {
    const mature = [1000, 1100, 900, 1050, 950, 1020, 980, 1010].map((v, i) =>
      mkReel(`m${i}`, v, 10 + i),
    );
    // Fresh = 10 hours old, with a huge view count.
    const fresh: ProfileReel = {
      ...mkReel('fresh', 1_000_000, 0),
      takenAt: new Date(NOW.getTime() - 10 * 3600 * 1000).toISOString(),
    };
    const { stats, reels: scored } = analyzeProfile([...mature, fresh], {}, { now: NOW });
    expect(stats.baselineViews > 900 && stats.baselineViews < 1100).toBe(true);
    expect(stats.matureCount).toBe(8);
    expect(scored.find((s) => s.shortcode === 'fresh')?.early).toBe(true);
    expect(
      mature.every((m) => scored.find((s) => s.shortcode === m.shortcode)?.early === false),
    ).toBe(true);
  });

  test('the threshold option works', () => {
    const reels = [
      ...[900, 950, 1000, 1000, 1050, 1100, 980, 1020].map((v, i) => mkReel(`m${i}`, v, 10 + i)),
      mkReel('mid', 3000, 10),
    ];
    const def = analyzeProfile(reels, {}, { now: NOW });
    expect(def.reels.find((s) => s.shortcode === 'mid')?.tier).toBe('outlier');
    const strict = analyzeProfile(reels, {}, { now: NOW, threshold: 5 });
    expect(strict.reels.find((s) => s.shortcode === 'mid')?.tier).toBe('normal');
    expect(strict.stats.threshold).toBe(5);
  });

  test("MAD=0 doesn't divide by zero", () => {
    const reels = [
      ...Array.from({ length: 8 }, (_, i) => mkReel(`m${i}`, 1000, 10 + i)),
      mkReel('big', 5000, 10),
    ];
    const { reels: scored } = analyzeProfile(reels, {}, { now: NOW });
    for (const s of scored) {
      expect(Number.isFinite(s.logZ)).toBe(true);
      expect(Number.isFinite(s.multiple)).toBe(true);
    }
    expect(scored.every((s) => s.logZ === 0)).toBe(true);
    // 5x with no spread is still strong.
    expect(scored.find((s) => s.shortcode === 'big')?.isOutlier).toBe(true);
  });

  test('lowConfidence triggers with few mature reels', () => {
    const few = [1000, 1100, 900].map((v, i) => mkReel(`m${i}`, v, 10 + i));
    expect(analyzeProfile(few, {}, { now: NOW }).stats.lowConfidence).toBe(true);
    const many = [1000, 1100, 900, 1050, 950, 1020].map((v, i) => mkReel(`m${i}`, v, 10 + i));
    expect(analyzeProfile(many, {}, { now: NOW }).stats.lowConfidence).toBe(false);
  });

  test('under-performers get the under tier', () => {
    const reels = [
      ...[1000, 1100, 900, 1050, 950, 1020, 980, 1010].map((v, i) => mkReel(`m${i}`, v, 10 + i)),
      mkReel('flop', 100, 10),
    ];
    const { reels: scored } = analyzeProfile(reels, {}, { now: NOW });
    const flop = scored.find((s) => s.shortcode === 'flop');
    expect(flop?.tier).toBe('under');
    expect(flop?.isOutlier).toBe(false);
  });
});

describe('COMMENT_BAIT_RE', () => {
  const cases: Array<[string, boolean]> = [
    [`Comment "viral" and I'll send it to you`, true],
    ['comment GUIDE below', true],
    ['DM me for the link', true],
    ['link in bio to apply', true],
    ['link in my bio', true],
    ['no comments please', false],
    ['great video, loved the comments', false],
    ['commentary on the game', false],
  ];
  for (const [caption, expected] of cases) {
    test(JSON.stringify(caption), () => {
      expect(COMMENT_BAIT_RE.test(caption)).toBe(expected);
    });
  }
});

describe('cadence', () => {
  const daily = (n: number, extra: (i: number) => Partial<ProfileReel> = () => ({})) =>
    Array.from({ length: n }, (_, i) => mkReel(`r${i}`, 1000, 0.5 + i, extra(i)));

  test('average, median and longest gap, and the last upload', () => {
    // Daily for 10 days, then a 5-day break before the oldest.
    const reels = [...daily(10), mkReel('old', 1000, 0.5 + 9 + 5)];
    const c = cadence(reels, NOW.getTime());
    expect(c.avgIntervalDays).toBeCloseTo(14 / 10, 6);
    expect(c.medianIntervalDays).toBeCloseTo(1, 6);
    expect(c.longestGapDays).toBeCloseTo(5, 6);
    expect(c.lastUploadDays).toBeCloseTo(0.5, 6);
  });

  test('pinned reels are left out', () => {
    const reels = [...daily(5), mkReel('pin', 1000, 300, { pinned: true })];
    const c = cadence(reels, NOW.getTime());
    expect(c.count).toBe(5);
    expect(c.longestGapDays).toBeCloseTo(1, 6);
    expect(analyzeProfile(reels, {}, { now: NOW }).stats.postsPerWeek).toBeCloseTo(5 / (4 / 7), 6);
  });

  test('estimated dates give an average but no gap sizes or rhythm', () => {
    const c = cadence(daily(20, (i) => ({ dateEstimated: i % 3 !== 0 })), NOW.getTime());
    expect(c.avgIntervalDays).toBeCloseTo(1, 6);
    expect(c.medianIntervalDays).toBeNull();
    expect(c.longestGapDays).toBeNull();
    expect(c.uploadsByWeekday).toBeNull();
    expect(c.uploadsByHour).toBeNull();
  });

  test('weekday and hour counts need enough exact times', () => {
    expect(cadence(daily(9), NOW.getTime()).uploadsByWeekday).toBeNull();
    // Weekly at the same time of day: one weekday, one hour.
    const weekly = Array.from({ length: 12 }, (_, i) => mkReel(`w${i}`, 1000, 1 + i * 7));
    const c = cadence(weekly, NOW.getTime());
    expect(c.uploadsByWeekday?.reduce((a, b) => a + b, 0)).toBe(12);
    expect(Math.max(...c.uploadsByWeekday!)).toBe(12);
    expect(Math.max(...c.uploadsByHour!)).toBe(12);
    expect(c.avgIntervalDays).toBeCloseTo(7, 6);
  });

  test('one reel or none', () => {
    expect(cadence([], NOW.getTime())).toMatchObject({ avgIntervalDays: null, lastUploadDays: null, medianIntervalDays: null });
    expect(cadence(daily(1), NOW.getTime()).avgIntervalDays).toBeNull();
  });

  test('windowDays is echoed into the stats', () => {
    expect(analyzeProfile(daily(3), {}, { now: NOW, windowDays: 30 }).stats.windowDays).toBe(30);
    expect(analyzeProfile(daily(3), {}, { now: NOW }).stats.windowDays).toBeUndefined();
  });
});

describe('time windows against the whole channel', () => {
  // A year of 100K reels, then a hot last month at 300K.
  const year = Array.from({ length: 60 }, (_, i) => mkReel(`y${i}`, 100_000 + (i % 7) * 5_000, 40 + i * 5));
  const month = Array.from({ length: 10 }, (_, i) => mkReel(`m${i}`, 300_000 + i * 1_000, 4 + i * 3));
  const all = [...month, ...year];

  test('the window is scored against the channel, not itself', () => {
    const base = channelBaseline(all, NOW.getTime());
    const own = analyzeProfile(month, {}, { now: NOW });
    const vsChannel = analyzeProfile(month, {}, { now: NOW, baseline: base, windowDays: 30 });
    // Against itself the hot month looks ordinary; against the channel every reel is ~3x.
    expect(own.stats.outlierCount).toBe(0);
    expect(vsChannel.stats.outlierCount).toBe(10);
    expect(vsChannel.stats.baselineViews).toBe(base.views);
    expect(vsChannel.stats.matureCount).toBe(base.matureCount);
    expect(vsChannel.stats.sampleSize).toBe(10);
    expect(vsChannel.stats.hitRate).toBe(1);
    expect(vsChannel.stats.channel).toEqual(base);
  });

  test('without a baseline the sample is its own yardstick, as before', () => {
    const a = analyzeProfile(all, {}, { now: NOW });
    const base = channelBaseline(all, NOW.getTime());
    expect(a.stats.baselineViews).toBe(base.views);
    expect(a.stats.trend).toBe(base.trend);
    expect(a.stats.channel).toBeUndefined();
  });

  test('the baseline leaves fresh reels out and keeps the trend', () => {
    const base = channelBaseline([mkReel('fresh', 9_000_000, 1), ...all], NOW.getTime());
    expect(base.sampleSize).toBe(71);
    expect(base.matureCount).toBe(70);
    expect(base.trend).toBeGreaterThan(2);
  });
});
