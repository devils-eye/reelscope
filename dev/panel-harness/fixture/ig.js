// A small fake of Instagram's web app, for testing the in-page UI without
// logging in. It mimics only what the content script keys off: aria-labelled
// action icons, post/reel links, <video>, <article>, role="dialog",
// `main header`, the profile grid, SPA navigation via history.pushState, and
// Instagram's theme classes on <html>. Class names are deliberately
// meaningless, like Instagram's.
//
// Routes: /  (feed)   /reels/<code>/   /<user>/  /<user>/reels/   /p/<code>/
// Theme:  ?theme=dark|light (sticky via sessionStorage).
// Video:  ?vsrc=<mp4 url> gives every <video> a real, looping source (sticky),
//         e.g. ?vsrc=http://127.0.0.1:8788/api/videos/<shortcode>
//
// Data arrives the way Instagram's does (fixture/api.js serves it): the
// reels tab pages in 12 at a time over fetch('/graphql/query') as you scroll
// (first page from an SSR JSON blob on a direct load), the profile header's
// user over XHR, the post modal and reels viewer over fetch. plain.tiles
// loads from an endpoint the extension's hook ignores (grid-only fallback).
(() => {
  const USER = 'fakecreator';
  const q = new URLSearchParams(location.search);
  if (q.get('theme')) sessionStorage.setItem('ig-theme', q.get('theme'));
  if (q.get('vsrc')) sessionStorage.setItem('ig-vsrc', q.get('vsrc'));
  const VSRC = sessionStorage.getItem('ig-vsrc');
  const theme = sessionStorage.getItem('ig-theme') || 'light';
  document.documentElement.classList.add(theme === 'dark' ? '__fb-dark-mode' : '__fb-light-mode');

  const css = `
    :root { --bg:#fff; --fg:#000; --sec:#737373; --line:#dbdbdb; --tile:#efefef; }
    html.__fb-dark-mode { --bg:#000; --fg:#f5f5f5; --sec:#a8a8a8; --line:#262626; --tile:#121212; }
    * { box-sizing: border-box; }
    body { margin:0; background:var(--bg); color:var(--fg); font:14px/18px -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
    a { color:inherit; text-decoration:none; }
    .x1 { position:fixed; left:0; top:0; bottom:0; width:244px; border-right:1px solid var(--line); padding:28px 16px; }
    .x1 b { display:block; font:600 24px/1 'Billabong', cursive, serif; margin:0 12px 34px; font-style:italic; }
    .x1 a { display:block; padding:12px; border-radius:8px; font-size:15px; }
    .x1 a:hover { background:rgba(127,127,127,.12); }
    .x2 { margin-left:244px; min-height:100vh; }
    .x3 { width:470px; margin:0 auto; padding:24px 0 80px; }
    .x4 { display:flex; gap:14px; padding:8px 0 24px; }
    .x4 i { width:66px; height:66px; border-radius:50%; background:conic-gradient(#f9ce34,#ee2a7b,#6228d7,#f9ce34); padding:3px; display:block; }
    article.x5 { border-bottom:1px solid var(--line); padding-bottom:16px; margin-bottom:20px; }
    .x6 { display:flex; align-items:center; gap:10px; padding:0 0 10px; }
    .x6 i, .x9 i { width:32px; height:32px; border-radius:50%; background:linear-gradient(135deg,#ccc,#888); display:block; }
    .x6 .x7 { color:var(--sec); }
    .xvw { position:relative; }
    /* Like Instagram: the <video> sits in its own stacking layer and a clear
       full-size layer above it takes the clicks. */
    .xmed { position:relative; z-index:0; }
    .xvw .xov, .xjo { position:absolute; inset:0; cursor:pointer; z-index:1; }
    .xmute { position:absolute; right:12px; bottom:12px; width:28px; height:28px; border-radius:50%; background:rgba(38,38,38,.8); color:#fff; display:grid; place-items:center; font-size:12px; cursor:pointer; z-index:2; border:0; padding:0; }
    .x8 { width:100%; aspect-ratio:4/5; border-radius:4px; border:1px solid var(--line); display:block; object-fit:cover; background:#111; }
    section.xa { display:flex; align-items:center; justify-content:space-between; height:46px; }
    .xb { display:flex; align-items:center; }
    .xb > span { display:inline-flex; padding:8px; }
    [role=button] { cursor:pointer; display:flex; }
    svg.xc { width:24px; height:24px; fill:none; stroke:currentColor; stroke-width:2; }
    .xd { font-weight:600; }
    .xe { color:var(--sec); margin-top:6px; }
    .xg { position:fixed; right:20px; bottom:20px; display:flex; align-items:center; gap:10px; padding:0 18px; height:52px; border-radius:26px; background:var(--bg); box-shadow:0 4px 12px rgba(0,0,0,.15); border:1px solid var(--line); font-weight:600; z-index:10; }
    /* reels viewer */
    .xh { height:100vh; overflow-y:scroll; scroll-snap-type:y mandatory; }
    .xi { height:100vh; scroll-snap-align:start; display:flex; align-items:flex-end; justify-content:center; gap:16px; padding:24px 0; }
    .xj { height:calc(100vh - 48px); aspect-ratio:9/16; border-radius:8px; background:#111; position:relative; overflow:hidden; }
    .xj video { width:100%; height:100%; object-fit:cover; display:block; }
    .xk { display:flex; flex-direction:column; align-items:center; gap:4px; padding-bottom:8px; }
    .xk > div { display:flex; flex-direction:column; align-items:center; gap:2px; padding:8px 0; font-size:12px; }
    .xl { position:absolute; left:16px; bottom:16px; color:#fff; text-shadow:0 1px 3px rgba(0,0,0,.6); z-index:2; }
    /* profile */
    .xm { max-width:935px; margin:0 auto; padding:30px 20px 60px; display:flex; flex-direction:column; }
    header.xn { display:flex; gap:80px; align-items:center; margin:0 0 44px; padding:0 40px; }
    header.xn i { width:150px; height:150px; border-radius:50%; background:linear-gradient(135deg,#d9a35c,#6b3f1f); display:block; flex:none; }
    .xo { display:flex; flex-direction:column; gap:18px; }
    .xo h2 { margin:0; font-size:20px; font-weight:400; }
    .xo ul { display:flex; gap:40px; list-style:none; margin:0; padding:0; font-size:16px; }
    .xp { display:flex; gap:40px; padding:0 40px 44px; }
    .xp i { width:77px; height:77px; border-radius:50%; border:1px solid var(--line); background:var(--tile); display:block; }
    .xq { display:flex; justify-content:center; gap:60px; border-top:1px solid var(--line); font:600 12px/52px sans-serif; letter-spacing:1px; text-transform:uppercase; color:var(--sec); }
    .xq a[aria-selected=true] { color:var(--fg); border-top:1px solid var(--fg); margin-top:-1px; }
    .xr { display:flex; flex-direction:column; gap:4px; }
    .xs { display:flex; gap:4px; }
    .xs > a { flex:1; display:block; }
    .xt { position:relative; aspect-ratio:3/4; overflow:hidden; background:var(--tile); }
    .xt img { width:100%; height:100%; object-fit:cover; display:block; }
    .xu { position:absolute; top:8px; right:8px; color:#fff; }
    .xv { position:absolute; left:8px; bottom:8px; color:#fff; font-weight:600; display:flex; gap:4px; align-items:center; text-shadow:0 1px 2px rgba(0,0,0,.5); }
    .xpin { position:absolute; top:8px; left:8px; color:#fff; }
    .xr.xg3 { display:grid; grid-template-columns:repeat(3, 1fr); gap:4px; }
    .xspin { display:flex; justify-content:center; padding:28px 0; }
    .xspin i { width:22px; height:22px; border-radius:50%; border:2px solid var(--line); border-top-color:var(--sec); animation:xrot .7s linear infinite; }
    @keyframes xrot { to { transform:rotate(360deg); } }
    /* modal */
    .xw { position:fixed; inset:0; background:rgba(0,0,0,.65); z-index:50; display:flex; align-items:center; justify-content:center; }
    .xw article { display:flex; width:min(1100px, calc(100vw - 120px)); height:min(780px, calc(100vh - 60px)); background:var(--bg); border-radius:4px; overflow:hidden; }
    /* Like Instagram's modal: the 9:16 video is taller than its frame and cropped,
       under a full-frame layer that carries (visually hidden) text. */
    .xx { flex:1; background:#000; position:relative; overflow:hidden; }
    .xx video { position:absolute; left:0; top:50%; width:100%; aspect-ratio:9/16; transform:translateY(-50%); object-fit:cover; }
    .xx .xxa { position:absolute; inset:0; z-index:1; }
    .xx .xmed { position:absolute; inset:0; }
    .xx .xxa span { position:absolute; left:0; top:0; bottom:0; width:40%; opacity:0; }
    .xy { width:405px; flex:none; display:flex; flex-direction:column; border-left:1px solid var(--line); }
    .xy > .x6 { padding:14px 16px; border-bottom:1px solid var(--line); margin:0; }
    .xz { flex:1; overflow:auto; padding:16px; list-style:none; margin:0; display:flex; flex-direction:column; gap:16px; }
    .xz li { display:flex; gap:12px; align-items:flex-start; }
    .xz li p { flex:1; margin:0; }
    .xz svg { width:12px; height:12px; fill:none; stroke:currentColor; }
    .xy section.xa { padding:0 8px; border-top:1px solid var(--line); }
    .xy .xf { padding:0 16px 16px; }
    .xclose { position:fixed; top:16px; right:22px; color:#fff; font-size:28px; cursor:pointer; z-index:51; }
  `;
  const style = document.createElement('style');
  style.textContent = css;
  document.head.append(style);

  const ICON = {
    Like: '<path d="M16.8 3.5c-2 0-3.5 1-4.8 2.8C10.7 4.5 9.2 3.5 7.2 3.5 4.2 3.5 2 5.9 2 8.9c0 5.4 7.6 10.4 10 11.6 2.4-1.2 10-6.2 10-11.6 0-3-2.2-5.4-5.2-5.4z"/>',
    Comment: '<path d="M20.7 16.7A9.5 9.5 0 1 0 17.3 20l3.7 1-1-3.6z"/>',
    'Share Post': '<path d="M22 3 9.2 10.1M22 3l-7 18-3.8-8.3L3 9.6z"/>',
    Share: '<path d="M22 3 9.2 10.1M22 3l-7 18-3.8-8.3L3 9.6z"/>',
    Save: '<path d="M20 21l-8-7.6L4 21V3h16z"/>',
    More: '<circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/>',
    Clip: '<path d="M3 3h18v18H3zM3 8h18M8 3l3 5M14 3l3 5M10 12v6l5-3z"/>',
  };
  const svg = (label, cls = 'xc') => `<svg aria-label="${label}" class="${cls}" viewBox="0 0 24 24" role="img"><title>${label}</title>${ICON[label] ?? ''}</svg>`;
  const btn = (label) => `<div role="button" tabindex="0">${svg(label)}</div>`;
  const hue = (s) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);
  const poster = (code, w = 360, h = 480) => {
    const a = hue(code);
    const b = (a + 50) % 360;
    return 'data:image/svg+xml;utf8,' + encodeURIComponent(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${a},45%,52%)"/><stop offset="1" stop-color="hsl(${b},50%,24%)"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/><circle cx="${w * 0.7}" cy="${h * 0.32}" r="${w * 0.18}" fill="hsla(${b},60%,80%,.35)"/></svg>`,
    );
  };
  const video = (code, cls = 'x8') =>
    `<video class="${cls}" muted playsinline loop ${VSRC ? `autoplay src="${VSRC}"` : ''} poster="${poster(code)}"></video>`;
  // Like Instagram: the feed video sits under a full-size overlay and a small
  // mute button. Since Oct 2026 (desktop "immersive" posts) the whole media is
  // inside a plain inline link to /reels/<code>/ whose click opens the viewer;
  // the overlay is role="presentation" and does nothing, and the sound button
  // is a real <button> that the link's handler skips. A `classic` post keeps
  // the older card, where the overlay itself opens the viewer.
  const mute = `<div class="xmute" role="button" aria-label="Toggle audio" tabindex="0">🔇</div>`;
  const feedVideo = (code, classic) =>
    classic
      ? `<div class="xvw"><div class="xmed">${video(code)}</div><div class="xov" data-open="${code}"></div>${mute}</div>`
      : `<a href="/reels/${code}/" role="link" tabindex="0" data-immersive="${code}"><div class="xvw"><div class="xmed">${video(code)}</div><div class="xov" role="presentation"></div><button class="xmute" type="button" aria-label="Toggle audio">🔇</button></div></a>`;

  const actionRow = (shareLabel = 'Share Post') => `
    <section class="xa">
      <div class="xb">
        <span>${btn('Like')}</span>
        <span>${btn('Comment')}</span>
        <span>${btn(shareLabel)}</span>
      </div>
      <div>${btn('Save')}</div>
    </section>`;

  const FEED = [
    { code: 'C9fRmXa1bQz', user: 'coffeelab.daily', kind: 'reel', likes: '48.2K', cap: 'The 3 mistakes everyone makes with cold brew' },
    { code: 'C8zImgOnly1', user: 'morning.ritual', kind: 'image', likes: '1,204', cap: 'Sunday light' },
    { code: 'FAKE013', user: USER, kind: 'reel', likes: '12.9K', cap: "I tested every grinder under $100 so you don't have to" },
    { code: 'C7reelYzX90', user: 'latte.lab', kind: 'reel', likes: '3,118', cap: "Why your latte art keeps failing (it's not the milk)", classic: true },
  ];

  const feedPost = (p) => `
    <article class="x5">
      <div class="x6"><i></i><a href="/${p.user}/" class="xd">${p.user}</a>
        <span class="x7">• <a href="/${p.kind === 'reel' ? 'reel' : 'p'}/${p.code}/"><time datetime="2026-10-18">2d</time></a></span></div>
      ${p.kind === 'reel' ? feedVideo(p.code, p.classic) : `<img class="x8" alt="" src="${poster(p.code)}">`}
      ${actionRow()}
      <div class="xd">${p.likes} likes</div>
      <div><a href="/${p.user}/" class="xd">${p.user}</a> ${p.cap}</div>
      <a class="xe" href="/p/${p.code}/comments/">View all 214 comments</a>
    </article>`;

  const nav = () => `
    <nav class="x1"><b>Instagram</b>
      <a href="/">Home</a><a href="/reels/C9fRmXa1bQz/">Reels</a>
      <a href="/${USER}/">Profile (${USER})</a><a href="/coffeelab.daily/">Profile (coffeelab.daily)</a>
    </nav>
    <div class="xg">Messages</div>`;

  const REELS = ['C9fRmXa1bQz', 'C7reelYzX90', 'FAKE013'];
  const reelsViewer = () => `
    <main class="x2"><div class="xh">${REELS.map((code, i) => `
      <div class="xi" data-code="${code}">
        <div class="xj"><div class="xmed" style="height:100%">${video(code, '')}</div><div class="xjo"></div>${mute}<div class="xl"><a href="/${i === 2 ? USER : 'latte.lab'}/" class="xd">${i === 2 ? USER : 'latte.lab'}</a><br>Original audio · <a href="/reels/audio/1234567${i}/">audio</a></div></div>
        <div class="xk">
          <div>${btn('Like')}<span>${['48.2K', '3,118', '12.9K'][i]}</span></div>
          <div>${btn('Comment')}<span>${['214', '41', '96'][i]}</span></div>
          <div>${btn('Share')}</div>
          <div>${btn('Save')}</div>
          <div>${btn('More')}</div>
        </div>
      </div>`).join('')}</div></main>`;

  const GRID_N = 24;
  const FOLLOWERS = { fakecreator: '184K', 'coffeelab.daily': '52.3K', 'plain.tiles': '12.4K' };
  const fmtViews = (n) => (n < 10000 ? n.toLocaleString('en-US') : n < 1e6 ? `${(n / 1e3).toFixed(1).replace(/\.0$/, '')}K` : `${(n / 1e6).toFixed(1).replace(/\.0$/, '')}M`);
  const PIN = '<svg aria-label="Pinned post icon" class="xc" viewBox="0 0 24 24" role="img"><path d="M9 3h6l-1 6 4 4H6l4-4zM12 13v8"/></svg>';
  const tile = (user, code, views, pinned) =>
    `<a href="/${user}/reel/${code}/" role="link"><div class="xt"><img alt="" src="${poster(code, 300, 400)}"><span class="xu">${svg('Clip', 'xc')}</span>${pinned ? `<span class="xpin">${PIN}</span>` : ''}${views != null ? `<span class="xv">▶ ${fmtViews(views)}</span>` : ''}</div></a>`;
  const profile = (user, tab) => {
    // Posts tab: a static grid (no view counts, like Instagram's).
    const tiles = tab === 'reels' ? [] : Array.from({ length: GRID_N }, (_, i) => {
      const code = user === USER ? `FAKE${String(i).padStart(3, '0')}` : `CX${user.length}${String(i).padStart(6, '0')}x`;
      return tile(user, code, null, false);
    });
    const rows = [];
    for (let i = 0; i < tiles.length; i += 3) rows.push(`<div class="xs">${tiles.slice(i, i + 3).join('')}</div>`);
    return `
      <main class="x2"><div class="xm">
        <header class="xn"><i></i><section class="xo">
          <h2>${user}</h2>
          <ul><li><b>612</b> posts</li><li><a href="/${user}/followers/"><b>${FOLLOWERS[user] ?? '184K'}</b> followers</a></li><li><b>311</b> following</li></ul>
          <div><b>${user === USER ? 'Fake Creator · Coffee Lab' : user}</b><br>Coffee experiments, three times a week.</div>
        </section></header>
        <div class="xp"><i></i><i></i><i></i><i></i></div>
        <div class="xq" role="tablist"><a href="/${user}/" aria-selected="${tab !== 'reels'}">Posts</a><a href="/${user}/reels/" aria-selected="${tab === 'reels'}">Reels</a><a href="/${user}/tagged/">Tagged</a></div>
        <div class="xr${tab === 'reels' ? ' xg3' : ''}">${rows.join('')}</div>
        <div class="xspin" hidden aria-label="Loading..." role="progressbar"><i></i></div>
      </div></main>`;
  };

  // ---- data over the network, like Instagram ---------------------------------
  const gql = (doc, variables) =>
    fetch('/graphql/query', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ doc, variables: JSON.stringify(variables) }).toString(),
    }).then((r) => r.json());

  let reelsTab = null; // { user, after, more, loading, gen }
  let gen = 0;
  let firstRender = true;

  function appendTiles(user, items) {
    const grid = app.querySelector('.xr');
    if (!grid) return;
    grid.insertAdjacentHTML('beforeend', items.map((m) => tile(user, m.code, m.views, m.pinned)).join(''));
  }

  function loadReels() {
    const st = reelsTab;
    if (!st || st.loading || !st.more) return;
    st.loading = true;
    const spin = app.querySelector('.xspin');
    if (spin) spin.hidden = false;
    const done = (items, next) => {
      if (st.gen !== gen) return;
      st.loading = false;
      st.after = next;
      st.more = !!next;
      if (spin) spin.hidden = true;
      appendTiles(st.user, items);
    };
    const fail = () => {
      st.loading = false;
      if (spin) spin.hidden = true;
    };
    if (st.user === 'plain.tiles') {
      fetch(`/ajax/plain_reels?after=${st.after ?? ''}`).then((r) => r.json()).then((b) => done(b.tiles.map((t) => ({ code: t.c, views: t.v })), b.next), fail);
      return;
    }
    gql('reels', { username: st.user, after: st.after, first: 12 }).then((b) => {
      const conn = b.data.xdt_api__v1__clips__user__connection_v2;
      const items = conn.edges.map((e) => ({ code: e.node.media.code, views: e.node.media.play_count, pinned: (e.node.media.clips_tab_pinned_user_ids ?? []).length > 0 }));
      done(items, conn.page_info.has_next_page ? conn.page_info.end_cursor : null);
    }, fail);
  }

  function startReelsTab(user) {
    reelsTab = { user, after: null, more: true, loading: false, gen };
    // Direct load: the first page is already in the HTML.
    const ssr = firstRender && document.querySelector(`script[type="application/json"][data-fixture-reels="${user}"]`);
    if (ssr) {
      const conn = JSON.parse(ssr.textContent).require[0][3][0].__bbox.require[0][3][1].__bbox.result.data.xdt_api__v1__clips__user__connection_v2;
      appendTiles(user, conn.edges.map((e) => ({ code: e.node.media.code, views: e.node.media.play_count, pinned: (e.node.media.clips_tab_pinned_user_ids ?? []).length > 0 })));
      reelsTab.after = conn.page_info.end_cursor;
      reelsTab.more = conn.page_info.has_next_page;
      return;
    }
    loadReels();
  }

  function loadProfileUser(user) {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/graphql/query');
    xhr.setRequestHeader('content-type', 'application/x-www-form-urlencoded');
    xhr.send(new URLSearchParams({ doc: 'profile', variables: JSON.stringify({ username: user }) }).toString());
  }

  window.addEventListener('scroll', () => {
    if (window.scrollY + window.innerHeight < document.documentElement.scrollHeight - 800) return;
    if (reelsTab) loadReels();
  }, { passive: true });

  const COMMENTS = ['this is so useful', 'the grinder at 0:40??', 'saving this', 'tried it, works'];
  const postBody = (code, user) => `
    <article>
      <div class="xx"><div class="xmed">${video(code, '')}</div><div class="xxa"><span>Video by ${user}. Tap to play or pause.</span></div></div>
      <div class="xy">
        <div class="x6"><i></i><a class="xd" href="/${user}/">${user}</a></div>
        <ul class="xz">${COMMENTS.map((c, i) => `<li><i></i><p><a class="xd" href="/fan${i}/">fan${i}</a> ${c}</p><div role="button">${svg('Like', '')}</div></li>`).join('')}</ul>
        ${actionRow('Share')}
        <div class="xf"><div class="xd">12,902 likes</div><a href="/p/${code}/"><time datetime="2026-10-18">2 days ago</time></a></div>
      </div>
    </article>`;

  let modalOpen = false;
  const app = document.createElement('div');
  app.id = 'mount_0_0_x';
  document.body.prepend(app);

  function render() {
    const path = location.pathname;
    const segs = path.split('/').filter(Boolean);
    document.querySelector('.xw')?.remove();
    document.querySelector('.xclose')?.remove();
    if (modalOpen && segs[0] === 'p') {
      // Post modal over the profile that opened it (the profile stays mounted).
      const w = document.createElement('div');
      w.className = 'xw';
      w.setAttribute('role', 'dialog');
      w.innerHTML = postBody(segs[1], USER);
      gql('post', { shortcode: segs[1] }).catch(() => {});
      const x = document.createElement('div');
      x.className = 'xclose';
      x.textContent = '×';
      x.onclick = () => history.back();
      w.onclick = (e) => e.target === w && history.back();
      document.body.append(w, x);
      return;
    }
    modalOpen = false;
    gen++;
    reelsTab = null;
    let html;
    if (segs.length === 0) html = `<main class="x2"><div class="x3"><div class="x4">${'<i></i>'.repeat(6)}</div>${FEED.map(feedPost).join('')}</div></main>`;
    else if (segs[0] === 'reels' && segs[1]) html = reelsViewer();
    else if (segs[0] === 'p' || segs[0] === 'reel') html = `<main class="x2"><div class="xm" style="max-width:1100px">${postBody(segs[1], USER)}</div></main>`;
    else html = profile(segs[0], segs[1]);
    app.innerHTML = nav() + html;
    const isProfile = segs.length >= 1 && !['reels', 'p', 'reel'].includes(segs[0]);
    if (isProfile) {
      loadProfileUser(segs[0]);
      if (segs[1] === 'reels') startReelsTab(segs[0]);
    }
    if (segs[0] === 'reels' && segs[1]) gql('clips_home', { codes: REELS }).catch(() => {});
    if ((segs[0] === 'p' || segs[0] === 'reel') && segs[1]) gql('post', { shortcode: segs[1] }).catch(() => {});
    firstRender = false;
    if (segs[0] === 'reels') {
      const box = app.querySelector('.xh');
      const start = box.querySelector(`[data-code="${segs[1]}"]`);
      if (start) box.scrollTop = start.offsetTop;
      // Like Instagram, the URL follows the reel in view.
      const io = new IntersectionObserver((es) => {
        for (const e of es) if (e.isIntersecting && e.intersectionRatio > 0.6) history.replaceState(null, '', `/reels/${e.target.dataset.code}/`);
      }, { root: box, threshold: [0.6] });
      box.querySelectorAll('.xi').forEach((el) => io.observe(el));
    }
  }

  // SPA navigation, like Instagram's router.
  document.addEventListener('click', (e) => {
    const mt = e.target.closest?.('.xmute');
    if (mt) {
      const v = mt.parentElement.querySelector('video');
      v.muted = !v.muted;
      mt.textContent = v.muted ? '🔇' : '🔊';
      // Inside the immersive link: Instagram keeps a button's click from following it.
      e.preventDefault();
      return;
    }
    const ov = e.target.closest?.('[data-open]');
    if (ov) {
      history.pushState(null, '', `/reels/${ov.dataset.open}/`);
      render();
      return;
    }
    const im = e.target.closest?.('[data-immersive]');
    if (im) {
      e.preventDefault();
      history.pushState(null, '', `/reels/${im.dataset.immersive}/`);
      render();
      return;
    }
    const rv = e.target.closest?.('.xjo')?.parentElement.querySelector('video');
    if (rv) return void (rv.paused ? rv.play() : rv.pause());
    const a = e.target.closest?.('a[href^="/"]');
    if (!a || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey) return;
    e.preventDefault();
    const href = a.getAttribute('href');
    const m = href.match(/^\/[^/]+\/(?:reel|p)\/([^/]+)\//);
    if (m && /^\/[^/]+\/(reels\/)?$/.test(location.pathname)) {
      modalOpen = true;
      history.pushState({ modal: true }, '', `/p/${m[1]}/`);
    } else {
      history.pushState(null, '', href);
    }
    render();
  });
  window.addEventListener('popstate', (e) => {
    const wasModal = modalOpen;
    modalOpen = !!e.state?.modal;
    // Closing a modal leaves the profile underneath mounted, like Instagram.
    if (wasModal && !modalOpen && !/^\/(p|reel)\//.test(location.pathname)) {
      document.querySelector('.xw')?.remove();
      document.querySelector('.xclose')?.remove();
      return;
    }
    render();
  });
  window.addEventListener('keydown', (e) => e.key === 'Escape' && modalOpen && history.back());
  window.__igRender = render;
  render();
})();
