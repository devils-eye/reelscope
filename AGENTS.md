# AGENTS.md — ReelScope

## What this is

A local-first tool for finding outperforming short-form videos. A browser
extension (WXT + SolidJS + TypeScript, Chrome MV3 and Firefox MV2) scans
Instagram profiles and YouTube channels, scores each reel / Short / video
against the creator's own median views, and saves the interesting ones to a
Bun + SQLite server on `localhost:8788`. The library page shows what was
saved and scanned.

## Commands

```sh
bun install
bun run server         # server on :8788, DB at data/reelscope.db (DB_PATH overrides)
bun run build          # Chrome build  -> .output/chrome-mv3
bun run build:firefox  # Firefox build -> .output/firefox-mv2
bun run compile        # tsc --noEmit
bun test               # unit tests (lib/*.test.ts)
bun run harness        # in-page UI on a fake Instagram, http://localhost:5199/
```

Use `bun` only. After a change, run `compile`, `test`, and both builds.

## How it works

- **Instagram capture is passive.** `entrypoints/ig-hook.content.ts` runs
  `lib/pageHook.ts` in the page's own JS world: it reads the responses
  Instagram's app already receives (fetch, XHR, SSR JSON blobs) and posts the
  media items and users to the content script (`lib/igCapture.ts` extracts
  and validates them, `lib/captureStore.ts` keeps them). Scans scroll the
  reels tab like a person would (`entrypoints/content/reelScan.ts`); only a
  save of a reel the page never loaded makes one rate-limited request
  (`lib/capture.ts`).
- **YouTube runs on the server.** A save sends only the video id; the server
  asks yt-dlp for the numbers (`lib/ytdlp.ts` I/O, `lib/youtube.ts` pure
  mapping) and downloads the video (H.264 up to 720p, ffmpeg stream copy).
  A channel scan is a server job (`POST /api/youtube/scans`, poll, `DELETE`
  to stop): it lists the Shorts or Videos tab, looks up a dozen videos for
  exact numbers and dates, and interpolates the rest. Shorts and long videos
  are scored apart (`ScanFormat` 'short' | 'long').
- **Scoring** (`lib/outliers.ts`): baseline = median views of reels older than
  72 hours; multiple = views / baseline; tiers by multiple (outlier at the
  threshold, default 2x). A time-window scan reads the whole channel and
  scores the window against all of it. Every scan reads from scratch.
- **Saving** goes content script → background worker (`entrypoints/background.ts`,
  `lib/sync.ts`) → `POST /api/reels`. Offline saves queue in
  `browser.storage` and retry every 5 minutes.

## Stats card and metrics

Every post has a **Stats** button beside Save (Alt+N for the post in view;
not Alt+D, which browsers keep for the address bar). It opens a card with
what the site hides: exact counts, engagement, like rate, comments and shares
per 1K views, comment:like, views per follower, views per hour/day, caption
stats, extras (Instagram: audio, collab, paid partnership, hidden likes;
YouTube: category, tags, chapters, quality, live flags), and **Vs this
creator** against their latest scan (live `ProfileStore`, else the stored
one): multiple, tier, rank, baseline, engagement vs their median.

- `lib/metrics.ts` (pure, `lib/metrics.test.ts`): `computeMetrics`,
  `compareToScan` (scores with `scoreViews` from `lib/outliers.ts`, the same
  tier rules as a scan), `snapshotGrowth`, and the mappers from each source:
  `detailsFromIgItem` (a captured media item), `detailsFromYtInfo`,
  `detailsFromRow` (a saved library row + its raw JSON), `postFromScanned`.
- Data: `PanelDeps.postStats`. Instagram (`content/postStats.ts`): the item
  the page loaded, else one gated `/media/info` request. YouTube: background
  message `ytInfo` → `GET /api/youtube/info/:id` (yt-dlp, trimmed by
  `lib/youtube.ts` `infoSummary`, cached 10 minutes; 422 gone, 503 retry).
- UI: the button is in `InlineSave.tsx`; the open card is `statsState.ts`
  (shared by both runtimes) and renders in the body-level overlay
  (`StatsCard.tsx`, `stats.css`), placed against the button and kept in the
  viewport. Grid badges (`GridBadge.tsx`) expand on tile hover: the runtime
  mirrors the tile's hover onto the badge host as `data-hover`
  (`hosts.tsx` `hoverTarget`), so the badge never takes the click.
- Library: `ReelSheet.tsx` **Performance** (rates as of the latest save,
  growth between the first and latest snapshot from `GET /api/reels/:shortcode`).

## Where things live

- `entrypoints/content/` — in-page UI shared by both sites: `runtime.tsx`
  (Instagram) and `ytRuntime.tsx` (YouTube) inject a small shadow root per
  post (`InlineSave.tsx`, the Save button; its `.rs-pair` wrapper is where
  more per-post controls go), per grid tile (`GridBadge.tsx`) and under the
  profile header (`ProfileStrip.tsx`). `ContentApp.tsx` holds the body-level
  overlay: toast, scan pill, side panel (`ProfilePanel.tsx`, `ScanChart.tsx`,
  `PostingChart.tsx`), outliers rail, lightbox, and the YouTube outliers grid.
  `profileStore.ts` is one creator's scan state; `saves.ts` the shared save
  state; `site.ts` every word that differs between sites; `panel-deps.ts` the
  side-effect interface (real: `deps.ts`, `ytDeps.ts`; fake: the harness).
- `entrypoints/library/` — options page: Reels (filters by status, creator,
  site, multiple; `ReelSheet.tsx` with the saved video and notes) and Creators.
- `entrypoints/popup/` — server status, queued saves, latest saves.
- `server/index.ts` + `server/schema.sql` — tables `reels`, `snapshots`
  (one per save), `profile_scans`, view `reel_latest`. Thumbnails and videos
  are cached under `data/thumbs/` and `data/videos/` at save time.
- `lib/` — shared logic; everything pure has a `*.test.ts` next to it.
- `dev/panel-harness/` — dev-only fake Instagram for UI work. Its fixture
  items (`fixture/api.js`) carry the real field names the stats card reads
  (reshare_count, clips_metadata, coauthor_producers, is_paid_partnership,
  like_and_view_counts_disabled, user.follower_count).

## API (localhost:8788)

`GET /api/health`, `GET /api/summary`, `POST /api/reels`, `GET /api/reels`
(`limit`, `sort`, `status`, `q`, `author`, `platform`), `GET|PATCH
/api/reels/:shortcode` (notes, tags, status), `GET /api/reels/exists?codes=`,
`GET /api/thumbs/:shortcode`, `GET /api/videos/:shortcode` (Range),
`GET /api/profiles`, `POST /api/profiles/scans`, `GET /api/profiles/:username`
(`platform`, `format`), `POST /api/youtube/scans`, `GET|DELETE
/api/youtube/scans/:id`, `GET /api/youtube/info/:id` (one video's numbers for
the stats card).

## Rules

- Never delete `data/` (the library). Temp files go under `/tmp/rs-*`.
- Instagram is never called directly except the single rate-limited
  `/media/info` fallback in `lib/capture.ts`; never page its API.
- Keep `lib/` modules pure where they are now, with tests.
