import { describe, expect, test } from 'bun:test';
import { isLongVideo } from './platform';
import {
  anchorPositions,
  buildChannelScan,
  channelKey,
  channelUrl,
  profileFromPlaylist,
  missingViewPositions,
  reelFromEntry,
  saveFromInfo,
  thumbCandidates,
  youtubeId,
  windowEnd,
  ytErrorKind,
  ytErrorText,
} from './youtube';

describe('ids and channels', () => {
  test('youtubeId reads every URL shape and rejects the rest', () => {
    expect(youtubeId('RwbnBj7SsfU')).toBe('RwbnBj7SsfU');
    expect(youtubeId('https://www.youtube.com/watch?v=2byPP_9F0-Q&t=30s')).toBe('2byPP_9F0-Q');
    expect(youtubeId('https://www.youtube.com/shorts/RwbnBj7SsfU?feature=share')).toBe('RwbnBj7SsfU');
    expect(youtubeId('https://youtu.be/2byPP_9F0-Q')).toBe('2byPP_9F0-Q');
    expect(youtubeId('https://m.youtube.com/embed/2byPP_9F0-Q')).toBe('2byPP_9F0-Q');
    expect(youtubeId('https://www.youtube.com/@kallaway')).toBeNull();
    expect(youtubeId('https://www.instagram.com/reel/DPx1aBcDeFg/')).toBeNull();
    expect(youtubeId('too-short')).toBeNull();
  });
  test('channelKey: handles lowercased without @, channel ids kept', () => {
    expect(channelKey('@Kallaway')).toBe('kallaway');
    expect(channelKey('/@kallaway/shorts')).toBe('kallaway');
    expect(channelKey('https://www.youtube.com/@KallawayMarketing/videos')).toBe('kallawaymarketing');
    expect(channelKey('/channel/UCnl8_0CEX3mRPMeg4_xEF9w/shorts')).toBe('UCnl8_0CEX3mRPMeg4_xEF9w');
    expect(channelKey('UCnl8_0CEX3mRPMeg4_xEF9w')).toBe('UCnl8_0CEX3mRPMeg4_xEF9w');
    expect(channelKey('/@a/shorts')).toBeNull(); // too short to be a handle
    expect(channelKey('https://www.youtube.com/watch?v=2byPP_9F0-Q')).toBeNull();
    expect(channelUrl('kallaway')).toBe('https://www.youtube.com/@kallaway');
    expect(channelUrl('UCnl8_0CEX3mRPMeg4_xEF9w')).toBe('https://www.youtube.com/channel/UCnl8_0CEX3mRPMeg4_xEF9w');
  });
});

const shortInfo = {
  id: 'RwbnBj7SsfU',
  title: 'I built a tiny espresso machine #shorts',
  description: 'Link in bio',
  channel: 'Kallaway',
  channel_id: 'UCnl8_0CEX3mRPMeg4_xEF9w',
  uploader_id: '@kallaway',
  channel_follower_count: 40400,
  duration: 111,
  view_count: 926489,
  like_count: 349,
  comment_count: 6,
  timestamp: 1754001619,
  media_type: 'short',
  width: 720,
  height: 1280,
  formats: [{ format_id: '18' }],
  automatic_captions: { en: [] },
};

describe('a save from yt-dlp info', () => {
  test('a Short: exact numbers, Shorts URL, title then description, trimmed raw', () => {
    const s = saveFromInfo(shortInfo)!;
    expect(s).toMatchObject({
      shortcode: 'RwbnBj7SsfU',
      url: 'https://www.youtube.com/shorts/RwbnBj7SsfU',
      username: 'kallaway',
      fullName: 'Kallaway',
      followers: 40400,
      caption: 'I built a tiny espresso machine #shorts\n\nLink in bio',
      durationSec: 111,
      takenAt: '2025-07-31T22:40:19.000Z',
      viewCount: 926489,
      likeCount: 349,
      commentCount: 6,
      short: true,
    });
    expect(s.raw.formats).toBe(undefined);
    expect(s.raw.automatic_captions).toBe(undefined);
    expect(s.raw.platform).toBe('youtube');
  });
  test('a long video gets a watch URL; no handle falls back to the channel id', () => {
    const s = saveFromInfo({ ...shortInfo, media_type: 'video', width: 1920, height: 1080, uploader_id: undefined, uploader_url: undefined })!;
    expect(s.url).toBe('https://www.youtube.com/watch?v=RwbnBj7SsfU');
    expect(s.short).toBe(false);
    expect(s.username).toBe('UCnl8_0CEX3mRPMeg4_xEF9w');
  });
  test('no id or no channel: not a save', () => {
    expect(saveFromInfo({ ...shortInfo, id: undefined })).toBeNull();
    expect(saveFromInfo({ ...shortInfo, uploader_id: undefined, channel_id: undefined })).toBeNull();
    expect(saveFromInfo(null)).toBeNull();
  });
  test('Shorts try the portrait thumbnail first', () => {
    expect(thumbCandidates('RwbnBj7SsfU', true)[0]).toBe('https://i.ytimg.com/vi/RwbnBj7SsfU/oar2.jpg');
    expect(thumbCandidates('RwbnBj7SsfU', false)[0]).toBe('https://i.ytimg.com/vi/RwbnBj7SsfU/maxresdefault.jpg');
  });
});

const DAY = 86_400_000;
const now = new Date('2026-10-24T00:00:00Z');
const entry = (i: number) => ({
  id: `vid${String(i).padStart(8, '0')}`,
  title: `Short ${i}`,
  view_count: 1000 * (i + 1),
  thumbnails: [
    { url: `https://i.ytimg.com/vi/x/oar3.jpg?wide`, width: 720, height: 405 },
    { url: `https://i.ytimg.com/vi/x/oar3.jpg?tall${i}`, width: 405, height: 720 },
  ],
});
const infoFor = (i: number, daysAgo: number) => ({
  id: `vid${String(i).padStart(8, '0')}`,
  uploader_id: '@kallaway',
  view_count: 1234 * (i + 1),
  like_count: 10,
  comment_count: 2,
  duration: 30,
  timestamp: (now.getTime() - daysAgo * DAY) / 1000,
});

describe('a Shorts scan', () => {
  test('a listed Short is rounded and undated until looked up', () => {
    expect(reelFromEntry(entry(0))).toMatchObject({
      shortcode: 'vid00000000',
      url: 'https://www.youtube.com/shorts/vid00000000',
      views: 1000,
      takenAt: '',
      fromGrid: true,
      caption: 'Short 0',
      thumbnailUrl: 'https://i.ytimg.com/vi/x/oar3.jpg?tall0',
    });
    expect(reelFromEntry({ title: 'no id' })).toBeNull();
  });
  test('anchors: the newest few, then a spread to the last', () => {
    expect(anchorPositions(0)).toEqual([]);
    expect(anchorPositions(3)).toEqual([0, 1, 2]);
    const a = anchorPositions(36);
    expect(a.slice(0, 4)).toEqual([0, 1, 2, 3]);
    expect(a[a.length - 1]).toBe(35);
    expect(a.length).toBeLessThanOrEqual(12);
    expect(new Set(a).size).toBe(a.length);
    expect(anchorPositions(2000).length).toBeLessThanOrEqual(12);
  });
  test('looked-up Shorts are exact; the rest get dates between them', () => {
    const entries = Array.from({ length: 10 }, (_, i) => entry(i));
    const infos = new Map<number, unknown>([
      [0, infoFor(0, 1)],
      [4, infoFor(4, 9)],
      [9, infoFor(9, 19)],
    ]);
    const reels = buildChannelScan(entries, infos, now);
    expect(reels).toHaveLength(10);
    expect(reels[0]).toMatchObject({ views: 1234, likes: 10, comments: 2, fromGrid: false, takenAt: new Date(now.getTime() - DAY).toISOString() });
    expect(reels[0]!.dateEstimated).toBe(undefined);
    expect(reels[1]).toMatchObject({ views: 2000, fromGrid: true, dateEstimated: true });
    // Halfway between 1 and 9 days ago, by list position.
    expect(Date.parse(reels[2]!.takenAt)).toBe(now.getTime() - 5 * DAY);
    expect(Date.parse(reels[7]!.takenAt)).toBe(now.getTime() - 15 * DAY);
  });
  test('a listed long video: watch link and the landscape thumbnail', () => {
    expect(reelFromEntry({ ...entry(0), duration: 1055 }, 'long')).toMatchObject({
      shortcode: 'vid00000000',
      url: 'https://www.youtube.com/watch?v=vid00000000',
      views: 1000,
      durationSec: 1055,
      fromGrid: true,
      thumbnailUrl: 'https://i.ytimg.com/vi/x/oar3.jpg?wide',
    });
    expect(reelFromEntry({ id: 'vid00000000' }, 'long')!.thumbnailUrl).toBe('https://i.ytimg.com/vi/vid00000000/hqdefault.jpg');
  });
  test('premieres and live streams are left out of a scan', () => {
    const entries = [entry(0), { ...entry(1), live_status: 'is_upcoming' }, entry(2), entry(3)];
    const infos = new Map<number, unknown>([
      [0, { ...infoFor(0, 1), live_status: 'is_live' }],
      [3, infoFor(3, 9)],
    ]);
    const reels = buildChannelScan(entries, infos, now, 'long');
    expect(reels.map((r) => r.shortcode)).toEqual(['vid00000002', 'vid00000003']);
    expect(reels[0]!.url).toBe('https://www.youtube.com/watch?v=vid00000002');
  });
  test('listed videos without a view count get looked up', () => {
    const { view_count: _v, ...bare } = entry(1);
    const entries = [entry(0), bare, entry(2), bare, { ...bare, live_status: 'is_upcoming' }];
    expect(missingViewPositions(entries)).toEqual([1, 3]);
    expect(missingViewPositions(entries, 1)).toEqual([1]);
    // Looked up: exact. Not reached: left out rather than scored at 0 views.
    const reels = buildChannelScan(entries, new Map([[1, infoFor(1, 2)]]), now, 'long');
    expect(reels.map((r) => [r.shortcode, r.views])).toEqual([
      ['vid00000000', 1000],
      ['vid00000001', 2468],
      ['vid00000002', 3000],
    ]);
  });
  test('the channel: handle key, followers, avatar', () => {
    const p = profileFromPlaylist(
      {
        channel: 'Kallaway',
        channel_id: 'UCnl8_0CEX3mRPMeg4_xEF9w',
        uploader_id: '@kallaway',
        channel_follower_count: 40400,
        thumbnails: [{ id: 'banner_uncropped', url: 'b' }, { id: 'avatar_uncropped', url: 'a' }],
      },
      'kallaway',
    );
    expect(p).toEqual({
      userId: 'UCnl8_0CEX3mRPMeg4_xEF9w',
      username: 'kallaway',
      fullName: 'Kallaway',
      followers: 40400,
      profilePicUrl: 'a',
      platform: 'youtube',
    });
    expect(profileFromPlaylist(null, 'kallaway').username).toBe('kallaway');
  });
});

describe('yt-dlp errors', () => {
  test('gone for good, missing, or worth a retry', () => {
    expect(ytErrorKind('ERROR: [youtube] aaaaaaaaaaa: This video is unavailable')).toBe('gone');
    expect(ytErrorKind('ERROR: [youtube] x: Private video. Sign in if you have access')).toBe('gone');
    expect(ytErrorKind("ERROR: [youtube] x: Sign in to confirm you're not a bot")).toBe('retry');
    expect(ytErrorKind('ERROR: [youtube] x: Video unavailable. This content isn’t available, try again later.')).toBe('retry');
    expect(ytErrorKind('ERROR: [youtube:tab] @x: Unable to download API page: HTTP Error 404: Not Found')).toBe('missing');
    expect(ytErrorKind('ERROR: [youtube:tab] @kallawaymarketing: This channel does not have a shorts tab')).toBe('missing');
    expect(ytErrorKind('ERROR: [youtube:tab] @someone: This channel does not have a videos tab')).toBe('missing');
  });
  test('the message without the extractor prefix', () => {
    expect(ytErrorText('WARNING: x\nERROR: [youtube] aaaaaaaaaaa: This video is unavailable\n')).toBe('This video is unavailable');
  });
});

describe('windowEnd', () => {
  // Newest first, one upload a day: position i was uploaded i days ago.
  const DAY = 86400_000;
  const now = Date.UTC(2026, 9, 31);
  const at = (i: number) => now - i * DAY - 3600_000;
  const lookups = (fail: Set<number> = new Set()) => {
    const seen: number[] = [];
    const dateAt = async (i: number) => (seen.push(i), fail.has(i) ? undefined : at(i));
    return { seen, dateAt };
  };

  test('finds the first position older than the window', async () => {
    const { seen, dateAt } = lookups();
    expect(await windowEnd(200, now - 30 * DAY, new Map(), dateAt)).toBe(30);
    expect(seen.length).toBeLessThanOrEqual(9);
  });

  test('starts from what is already known', async () => {
    const { seen, dateAt } = lookups();
    const known = new Map([
      [15, at(15)],
      [31, at(31)],
    ]);
    expect(await windowEnd(200, now - 30 * DAY, known, dateAt)).toBe(30);
    expect(seen.every((i) => i > 15 && i < 31)).toBe(true);
  });

  test('everything inside the window, or nothing', async () => {
    expect(await windowEnd(20, now - 30 * DAY, new Map(), lookups().dateAt)).toBe(20);
    expect(await windowEnd(20, now + DAY, new Map(), lookups().dateAt)).toBe(0);
    expect(await windowEnd(0, now - 30 * DAY, new Map(), lookups().dateAt)).toBe(0);
  });

  test('a failed lookup tries the next position, and gives up keeping the rest', async () => {
    expect(await windowEnd(64, now - 30 * DAY, new Map(), lookups(new Set([31])).dateAt)).toBe(30);
    const all = new Set(Array.from({ length: 64 }, (_, i) => i));
    expect(await windowEnd(64, now - 30 * DAY, new Map(), lookups(all).dateAt)).toBe(64);
  });
});

describe('isLongVideo', () => {
  test('a /watch link on YouTube is a long video; Shorts and reels are not', () => {
    expect(isLongVideo({ platform: 'youtube', url: 'https://www.youtube.com/watch?v=jBEOdMKAkEU' })).toBe(true);
    expect(isLongVideo({ platform: 'youtube', url: 'https://www.youtube.com/shorts/cJi3RWrM3Oc' })).toBe(false);
    expect(isLongVideo({ platform: 'instagram', url: 'https://www.instagram.com/reel/DUm_MGfjNan/' })).toBe(false);
    expect(isLongVideo({ url: 'https://www.instagram.com/reel/DUm_MGfjNan/' })).toBe(false);
  });
});
