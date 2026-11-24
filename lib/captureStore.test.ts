import { describe, expect, test } from 'bun:test';
import { buildProfileReels, CaptureStore, FRESH_TILES, mergeMedia, type GridTile, type MediaEntry } from './captureStore';
import type { Media } from './igCapture';
import { payloadFromMediaItem } from './instagram';
import { analyzeProfile } from './outliers';

const NOW = new Date('2026-10-20T12:00:00.000Z');
const sec = (hoursAgo: number) => Math.round((NOW.getTime() - hoursAgo * 3600_000) / 1000);
const HOUR = 3600_000;

function item(code: string, extra: Record<string, unknown> = {}): Media {
  return {
    pk: `9${code.length}`,
    code,
    media_type: 2,
    product_type: 'clips',
    play_count: 10_000,
    like_count: 500,
    comment_count: 20,
    user: { pk: '123', username: 'fakecreator' },
    ...extra,
  } as Media;
}

const entries = (items: Media[]): MediaEntry[] => items.map((m, seq) => ({ item: m, seenAt: 0, seq }));
const age = (iso: string) => (NOW.getTime() - Date.parse(iso)) / HOUR;

describe('mergeMedia', () => {
  test('newest wins, counts keep their max, nulls never erase, user merges', () => {
    const a = item('C1aaaaa', { taken_at: 100, caption: { text: 'hi' }, play_count: 900, user: { pk: '123', username: 'fakecreator' } });
    const b = { code: 'C1aaaaa', play_count: 800, like_count: 999, caption: null, user: { pk: '123' }, extra: 1 } as unknown as Media;
    const m = mergeMedia(a, b);
    expect(m.play_count).toBe(900);
    expect(m.like_count).toBe(999);
    expect(m.caption).toEqual({ text: 'hi' });
    expect(m.taken_at).toBe(100);
    expect(m.user).toEqual({ pk: '123', username: 'fakecreator' });
    expect(m.extra).toBe(1);
  });
});

describe('CaptureStore', () => {
  test('ingest merges by shortcode and keeps first-seen order', () => {
    const s = new CaptureStore(() => 5);
    s.ingest([item('C1aaaaa'), item('C2aaaaa')], []);
    s.ingest([item('C1aaaaa', { play_count: 20_000 })], [{ username: 'fakecreator', followers: 184_000 }]);
    expect(s.get('C1aaaaa')!.item.play_count).toBe(20_000);
    expect(s.mediaFor('fakecreator').map((e) => e.item.code)).toEqual(['C1aaaaa', 'C2aaaaa']);
    expect(s.user('FakeCreator')).toEqual({ username: 'fakecreator', id: '123', fullName: undefined, followers: 184_000, isVerified: undefined });
  });

  test('items with only the author pk are attributed through known users and grid codes', () => {
    const s = new CaptureStore();
    s.ingest([item('CXpkonly1', { user: { pk: '456' } }), item('CXother01', { user: { pk: '999' } })], []);
    expect(s.mediaFor('coffeelab.daily')).toHaveLength(0);
    s.ingest([], [{ username: 'coffeelab.daily', id: '456' }]);
    expect(s.mediaFor('coffeelab.daily').map((e) => e.item.code)).toEqual(['CXpkonly1']);
    expect(s.authorOf(s.get('CXpkonly1')!.item)).toBe('coffeelab.daily');
    expect(s.mediaFor('coffeelab.daily', new Set(['CXother01'])).map((e) => e.item.code)).toEqual(['CXpkonly1', 'CXother01']);
  });
});

describe('buildProfileReels', () => {
  test('dated captures: exact numbers, grid order, limit, photos skipped', () => {
    const items = [
      item('C0aaaaa', { taken_at: sec(10), play_count: 1000 }),
      item('C1aaaaa', { taken_at: sec(100), media_type: 1, product_type: 'feed' }),
      item('C2aaaaa', { taken_at: sec(200), play_count: 3000 }),
      item('C3aaaaa', { taken_at: sec(300), play_count: 4000 }),
    ];
    const tiles: GridTile[] = items.map((m) => ({ code: m.code, pinned: false }));
    const reels = buildProfileReels({ entries: entries(items), tiles, limit: 2, now: NOW });
    expect(reels.map((r) => r.shortcode)).toEqual(['C0aaaaa', 'C2aaaaa']);
    expect(reels.every((r) => !r.dateEstimated && !r.fromGrid)).toBe(true);
    expect(reels[1]!.views).toBe(3000);
    expect(reels[0]!.raw).toBe(items[0]);
  });

  test('grid-only fallback: views from tiles, first FRESH_TILES unpinned are under 72h, pinned is mature', () => {
    const tiles: GridTile[] = [
      { code: 'CPINNED1', views: 900_000, pinned: true },
      ...Array.from({ length: 8 }, (_, i) => ({ code: `CGRID${i}0`, views: 1000 * (i + 1), pinned: false })),
      { code: 'CNOVIEWS', pinned: false },
    ];
    const reels = buildProfileReels({ entries: [], tiles, limit: 50, now: NOW });
    expect(reels).toHaveLength(9); // the tile with no number is skipped
    expect(reels.every((r) => r.fromGrid && r.dateEstimated)).toBe(true);
    const unpinned = reels.filter((r) => !r.pinned);
    expect(unpinned.slice(0, FRESH_TILES).every((r) => age(r.takenAt) < 72)).toBe(true);
    expect(unpinned.slice(FRESH_TILES).every((r) => age(r.takenAt) > 72)).toBe(true);
    // Grid order stays newest-first.
    const ages = unpinned.map((r) => age(r.takenAt));
    expect([...ages].sort((a, b) => a - b)).toEqual(ages);
    expect(age(reels[0]!.takenAt)).toBeGreaterThan(Math.max(...ages));

    const a = analyzeProfile(reels, { followers: 10_000 }, { now: NOW });
    expect(a.stats.matureCount).toBe(6); // 5 unpinned past FRESH_TILES + the pinned one
    expect(a.stats.fromGrid).toBe(9);
    expect(a.stats.datesEstimated).toBe(9);
    expect(a.stats.medianEngagementRate).toBeNull();
  });

  test('mixed: undated reels interpolate between dated neighbours on the grid', () => {
    const items = [
      item('C0aaaaa', { taken_at: sec(10) }),
      item('C1aaaaa'),
      item('C2aaaaa'),
      item('C3aaaaa', { taken_at: sec(310) }),
      item('C4aaaaa'),
    ];
    const tiles = items.map((m) => ({ code: m.code, pinned: false }));
    const reels = buildProfileReels({ entries: entries(items), tiles, limit: 10, now: NOW });
    expect(reels.map((r) => Math.round(age(r.takenAt)))).toEqual([10, 110, 210, 310, 410]);
    expect(reels.map((r) => !!r.dateEstimated)).toEqual([false, true, true, false, true]);
  });

  test('reels above the first dated one sit between now and it', () => {
    const items = [item('C0aaaaa'), item('C1aaaaa'), item('C2aaaaa', { taken_at: sec(300) })];
    const reels = buildProfileReels({ entries: entries(items), tiles: items.map((m) => ({ code: m.code, pinned: false })), limit: 10, now: NOW });
    expect(reels.map((r) => Math.round(age(r.takenAt)))).toEqual([100, 200, 300]);
  });

  test('a dated item that never showed on the grid is no anchor', () => {
    // Feed item by the same creator, captured before the scan: real date, no grid position.
    const gridItems = Array.from({ length: 6 }, (_, i) => item(`CG${i}aaaa`));
    const stray = item('CSTRAY01', { taken_at: sec(5) });
    const reels = buildProfileReels({
      entries: entries([...gridItems, stray]),
      tiles: gridItems.map((m) => ({ code: m.code, pinned: false })),
      limit: 20,
      now: NOW,
    });
    const grid = reels.filter((r) => r.shortcode !== 'CSTRAY01');
    expect(grid.slice(FRESH_TILES).every((r) => age(r.takenAt) > 72)).toBe(true);
    expect(Math.round(age(reels.find((r) => r.shortcode === 'CSTRAY01')!.takenAt))).toBe(5);
  });

  test('captured item with zero views takes the tile number', () => {
    const it = item('C0aaaaa', { taken_at: sec(100), play_count: undefined });
    const reels = buildProfileReels({ entries: entries([it]), tiles: [{ code: 'C0aaaaa', views: 41_000, pinned: true }], limit: 5, now: NOW });
    expect(reels[0]!.views).toBe(41_000);
    expect(reels[0]!.pinned).toBe(true);
  });
});

describe('payloadFromMediaItem', () => {
  test('maps a captured item to a save payload with raw = item', () => {
    const it = item('C9xYz12AbcD', {
      taken_at: 1_760_000_000,
      ig_play_count: 77,
      play_count: undefined,
      video_duration: 12.5,
      caption: { text: 'cap' },
      clips_metadata: { music_info: { music_asset_info: { title: 'Song' } } },
      user: { pk: '456' },
    });
    const p = payloadFromMediaItem(it, { shortcode: 'C9xYz12AbcD', username: 'coffeelab.daily', followers: 52_300, capturedAt: '2026-10-20T00:00:00.000Z' });
    expect(p).toMatchObject({
      shortcode: 'C9xYz12AbcD',
      url: 'https://www.instagram.com/reel/C9xYz12AbcD/',
      author: { username: 'coffeelab.daily', followers: 52_300 },
      caption: 'cap',
      audioTitle: 'Song',
      durationSec: 12.5,
      takenAt: new Date(1_760_000_000_000).toISOString(),
      stats: { playCount: 77, likeCount: 500, commentCount: 20 },
      capturedAt: '2026-10-20T00:00:00.000Z',
      source: 'api',
    });
    expect(p.raw).toBe(it);
  });
});

describe('upload dates from media ids', () => {
  test('reels-tab items without taken_at and grid-only tiles get exact dates from their codes', () => {
    const now = new Date(Date.UTC(2026, 10, 1));
    const items = [item('Decg1Q-Opbw', { pk: undefined }), item('Ddbl5eBNpiQ', { pk: undefined })];
    const reels = buildProfileReels({
      entries: entries(items),
      tiles: [...items.map((m) => ({ code: m.code, pinned: false })), { code: 'Ddbl5eBNpiQ', pinned: false }],
      limit: 10,
      now,
    });
    expect(reels.map((r) => r.dateEstimated ?? false)).toEqual([false, false]);
    expect(Math.abs(Date.parse(reels[0]!.takenAt) / 1000 - 1791918180) < 180).toBe(true);

    const grid = buildProfileReels({ entries: [], tiles: [{ code: 'Decg1Q-Opbw', views: 5000, pinned: false }], limit: 5, now });
    expect(grid[0]!.fromGrid).toBe(true);
    expect(grid[0]!.dateEstimated ?? false).toBe(false);
  });
});

describe('save-all copy', () => {
  test('labels and summary', async () => {
    const { saveAllLabel, bulkSummaryText, bulkProgressText } = await import('../entrypoints/content/scanCopy');
    expect(saveAllLabel(0, 0)).toEqual({ text: 'No outliers', disabled: true });
    expect(saveAllLabel(28, 0)).toEqual({ text: 'All outliers saved', disabled: true });
    expect(saveAllLabel(28, 28)).toEqual({ text: 'Save all 28 outliers', disabled: false });
    expect(saveAllLabel(1, 1).text).toBe('Save 1 outlier');
    expect(saveAllLabel(28, 3).text).toBe('Save 3 unsaved');
    expect(saveAllLabel(10, 0, 10)).toEqual({ text: '10 queued, server offline', disabled: true });
    expect(bulkProgressText({ done: 6, total: 28 })).toBe('Saving 7 / 28');
    expect(bulkProgressText({ done: 28, total: 28 })).toBe('Saving 28 / 28');
    expect(bulkSummaryText({ scope: 'outliers', saved: 25, already: 2, queued: 0, failed: 1, cancelled: 0 })).toBe('Saved 25 · 2 already saved · 1 failed');
    expect(bulkSummaryText({ scope: 'all', saved: 5, already: 0, queued: 3, failed: 0, cancelled: 23 })).toBe(
      'Saved 5 · 3 queued (server offline) · 23 left (cancelled)',
    );
  });

  test('bulk menu cells', async () => {
    const { bulkScopeLabel } = await import('../entrypoints/content/scanCopy');
    expect(bulkScopeLabel('all', 150, 138)).toEqual({ text: 'Save 138', disabled: false });
    expect(bulkScopeLabel('all', 150, 0)).toEqual({ text: 'All saved', disabled: true });
    expect(bulkScopeLabel('outliers', 0, 0)).toEqual({ text: 'No outliers', disabled: true });
    expect(bulkScopeLabel('all', 0, 0)).toEqual({ text: 'No reels', disabled: true });
    expect(bulkScopeLabel('all', 150, 0, 4)).toEqual({ text: '4 queued', disabled: true });
  });
});
