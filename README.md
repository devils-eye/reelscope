# ReelScope

A browser extension and a small local server for studying short-form video
performance. On an Instagram profile or a YouTube channel, ReelScope scans the
creator's recent reels, Shorts or videos, scores each one against that
creator's own median views, and marks the outliers. Anything worth keeping is
saved, with its stats and a copy of the video, to a local SQLite library.

## Setup

1. Install [Bun](https://bun.sh) (1.3 or newer).
2. For YouTube, install [yt-dlp](https://github.com/yt-dlp/yt-dlp) and
   [ffmpeg](https://ffmpeg.org) so both are on your `PATH`. Instagram works
   without them.
3. Install dependencies and start the server:

   ```sh
   bun install
   bun run server        # http://localhost:8788, database in data/reelscope.db
   ```

4. Build the extension and load it:

   ```sh
   bun run build         # Chrome / Edge / Brave -> .output/chrome-mv3
   bun run build:firefox # Firefox               -> .output/firefox-mv2
   ```

   - Chrome: open `chrome://extensions`, turn on Developer mode, click
     **Load unpacked** and pick `.output/chrome-mv3`.
   - Firefox: open `about:debugging#/runtime/this-firefox`, click
     **Load Temporary Add-on** and pick `.output/firefox-mv2/manifest.json`.

## Using it

- **Scan a creator:** open an Instagram profile or a YouTube channel. A strip
  under the header offers a scan (last 36 / 72 / 150 / all, or a time window).
  Tiles get a multiple badge; **Full analysis** opens a side panel with the
  chart, posting rhythm and every scored reel.
- **Save:** every video post has a **Save** button next to its actions
  (Alt+S saves the one in view).
- **Stats:** the **Stats** button beside Save (Alt+N) opens the numbers the
  site hides: exact counts, engagement and comment rates, views per follower
  and per day, audio, collab and format details, and how the post compares
  with the creator's scan. Hovering a scored grid tile shows its numbers too. **Save all outliers** saves a scan in bulk;
  its arrow also offers every scanned reel.
- **Library:** the extension's options page (or **Open library** in the
  toolbar popup) lists saved reels with filters, a detail sheet with the saved
  video, notes, rates and growth between saves, and every scanned creator.

If the server is offline, saves are queued in the extension and sent once it
is back.

## Development

```sh
bun run dev           # extension with live reload (Chrome)
bun run compile       # typecheck
bun test              # unit tests
bun run harness       # the in-page UI on a fake Instagram: http://localhost:5199/
```

`DB_PATH`, `THUMBS_DIR`, `VIDEOS_DIR`, `PORT`, `YTDLP` and `FFMPEG` override
the server's defaults.
