// Fake Instagram data + endpoints for the harness (vite middleware in
// ../vite.config.ts) and the extension e2e (Playwright route). Plain ESM, no
// deps, deterministic. The shapes follow what Instagram's web app receives:
//
//   reels tab   POST /graphql/query  doc=reels -> xdt_api__v1__clips__user__connection_v2
//   profile     XHR /graphql/query   doc=profile -> data.user (legacy graph shape,
//               with the first posts as edge_owner_to_timeline_media)
//   post modal  POST /graphql/query  doc=post -> xdt_api__v1__media__shortcode__web_info
//   reels feed  POST /graphql/query  doc=clips_home -> xdt_api__v1__clips__home__connection_v2
//   home feed   SSR <script type="application/json"> (RelayPrefetchedStreamCache)
//   plain.tiles GET /ajax/plain_reels  (an endpoint the hook does NOT read: the
//               grid-only fallback path)
//   /api/v1/media/<id>/info/  answered, but saves should never need it.
//
// Profiles: fakecreator (160 dated reels), coffeelab.daily (40 reels whose
// reels-tab items carry no taken_at and only the author's pk), plain.tiles
// (30 reels only visible as grid tiles).

const ALPHA = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
export const PAGE = 12;
const NOW = Math.floor(Date.now() / 1000);

export const USERS = {
  fakecreator: { pk: '123', full_name: 'Fake Creator · Coffee Lab', followers: 184000 },
  'coffeelab.daily': { pk: '456', full_name: 'Coffee Lab Daily', followers: 52300 },
  'latte.lab': { pk: '789', full_name: 'Latte Lab', followers: 9100 },
  'morning.ritual': { pk: '790', full_name: 'Morning Ritual', followers: 3300 },
};

function prng(seed) {
  let s = seed;
  const rand = () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
  const gauss = () => Math.sqrt(-2 * Math.log(rand() || 1e-9)) * Math.cos(2 * Math.PI * rand());
  return { rand, gauss };
}

const CAPTIONS = [
  'The 3 mistakes everyone makes with cold brew',
  'Comment "RECIPE" and I\'ll DM you the full guide',
  'POV: your landlord finds out about the espresso machine',
  "I tested every grinder under $100 so you don't have to",
  'Link in bio for the full breakdown',
  "Why your latte art keeps failing (it's not the milk)",
  '',
  'Day 41 of opening a coffee shop with no experience',
];

const codeToId = (code) => [...code.slice(0, 11)].reduce((n, c) => n * 64n + BigInt(ALPHA.indexOf(c)), 0n);

/**
 * A real-looking shortcode: Instagram media ids carry their creation time
 * (ms since 2011-08-24 21:07:01.721 UTC, shifted left 23 bits).
 */
function codeAt(unixSec, seq) {
  return idToCode(((BigInt(unixSec) * 1000n - 1314220021721n) << 23n) | (1729n << 10n) | BigInt(seq % 1024));
}

/** Audio as Instagram sends it: a licensed track every third reel, else the creator's original audio. */
function clipsMetadata(i, user) {
  return i % 3 === 0
    ? { audio_type: 'licensed_music', music_info: { music_asset_info: { title: ['Espresso', 'Good Luck, Babe!', 'Birds of a Feather'][i % 9 / 3 | 0], display_artist: ['Sabrina Carpenter', 'Chappell Roan', 'Billie Eilish'][i % 9 / 3 | 0] } } }
    : { audio_type: 'original_sounds', original_sound_info: { original_audio_title: 'Original audio', ig_artist: { username: user } } };
}

function v1Item(code, i, user, { views, ageH, pinned = false, takenAt }) {
  const u = USERS[user];
  const pk = String(codeToId(code));
  const likes = Math.round(views * (0.02 + ((i * 7) % 10) / 200));
  return {
    pk,
    id: `${pk}_${u?.pk ?? '1'}`,
    code,
    taken_at: takenAt ?? NOW - Math.round(ageH * 3600),
    media_type: 2,
    product_type: 'clips',
    play_count: views,
    ig_play_count: views,
    like_count: likes,
    comment_count: Math.round(likes * (0.01 + ((i * 3) % 8) / 100)),
    // Instagram sends shares on most clips, not all.
    ...(i % 4 === 3 ? {} : { reshare_count: Math.round(likes * (0.04 + (i % 5) / 25)) }),
    clips_metadata: clipsMetadata(i, user),
    video_duration: 18 + (i % 40),
    caption: { text: CAPTIONS[i % CAPTIONS.length] || null },
    user: { pk: u?.pk ?? '1', username: user, full_name: u?.full_name ?? user, is_verified: false },
    // Served by handleApi below (the panel shows it; the library server can't fetch it, which is fine).
    image_versions2: { candidates: [{ url: `/fixture-thumb/${code}.svg`, width: 640, height: 1136 }] },
    // /fixture-video/ isn't served by the fixture: e2e scripts route it to a
    // real clip (or a 403, like an expired signed CDN URL).
    video_versions: [
      { url: `/fixture-video/${code}-1080.mp4`, width: 1080, height: 1920, type: 101 },
      { url: `/fixture-video/${code}.mp4`, width: 720, height: 1280, type: 101 },
    ],
    clips_tab_pinned_user_ids: pinned ? [u?.pk ?? '1'] : [],
    __fixture: 'graphql',
  };
}

function makeReels() {
  const out = {};
  {
    const { rand, gauss } = prng(7);
    out.fakecreator = Array.from({ length: 160 }, (_, i) => {
      const ageH = i === 0 ? 20 : i === 1 ? 50 : 30 + i * 52 + rand() * 30;
      let views = Math.round(Math.exp(Math.log(42000) + gauss() * 0.55));
      if (i === 6) views = 1_900_000;
      if (i === 13) views = 410_000;
      if (i === 22) views = 260_000;
      if (i === 30) views = 118_000;
      if (i === 1) views = 160_000;
      if (i === 9) views = 9_000;
      return v1Item(`FAKE${String(i).padStart(3, '0')}`, i, 'fakecreator', { views, ageH, pinned: i === 22 });
    });
  }
  {
    const { rand, gauss } = prng(11);
    out['coffeelab.daily'] = Array.from({ length: 40 }, (_, i) => {
      let views = Math.round(Math.exp(Math.log(9000) + gauss() * 0.4));
      if (i === 4) views = 120_000;
      if (i === 17) views = 61_000;
      // Real-looking codes: the reels tab sends no taken_at for these, but
      // the upload time is still in the media id.
      const takenAt = NOW - Math.round((30 + i * 70 + rand() * 20) * 3600);
      return v1Item(codeAt(takenAt, i), i, 'coffeelab.daily', { views, takenAt });
    });
  }
  {
    const { gauss } = prng(5);
    out['plain.tiles'] = Array.from({ length: 30 }, (_, i) => {
      let views = Math.round(Math.exp(Math.log(20000) + gauss() * 0.35));
      if (i === 5) views = 300_000;
      return v1Item(`PLAIN${String(i).padStart(3, '0')}`, i, 'plain.tiles', { views, ageH: 30 + i * 60 });
    });
  }
  return out;
}

export const REELS = makeReels();

/** What the reels tab query returns for one item: coffeelab.daily's is a lite shape. */
function reelsTabShape(item, user) {
  if (user !== 'coffeelab.daily') return item;
  const { taken_at: _t, caption: _c, user: u, ...rest } = item;
  return { ...rest, user: { pk: u.pk } };
}

// Feed posts carry what a real feed item does beyond the counts: the author's
// follower count, a collab, a paid partnership, hidden likes.
export const FEED = [
  {
    code: 'C9fRmXa1bQz', user: 'coffeelab.daily', kind: 'reel', views: 612_000, ageH: 50,
    extra: {
      caption: { text: 'The 3 mistakes everyone makes with cold brew ☕️ Save this for your next batch. #coldbrew #coffeetok #homebarista with @latte.lab' },
      coauthor_producers: [{ pk: '456', username: 'coffeelab.daily' }, { pk: '789', username: 'latte.lab' }],
      is_paid_partnership: true,
      sponsor_tags: [{ sponsor: { username: 'beanco.roasters' } }],
      reshare_count: 18_400,
      clips_metadata: clipsMetadata(1, 'coffeelab.daily'),
    },
  },
  { code: 'C8zImgOnly1', user: 'morning.ritual', kind: 'image', views: 0, ageH: 30 },
  { code: 'FAKE013', user: 'fakecreator', kind: 'reel' },
  {
    code: 'C7reelYzX90', user: 'latte.lab', kind: 'reel', views: 31_180, ageH: 90,
    extra: { like_and_view_counts_disabled: true, clips_metadata: clipsMetadata(0, 'latte.lab') },
  },
];

export function mediaByCode(code) {
  for (const list of Object.values(REELS)) {
    const hit = list.find((m) => m.code === code);
    if (hit) return hit;
  }
  const f = FEED.find((p) => p.code === code);
  if (!f) return null;
  const base = v1Item(code, 3, f.user, { views: f.views, ageH: f.ageH });
  const item = { ...base, ...f.extra, user: { ...base.user, follower_count: USERS[f.user]?.followers } };
  if (f.kind === 'image') return { ...item, media_type: 1, product_type: 'feed', play_count: undefined, ig_play_count: undefined, video_versions: undefined };
  return item;
}

function idToCode(id) {
  let n = BigInt(id);
  let o = '';
  while (n > 0n) {
    o = ALPHA[Number(n % 64n)] + o;
    n /= 64n;
  }
  return o;
}

function reelsPage(user, after) {
  const list = REELS[user] ?? [];
  const start = after ? Number(after) : 0;
  const slice = list.slice(start, start + PAGE);
  const end = start + slice.length;
  return {
    edges: slice.map((m) => ({ node: { media: reelsTabShape(m, user), __typename: 'XDTClipsItem' }, cursor: String(end) })),
    page_info: { end_cursor: end < list.length ? String(end) : null, has_next_page: end < list.length },
  };
}

function legacyNode(m) {
  return {
    __typename: 'GraphVideo',
    id: m.pk,
    shortcode: m.code,
    taken_at_timestamp: m.taken_at,
    is_video: true,
    video_view_count: m.play_count,
    edge_media_preview_like: { count: m.like_count },
    edge_media_to_comment: { count: m.comment_count },
    edge_media_to_caption: { edges: m.caption?.text ? [{ node: { text: m.caption.text } }] : [] },
    owner: { id: m.user.pk, username: m.user.username },
    display_url: m.image_versions2.candidates[0].url,
    dimensions: { width: 640, height: 1136 },
    video_duration: m.video_duration,
  };
}

function profileUser(user) {
  const u = USERS[user];
  if (!u) return null;
  if (user === 'fakecreator') {
    // Legacy graph shape, posts included (exercises normalisation + merging).
    return {
      id: u.pk,
      username: user,
      full_name: u.full_name,
      is_verified: false,
      edge_followed_by: { count: u.followers },
      edge_follow: { count: 311 },
      edge_owner_to_timeline_media: { count: 612, edges: REELS.fakecreator.slice(0, 12).map((m) => ({ node: legacyNode(m) })) },
    };
  }
  return { pk: u.pk, id: u.pk, username: user, full_name: u.full_name, follower_count: u.followers, is_verified: false };
}

const json = (body, status = 200) => ({ status, contentType: 'application/json; charset=utf-8', body: JSON.stringify(body) });

/**
 * Answer one fake API request, or null when the path isn't ours.
 * `body` is the raw request body (form-encoded for /graphql/query).
 */
export function handleApi({ method = 'GET', pathname, search = '', body = '' }) {
  if (pathname === '/graphql/query' || pathname === '/api/graphql') {
    const form = new URLSearchParams(method === 'GET' ? search : body);
    const doc = form.get('doc') ?? '';
    let vars = {};
    try {
      vars = JSON.parse(form.get('variables') ?? '{}');
    } catch {
      // ignore
    }
    if (doc === 'reels') return json({ data: { xdt_api__v1__clips__user__connection_v2: reelsPage(vars.username, vars.after) }, extensions: { is_final: true } });
    if (doc === 'profile') return json({ data: { user: profileUser(vars.username) }, status: 'ok' });
    if (doc === 'post') {
      const m = mediaByCode(vars.shortcode);
      return json({ data: { xdt_api__v1__media__shortcode__web_info: { items: m ? [{ ...m, __fixture: 'post' }] : [] } } });
    }
    if (doc === 'clips_home') {
      const items = (vars.codes ?? []).map(mediaByCode).filter(Boolean);
      return json({ data: { xdt_api__v1__clips__home__connection_v2: { edges: items.map((m) => ({ node: { media: { ...m, __fixture: 'clips_home' } } })) } } });
    }
    return json({ errors: [{ message: `unknown doc ${doc}` }] }, 400);
  }
  if (pathname === '/ajax/plain_reels') {
    const q = new URLSearchParams(search);
    const page = reelsPage('plain.tiles', q.get('after'));
    // A shape the hook never reads (and an endpoint it never watches).
    return json({ tiles: page.edges.map((e) => ({ c: e.node.media.code, v: e.node.media.play_count })), next: page.page_info.end_cursor });
  }
  let m;
  if ((m = pathname.match(/^\/fixture-thumb\/([\w-]+)\.svg$/))) {
    const h = [...m[1]].reduce((x, c) => (x * 31 + c.charCodeAt(0)) % 360, 7);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="90" height="160"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${h},45%,52%)"/><stop offset="1" stop-color="hsl(${(h + 50) % 360},50%,24%)"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/></svg>`;
    return { status: 200, contentType: 'image/svg+xml', body: svg };
  }
  if ((m = pathname.match(/^\/api\/v1\/media\/(\d+)\/info\/$/))) {
    const item = mediaByCode(idToCode(m[1]));
    return item ? json({ items: [{ ...item, __fixture: 'media-info' }] }) : json({ status: 'fail' }, 404);
  }
  if (pathname.startsWith('/api/')) return json({ status: 'fail', message: 'not in fixture' }, 404);
  return null;
}

const blob = (attr, data) =>
  `<script type="application/json" data-content-len="${JSON.stringify(data).length}" ${attr}>${JSON.stringify(data).replace(/</g, '\\u003c')}</script>`;

/** Server-rendered JSON blobs for a first page load of `pathname`. */
export function ssrBlobs(pathname) {
  const segs = pathname.split('/').filter(Boolean);
  const wrap = (name, data) => ({
    require: [['ScheduledServerJS', 'handle', null, [{ __bbox: { require: [['RelayPrefetchedStreamCache', 'next', [], [name, { __bbox: { complete: true, result: { data } } }]]] } }]]],
  });
  if (segs.length === 0) {
    const items = FEED.map((p) => ({ ...mediaByCode(p.code), __fixture: 'ssr-feed' }));
    return blob('data-sjs', wrap('adp_PolarisFeedRootQuery', { xdt_api__v1__feed__timeline__connection: { edges: items.map((media) => ({ node: { media } })) } }));
  }
  if (segs.length === 2 && segs[1] === 'reels' && REELS[segs[0]] && segs[0] !== 'plain.tiles') {
    const data = { xdt_api__v1__clips__user__connection_v2: reelsPage(segs[0], null) };
    return blob(`data-sjs data-fixture-reels="${segs[0]}"`, wrap('adp_PolarisProfileReelsTabContentQuery', data));
  }
  return '';
}
