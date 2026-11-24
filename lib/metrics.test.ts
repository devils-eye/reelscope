import { describe, expect, test } from 'bun:test';
import { longAge, oneIn, perK } from './format';
import {
  captionStats,
  compareToScan,
  computeMetrics,
  detailsFromIgItem,
  detailsFromRow,
  detailsFromYtInfo,
  postFromScanned,
  resolutionLabel,
  snapshotGrowth,
  type ScanRef,
} from './metrics';
import { analyzeProfile } from './outliers';
import type { ProfileReel, ReelLatestRow, SnapshotRow } from './types';
import { infoSummary, trimInfo } from './youtube';

const NOW = Date.parse('2026-10-10T12:00:00.000Z');
const hoursAgo = (h: number) => new Date(NOW - h * 3600_000).toISOString();

describe('computeMetrics', () => {
  test('derives every rate from the raw counts', () => {
    const m = computeMetrics(
      { views: 100_000, likes: 4_000, comments: 200, shares: 800, followers: 50_000, takenAt: hoursAgo(48), caption: 'Cold brew #coffee #diy with @latte.lab' },
      NOW,
    );
    expect(m.engagementRate).toBeCloseTo(0.05, 10);
    expect(m.engagementHasShares).toBe(true);
    expect(m.likeRate).toBeCloseTo(0.04, 10);
    expect(m.commentsPer1k).toBeCloseTo(2, 10);
    expect(m.sharesPer1k).toBeCloseTo(8, 10);
    expect(m.commentLikeRatio).toBeCloseTo(0.05, 10);
    expect(m.viewsPerFollower).toBeCloseTo(2, 10);
    expect(m.ageHours).toBeCloseTo(48, 10);
    expect(m.viewsPerHour).toBeCloseTo(100_000 / 48, 6);
    expect(m.viewsPerDay).toBeCloseTo(50_000, 6);
    expect(m.caption).toEqual({ length: 38, hashtags: 2, mentions: 1 });
  });

  test('engagement leaves out shares when they are unknown, and says so', () => {
    const m = computeMetrics({ views: 1000, likes: 30, comments: 20 }, NOW);
    expect(m.engagementRate).toBeCloseTo(0.05, 10);
    expect(m.engagementHasShares).toBe(false);
    expect(m.sharesPer1k).toBeNull();
  });

  test('every derived value is null when its inputs are missing', () => {
    const m = computeMetrics({}, NOW);
    for (const k of ['views', 'likes', 'comments', 'shares', 'followers', 'engagementRate', 'likeRate', 'commentsPer1k', 'sharesPer1k', 'commentLikeRatio', 'viewsPerFollower', 'ageHours', 'viewsPerHour', 'viewsPerDay', 'caption'] as const) {
      expect(m[k]).toBeNull();
    }
  });

  test('no division by zero, no negative or broken counts', () => {
    const m = computeMetrics({ views: 0, likes: 0, comments: 5, followers: 0, takenAt: hoursAgo(0) }, NOW);
    expect(m.engagementRate).toBeNull();
    expect(m.likeRate).toBeNull();
    expect(m.commentLikeRatio).toBeNull();
    expect(m.viewsPerFollower).toBeNull();
    expect(m.viewsPerHour).toBeNull();
    const bad = computeMetrics({ views: Number.NaN, likes: -3, takenAt: 'not a date' }, NOW);
    expect(bad.views).toBeNull();
    expect(bad.likes).toBeNull();
    expect(bad.ageHours).toBeNull();
  });

  test('a post dated in the future (clock skew) is zero hours old', () => {
    expect(computeMetrics({ views: 10, takenAt: hoursAgo(-1) }, NOW).ageHours).toBe(0);
  });
});

describe('captionStats', () => {
  test('counts code points, hashtags and mentions; emails and entities are not mentions or tags', () => {
    expect(captionStats('Hi 👋🏽 mail me@site.com &#38; #one#two @a.b @c_d')).toEqual({
      length: [...'Hi 👋🏽 mail me@site.com &#38; #one#two @a.b @c_d'].length,
      hashtags: 1,
      mentions: 2,
    });
    expect(captionStats('#über #日本 (#x)')?.hashtags).toBe(3);
    expect(captionStats('   ')).toBeNull();
    expect(captionStats(null)).toBeNull();
  });
});

describe('format helpers', () => {
  test('perK and oneIn', () => {
    expect(perK(0.4231)).toBe('0.42');
    expect(perK(3.14)).toBe('3.1');
    expect(perK(27.4)).toBe('27');
    expect(perK(0)).toBe('0');
    expect(perK(null)).toBe('–');
    expect(oneIn(1 / 36)).toBe('1:36');
    expect(oneIn(1.42)).toBe('1.4:1');
    expect(oneIn(12)).toBe('12:1');
    expect(oneIn(0)).toBe('–');
    expect(longAge(30)).toBe('30h');
    expect(longAge(24 * 50)).toBe('7w');
    expect(longAge(24 * 200)).toBe('7mo');
    expect(longAge(24 * 365.25 * 2.4)).toBe('2.4y');
    expect(longAge(24 * 365.25 * 21.6)).toBe('22y');
    expect(longAge(null)).toBe('–');
  });
});

function mkReel(code: string, views: number, ageDays: number, extra: Partial<ProfileReel> = {}): ProfileReel {
  return {
    shortcode: code,
    url: `https://www.instagram.com/reel/${code}/`,
    takenAt: new Date(NOW - ageDays * 86400_000).toISOString(),
    views,
    likes: Math.round(views * 0.04),
    comments: Math.round(views * 0.001),
    pinned: false,
    ...extra,
  };
}

function scanOf(reels: ProfileReel[], opts: { windowDays?: number } = {}): ScanRef {
  const a = analyzeProfile(reels, { followers: 10_000 }, { now: new Date(NOW), ...opts });
  return { stats: a.stats, reels: a.reels, scannedAt: new Date(NOW).toISOString(), threshold: 2 };
}

describe('compareToScan', () => {
  const base = [1000, 1100, 900, 1050, 950, 1020, 980, 1010, 1040, 960].map((v, i) => mkReel(`m${i}`, v, 5 + i));

  test('a post in the scan: rank, multiple and tier at its current views, same tier rules as the scan', () => {
    const scan = scanOf([...base, mkReel('hit', 6000, 4)]);
    const m = computeMetrics({ views: 12_000, likes: 960, comments: 24, takenAt: hoursAgo(4 * 24) }, NOW);
    const c = compareToScan('hit', m, scan)!;
    expect(c.inScan).toBe(true);
    expect(c.rank).toBe(1);
    expect(c.of).toBe(11);
    expect(c.topShare).toBeCloseTo(1 / 11, 10);
    expect(c.baselineViews).toBe(scan.stats.baselineViews);
    expect(c.multiple).toBeCloseTo(12_000 / scan.stats.baselineViews, 10);
    expect(c.tier).toBe('breakout');
    expect(c.early).toBe(false);
    // likes + comments per view, against the scan's median of the same thing.
    expect(c.engagement).toBeCloseTo(0.082, 10);
    expect(c.engagementVsMedian).toBeCloseTo(0.082 / scan.stats.medianEngagementRate!, 10);
  });

  test('a post outside the scan is ranked among them, and a young one is flagged early', () => {
    const scan = scanOf(base);
    const m = computeMetrics({ views: 1005, likes: 10, comments: 1, takenAt: hoursAgo(20) }, NOW);
    const c = compareToScan('new1', m, scan)!;
    expect(c.inScan).toBe(false);
    expect(c.of).toBe(11);
    expect(c.rank).toBe(6);
    expect(c.tier).toBe('normal');
    expect(c.early).toBe(true);
  });

  test('a 2x multiple inside the creator\'s usual spread stays normal (the logZ rule)', () => {
    // Wide spread: a 2.1x post is not unusual for this creator.
    const wide = [200, 5000, 400, 3000, 1000, 800, 2500, 600, 1500, 350].map((v, i) => mkReel(`w${i}`, v, 5 + i));
    const scan = scanOf(wide);
    const m = computeMetrics({ views: scan.stats.baselineViews * 2.1 }, NOW);
    expect(compareToScan('x', m, scan)!.tier).toBe('normal');
  });

  test('null without views or without a baseline', () => {
    const scan = scanOf(base);
    expect(compareToScan('x', computeMetrics({}, NOW), scan)).toBeNull();
    const empty = scanOf([]);
    expect(compareToScan('x', computeMetrics({ views: 10 }, NOW), empty)).toBeNull();
  });

  test('no engagement comparison without likes, or when the scan has no median', () => {
    const scan = scanOf(base.map((r) => ({ ...r, fromGrid: true })));
    expect(scan.stats.medianEngagementRate).toBeNull();
    const c = compareToScan('x', computeMetrics({ views: 3000, likes: 100, comments: 2 }, NOW), scan)!;
    expect(c.engagement).not.toBeNull();
    expect(c.engagementVsMedian).toBeNull();
  });
});

describe('snapshotGrowth', () => {
  const snap = (id: number, at: string, views: number | null, likes: number | null): SnapshotRow => ({
    id, shortcode: 's', captured_at: at, play_count: views, view_count: null, like_count: likes, comment_count: 10, share_count: null, author_followers: null,
  });

  test('first to latest, per day', () => {
    const g = snapshotGrowth([
      snap(2, '2026-10-03T00:00:00Z', 30_000, 1200),
      snap(1, '2026-10-01T00:00:00Z', 10_000, 400),
      snap(3, '2026-10-05T00:00:00Z', 50_000, 2000),
    ])!;
    expect(g.days).toBe(4);
    expect(g.views).toEqual({ delta: 40_000, perDay: 10_000 });
    expect(g.likes).toEqual({ delta: 1600, perDay: 400 });
    expect(g.comments).toEqual({ delta: 0, perDay: 0 });
  });

  test('needs two snapshots; no per-day rate for saves minutes apart; unknown counts stay unknown', () => {
    expect(snapshotGrowth([snap(1, '2026-10-01T00:00:00Z', 1, 1)])).toBeNull();
    const g = snapshotGrowth([snap(1, '2026-10-01T00:00:00Z', 100, null), snap(2, '2026-10-01T00:10:00Z', 160, 5)])!;
    expect(g.views).toEqual({ delta: 60, perDay: null });
    expect(g.likes).toBeNull();
  });
});

describe('sources', () => {
  // Field names as Instagram's web app receives them (dev/panel-harness/fixture/api.js mirrors these).
  const igItem = {
    code: 'C9fRmXa1bQz',
    pk: '3400000000000000001',
    taken_at: Math.floor(NOW / 1000) - 7200,
    media_type: 2,
    product_type: 'clips',
    play_count: 612_000,
    ig_play_count: 612_000,
    like_count: 24_500,
    comment_count: 673,
    reshare_count: 1_840,
    video_duration: 31.2,
    caption: { text: 'The 3 mistakes #coldbrew' },
    user: { pk: '456', username: 'coffeelab.daily', full_name: 'Coffee Lab Daily', follower_count: 52_300 },
    coauthor_producers: [{ username: 'coffeelab.daily' }, { username: 'latte.lab' }],
    is_paid_partnership: true,
    sponsor_tags: [{ sponsor: { username: 'beanco' } }],
    like_and_view_counts_disabled: true,
    clips_metadata: { audio_type: 'original_sounds', original_sound_info: { original_audio_title: 'Original audio', ig_artist: { username: 'coffeelab.daily' } } },
  };

  test('an Instagram media item', () => {
    const d = detailsFromIgItem(igItem);
    expect(d.post).toMatchObject({
      platform: 'instagram',
      shortcode: 'C9fRmXa1bQz',
      username: 'coffeelab.daily',
      views: 612_000,
      likes: 24_500,
      comments: 673,
      shares: 1_840,
      followers: 52_300,
      durationSec: 31.2,
      takenAt: new Date(NOW - 7200_000).toISOString(),
    });
    expect(d.extras).toEqual({
      audio: { original: true, title: 'Original audio', artist: 'coffeelab.daily' },
      collaborators: ['latte.lab'],
      paidPartnership: true,
      sponsors: ['beanco'],
      likesHidden: true,
    });
    // A follower count from elsewhere wins over the item's.
    expect(detailsFromIgItem(igItem, { followers: 53_000 }).post.followers).toBe(53_000);
  });

  test('Instagram: a licensed track, and a bare item', () => {
    const track = detailsFromIgItem({ code: 'X', clips_metadata: { music_info: { music_asset_info: { title: 'Espresso', display_artist: 'Sabrina Carpenter' } } } });
    expect(track.extras.audio).toEqual({ original: false, title: 'Espresso', artist: 'Sabrina Carpenter' });
    const bare = detailsFromIgItem({ code: 'Y' });
    expect(bare.extras).toEqual({});
    expect(bare.post.views).toBeNull();
    // No taken_at: the upload time is still in the shortcode's media id.
    expect(detailsFromIgItem({ code: 'C9fRmXa1bQz' }).post.takenAt).not.toBeNull();
  });

  const ytInfo = {
    id: 'jNQXAC9IVRw',
    title: 'Me at the zoo',
    description: 'The first video on YouTube. #history',
    channel: 'jawed',
    channel_id: 'UC4QobU6STFB0P71PMvOGN5A',
    uploader_id: '@jawed',
    channel_follower_count: 4_600_000,
    view_count: 380_000_000,
    like_count: 19_000_000,
    comment_count: 12_000_000,
    upload_date: '20050424',
    duration: 19,
    categories: ['Film & Animation'],
    tags: ['me at the zoo', 'jawed karim'],
    chapters: null,
    width: 320,
    height: 240,
    fps: 15,
    live_status: 'not_live',
    formats: [{ huge: true }],
  };

  test('a YouTube summary and its details', () => {
    const s = infoSummary(ytInfo)!;
    expect(s).toMatchObject({
      id: 'jNQXAC9IVRw',
      handle: 'jawed',
      followers: 4_600_000,
      views: 380_000_000,
      takenAt: '2005-04-24T00:00:00.000Z',
      dateOnly: true,
      chapters: 0,
      short: false,
      liveStatus: 'not_live',
    });
    expect('formats' in s).toBe(false);
    const d = detailsFromYtInfo(s);
    expect(d.post).toMatchObject({ platform: 'youtube', username: 'jawed', title: 'Me at the zoo', caption: 'Me at the zoo\n\nThe first video on YouTube. #history', dateOnly: true });
    // Shorts keep their hashtags and mentions in the title: the text stats count it.
    expect(computeMetrics(detailsFromYtInfo(infoSummary({ ...ytInfo, title: 'mini pies #baking @kc.crafts', description: '' })!).post).caption).toEqual({ length: 28, hashtags: 1, mentions: 1 });
    expect(d.extras).toEqual({ short: false, category: 'Film & Animation', tags: ['me at the zoo', 'jawed karim'], resolution: '240p' });
    // An exact timestamp wins over the day; chapters, frame rate and live flags come through.
    const s2 = infoSummary({ ...ytInfo, timestamp: 1114370000, chapters: [{}, {}, {}], width: 1920, height: 1080, fps: 60, live_status: 'was_live' })!;
    expect(s2.dateOnly).toBe(false);
    expect(detailsFromYtInfo(s2).extras).toMatchObject({ chapters: 3, resolution: '1080p60', liveStatus: 'was_live' });
    expect(infoSummary({ id: 'nope' })).toBeNull();
  });

  test('resolution labels', () => {
    expect(resolutionLabel(1080, 1920, 30)).toBe('1080p');
    expect(resolutionLabel(null, 720, 59.94)).toBe('720p60');
    expect(resolutionLabel(null, null, 30)).toBeUndefined();
  });

  const row = (over: Partial<ReelLatestRow>): ReelLatestRow => ({
    shortcode: 'C9fRmXa1bQz', platform: 'instagram', url: '', media_id: null, author_username: 'coffeelab.daily', author_full_name: null,
    author_followers: 52_000, caption: 'cap #a', audio_title: null, duration_sec: 31, taken_at: hoursAgo(50), first_saved_at: '', last_saved_at: '',
    status: 'new', tags: [], notes: null, raw_json: JSON.stringify(igItem), snapshot_id: 1, snapshot_captured_at: '',
    latest_play_count: 600_000, latest_view_count: null, latest_like_count: 24_000, latest_comment_count: 600, latest_share_count: null,
    latest_author_followers: 52_300, latest_views: 600_000, age_hours: 50, views_per_follower: null, views_per_hour: null,
    channel_baseline_views: null, channel_multiple: null, channel_tier: null, ...over,
  });

  test('a saved row: numbers from the snapshot, extras from the raw JSON', () => {
    const d = detailsFromRow(row({}));
    expect(d.post).toMatchObject({ views: 600_000, likes: 24_000, shares: null, followers: 52_300, caption: 'cap #a' });
    expect(d.extras.collaborators).toEqual(['latte.lab']);
    const yt = detailsFromRow(row({ platform: 'youtube', shortcode: 'jNQXAC9IVRw', raw_json: JSON.stringify(trimInfo(ytInfo)) }));
    expect(yt.post.title).toBe('Me at the zoo');
    expect(yt.extras.category).toBe('Film & Animation');
    expect(detailsFromRow(row({ raw_json: '{broken' })).extras).toEqual({});
  });

  test('a scanned reel read off the grid has unknown likes, not zero', () => {
    const p = postFromScanned(mkReel('g', 5000, 3, { fromGrid: true, likes: 0, comments: 0 }));
    expect(p.likes).toBeNull();
    expect(computeMetrics(p, NOW).engagementRate).toBeNull();
    expect(postFromScanned(mkReel('e', 5000, 3)).likes).toBe(200);
  });
});
