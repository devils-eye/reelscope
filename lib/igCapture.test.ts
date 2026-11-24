import { describe, expect, test } from 'bun:test';
import {
  CHANNEL,
  decodeMessage,
  encodeMessage,
  extractCaptures,
  isCaptureUrl,
  mayHoldCaptures,
  parseResponseText,
} from './igCapture';
import { mapMediaItem } from './profile';

const v1 = (code: string, extra: Record<string, unknown> = {}) => ({
  pk: '3100000001',
  id: '3100000001_123',
  code,
  taken_at: 1_760_000_000,
  media_type: 2,
  product_type: 'clips',
  play_count: 52_000,
  like_count: 2100,
  comment_count: 40,
  video_duration: 31.2,
  caption: { text: 'Cold brew, three ways' },
  user: { pk: '123', username: 'fakecreator', full_name: 'Fake Creator' },
  image_versions2: { candidates: [{ url: 'https://x/a.jpg', width: 640 }] },
  video_versions: [{ url: 'https://x/a.mp4', width: 720 }],
  ...extra,
});

describe('extractCaptures', () => {
  test('GraphQL clips connection (reels tab), nested under edges/node/media', () => {
    const body = {
      data: {
        xdt_api__v1__clips__user__connection_v2: {
          edges: [{ node: { media: v1('C9xYz12AbcD') } }, { node: { media: v1('C9xYz12AbcE', { play_count: 9 }) } }],
          page_info: { end_cursor: 'x', has_next_page: true },
        },
      },
    };
    const { media, users } = extractCaptures(body);
    expect(media.map((m) => m.code)).toEqual(['C9xYz12AbcD', 'C9xYz12AbcE']);
    expect(users.some((u) => u.username === 'fakecreator' && u.id === '123')).toBe(true);
  });

  test('v1 feed items inside an SSR RelayPrefetchedStreamCache blob', () => {
    const ssr = {
      require: [['ScheduledServerJS', 'handle', null, [{ __bbox: { require: [['RelayPrefetchedStreamCache', 'next', [], ['adp_X', { __bbox: { result: { data: { feed: { edges: [{ node: { media: v1('C8feedItem1') } }] } } } } }]]] } }]]],
    };
    expect(extractCaptures(ssr).media.map((m) => m.code)).toEqual(['C8feedItem1']);
  });

  test('reels-tab lite items without taken_at still count (code + counts + pk)', () => {
    const lite = { pk: '9', code: 'CX15000000x', media_type: 2, product_type: 'clips', play_count: 8000, user: { pk: '456' } };
    expect(extractCaptures({ items: [lite] }).media).toHaveLength(1);
  });

  test('legacy graph nodes are normalised to v1 names, originals kept', () => {
    const node = {
      __typename: 'GraphVideo',
      id: '777',
      shortcode: 'B_-tKyjnSR0',
      taken_at_timestamp: 1_700_000_000,
      is_video: true,
      video_view_count: 41_000,
      edge_media_preview_like: { count: 900 },
      edge_media_to_comment: { count: 12 },
      edge_media_to_caption: { edges: [{ node: { text: 'hello' } }] },
      owner: { id: '123', username: 'fakecreator' },
      display_url: 'https://x/d.jpg',
      dimensions: { width: 640, height: 1136 },
    };
    const { media } = extractCaptures({ data: { user: { edge_owner_to_timeline_media: { edges: [{ node }] } } } });
    expect(media).toHaveLength(1);
    const m = media[0]!;
    expect(m.code).toBe('B_-tKyjnSR0');
    expect(m.taken_at).toBe(1_700_000_000);
    expect(m.media_type).toBe(2);
    expect(m.view_count).toBe(41_000);
    expect(m.like_count).toBe(900);
    expect(m.comment_count).toBe(12);
    expect(m.shortcode).toBe('B_-tKyjnSR0');
    const reel = mapMediaItem(m)!;
    expect(reel.views).toBe(41_000);
    expect(reel.caption).toBe('hello');
    expect(reel.takenAt).toBe(new Date(1_700_000_000_000).toISOString());
  });

  test('users: web_profile_info (edge_followed_by) and v1 (follower_count)', () => {
    const { users } = extractCaptures({
      a: { data: { user: { id: '123', username: 'fakecreator', full_name: 'F', is_verified: true, edge_followed_by: { count: 184_000 } } } },
      b: { user: { pk: 456, username: 'coffeelab.daily', follower_count: 52_300 } },
      c: { username: 'mention.only' },
    });
    expect(users).toContainEqual({ username: 'fakecreator', id: '123', fullName: 'F', followers: 184_000, isVerified: true });
    expect(users).toContainEqual({ username: 'coffeelab.daily', id: '456', followers: 52_300 });
    expect(users.find((u) => u.username === 'mention.only')).toBe(undefined);
  });

  test('stories, ads and plain objects with a code are not media', () => {
    const { media } = extractCaptures({
      reel: { items: [v1('Cstory00001', { product_type: 'story' }), v1('Cad00000001', { product_type: 'ad' })] },
      other: { code: 'C9xYz12AbcD' },
      badcode: v1('no spaces allowed'),
    });
    expect(media).toHaveLength(0);
  });

  test('photos are captured but mapMediaItem drops them', () => {
    const { media } = extractCaptures({ items: [v1('Cphoto00001', { media_type: 1, product_type: 'feed' })] });
    expect(media).toHaveLength(1);
    expect(mapMediaItem(media[0])).toBeNull();
  });

  test('survives deep and wide inputs', () => {
    let deep: unknown = v1('Cdeep000001');
    for (let i = 0; i < 70; i++) deep = { x: deep };
    expect(extractCaptures(deep).media).toHaveLength(1);
    const wide = { items: Array.from({ length: 2000 }, (_, i) => v1(`Cwide${String(i).padStart(6, '0')}`)) };
    expect(extractCaptures(wide).media.length).toBeLessThanOrEqual(600);
  });
});

describe('parseResponseText', () => {
  test('plain JSON, for(;;) guard, streamed multi-document', () => {
    expect(parseResponseText('{"a":1}')).toEqual([{ a: 1 }]);
    expect(parseResponseText('for (;;);{"a":2}')).toEqual([{ a: 2 }]);
    expect(parseResponseText('{"data":{"x":1}}\r\n{"label":"y","data":{"z":2}}\n')).toEqual([
      { data: { x: 1 } },
      { label: 'y', data: { z: 2 } },
    ]);
    expect(parseResponseText('<!doctype html>')).toEqual([]);
    expect(parseResponseText('{"broken":')).toEqual([]);
  });

  test('mayHoldCaptures pre-filter', () => {
    expect(mayHoldCaptures('{"taken_at":1}')).toBe(true);
    expect(mayHoldCaptures('{"taken_at_timestamp":1}')).toBe(true);
    expect(mayHoldCaptures('{"edge_followed_by":{}}')).toBe(true);
    expect(mayHoldCaptures('{"gk":true}')).toBe(false);
  });
});

describe('isCaptureUrl', () => {
  const o = 'https://www.instagram.com';
  test('GraphQL and v1 media/user endpoints', () => {
    for (const u of [
      '/graphql/query',
      '/graphql/query/',
      '/api/graphql',
      'https://www.instagram.com/api/v1/feed/user/123/?count=12',
      '/api/v1/clips/user/',
      '/api/v1/media/3100000001/info/',
      '/api/v1/users/web_profile_info/?username=x',
      'https://i.instagram.com/api/v1/feed/timeline/',
    ])
      expect(isCaptureUrl(u, o)).toBe(true);
  });
  test('everything else', () => {
    for (const u of ['/ajax/bz', '/api/v1/direct_v2/inbox/', '/logging/falco', 'https://example.com/graphql/query', 'blob:abc', '/'])
      expect(isCaptureUrl(u, o)).toBe(false);
  });
});

describe('messages', () => {
  test('round trip', () => {
    const msg = {
      kind: 'capture' as const,
      media: [v1('C9xYz12AbcD')],
      users: [{ username: 'a.b', id: '1', followers: 5 }],
    };
    expect(decodeMessage(encodeMessage(msg))).toEqual(msg);
    expect(decodeMessage(encodeMessage({ kind: 'replay' }))).toEqual({ kind: 'replay' });
  });
  test('rejects foreign and malformed data, drops bad entries', () => {
    expect(decodeMessage({ kind: 'capture' })).toBeNull();
    expect(decodeMessage('hello')).toBeNull();
    expect(decodeMessage(`${CHANNEL}{nope`)).toBeNull();
    expect(decodeMessage(`${CHANNEL}{"kind":"capture","media":{},"users":[]}`)).toBeNull();
    const m = decodeMessage(
      `${CHANNEL}${JSON.stringify({ kind: 'capture', media: [{ code: 'bad code' }, { code: 'C9xYz12AbcD' }, 3], users: [{ username: 'ok_1', followers: -1, id: 'x' }, { username: '' }] })}`,
    );
    expect(m).toEqual({ kind: 'capture', media: [{ code: 'C9xYz12AbcD' }], users: [{ username: 'ok_1' }] });
  });
});

describe('pickVideoUrl', () => {
  test('widest version up to 720px, else the narrowest; ignores junk', async () => {
    const { pickVideoUrl } = await import('./profile');
    const vv = (...ws: number[]) => ({ video_versions: ws.map((w) => ({ url: `u${w}`, width: w })) });
    expect(pickVideoUrl(vv(1080, 720, 480))).toBe('u720');
    expect(pickVideoUrl(vv(640, 480))).toBe('u640');
    expect(pickVideoUrl(vv(1080, 1440))).toBe('u1080');
    expect(pickVideoUrl({ video_versions: [{ width: 480 }, null, { url: '', width: 1 }] })).toBe(undefined);
    expect(pickVideoUrl({})).toBe(undefined);
    expect(pickVideoUrl(undefined)).toBe(undefined);
  });
});

describe('pickThumbUrl', () => {
  test('the candidate closest to 640 wide, else thumbnail_url / display_uri', async () => {
    const { pickThumbUrl } = await import('./profile');
    const cands = (...ws: number[]) => ({ image_versions2: { candidates: ws.map((w) => ({ url: `t${w}`, width: w })) } });
    expect(pickThumbUrl(cands(1080, 640, 320))).toBe('t640');
    expect(pickThumbUrl(cands(1080, 750))).toBe('t750');
    expect(pickThumbUrl({ image_versions2: { candidates: [] }, thumbnail_url: 'thumb' })).toBe('thumb');
    expect(pickThumbUrl({ display_uri: 'disp' })).toBe('disp');
    expect(pickThumbUrl({})).toBe(undefined);
  });
});
