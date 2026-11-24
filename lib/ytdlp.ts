// YouTube, I/O part: everything the server (server/index.ts) asks of yt-dlp:
// one video's full info, downloads, and channel listings for scans.
// Pure mapping of its JSON lives in lib/youtube.ts.
//
// Requests come from this machine, signed out: nothing touches anyone's
// YouTube account. yt-dlp solves YouTube's JS challenge with an external
// JavaScript runtime; it is pointed at the bun running us, so deno or node
// need not be installed. Downloads merge with ffmpeg stream copy (no decode
// or encode), so they are quick and light.
import { existsSync, mkdirSync } from 'node:fs';
import type { ScanFormat } from './types';
import { ytErrorKind, ytErrorText } from './youtube';

const YTDLP = Bun.env.YTDLP ?? 'yt-dlp';
const BASE = [YTDLP, '--js-runtimes', `bun:${process.execPath}`, '--no-warnings', '--no-progress'];
/** H.264 + AAC up to 720p on the short side (Shorts are 720x1280), else whatever is best. */
const FORMAT = ['-f', 'bv*[vcodec^=avc1]+ba[acodec^=mp4a]/b[vcodec^=avc1]/bv*+ba/b', '-S', 'res:720'];
const TEMP_DIR = Bun.env.YTDLP_TEMP ?? '/tmp/reelscope-ytdl';

export class YtError extends Error {
  constructor(
    message: string,
    /** gone: private/removed/unavailable; missing: no such channel or tab; retry: worth trying later. */
    readonly kind: 'gone' | 'missing' | 'retry',
  ) {
    super(message);
  }
}

async function run(args: string[], timeoutMs: number): Promise<{ out: string; err: string; code: number }> {
  const p = Bun.spawn([...BASE, ...args], { stdout: 'pipe', stderr: 'pipe' });
  const timer = setTimeout(() => p.kill(), timeoutMs);
  try {
    const [out, err] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()]);
    return { out, err, code: await p.exited };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Full info of one video (no download), as yt-dlp's JSON: exact views
 * (view_count), likes, comments, the channel and its subscribers
 * (channel_follower_count), upload time, duration, tags, categories, ….
 * lib/youtube.ts saveFromInfo maps it to a save.
 */
export async function ytInfo(id: string, timeoutMs = 45_000): Promise<Record<string, unknown>> {
  const r = await run(['-J', '--skip-download', '--no-playlist', `https://www.youtube.com/watch?v=${id}`], timeoutMs);
  let info: unknown = null;
  try {
    info = JSON.parse(r.out);
  } catch {
    // stays null
  }
  if (r.code !== 0 || !info || typeof info !== 'object') {
    const text = r.err.trim() ? ytErrorText(r.err) : `yt-dlp gave no answer (exit ${r.code})`;
    throw new YtError(text, r.err.trim() ? ytErrorKind(r.err) : 'retry');
  }
  return info as Record<string, unknown>;
}

/**
 * Download one video to `<dir>/<id>.mp4` (temp files outside `dir`). Returns the path.
 * `ffmpeg`: the binary yt-dlp merges with; left out, yt-dlp finds ffmpeg on PATH.
 */
export async function ytDownload(id: string, dir: string, ffmpeg?: string, timeoutMs = 30 * 60_000): Promise<string> {
  mkdirSync(TEMP_DIR, { recursive: true });
  const r = await run(
    [
      ...FORMAT,
      '--merge-output-format', 'mp4',
      ...(ffmpeg ? ['--ffmpeg-location', ffmpeg] : []),
      '--no-playlist',
      '-P', `temp:${TEMP_DIR}`,
      '-P', `home:${dir}`,
      '-o', `${id}.%(ext)s`,
      `https://www.youtube.com/watch?v=${id}`,
    ],
    timeoutMs,
  );
  const dest = `${dir}/${id}.mp4`;
  if (r.code !== 0 || !existsSync(dest)) {
    throw new YtError(r.err.trim() ? ytErrorText(r.err) : 'yt-dlp produced no file', ytErrorKind(r.err));
  }
  return dest;
}

export interface ChannelListing {
  /** yt-dlp flat-playlist entries, newest first. */
  entries: Record<string, unknown>[];
  /** The channel (playlist-level fields), or null when the list never finished. */
  channel: Record<string, unknown> | null;
  /** The list ended before the limit: that's all their Shorts (or videos). */
  complete: boolean;
}

/** The channel tab a scan lists: Shorts, or long-form videos. */
export const tabFor = (format: ScanFormat) => (format === 'long' ? 'videos' : 'shorts');

/**
 * A channel's Shorts tab, or with format 'long' its Videos tab, newest first,
 * as YouTube lists them: id, title, rounded views, length, thumbnails.
 * Streams: `onEntry` sees each as it arrives. Aborting stops yt-dlp and
 * returns what came in.
 */
export async function ytListChannel(
  channelUrl: string,
  format: ScanFormat,
  limit: number,
  opts: { signal?: AbortSignal; onEntry?: (n: number) => void; timeoutMs?: number } = {},
): Promise<ChannelListing> {
  const tab = tabFor(format);
  const args = [
    '--flat-playlist',
    '--lazy-playlist',
    '--print', 'E %(.{id,title,view_count,duration,thumbnails,live_status})j',
    '--print', 'playlist:P %(.{channel,channel_id,uploader_id,uploader_url,channel_follower_count,thumbnails})j',
  ];
  if (Number.isFinite(limit)) args.push('--playlist-end', String(limit));
  const p = Bun.spawn([...BASE, ...args, `${channelUrl}/${tab}`], { stdout: 'pipe', stderr: 'pipe' });
  const stop = () => p.kill();
  opts.signal?.addEventListener('abort', stop, { once: true });
  const timer = setTimeout(stop, opts.timeoutMs ?? 10 * 60_000);
  const entries: Record<string, unknown>[] = [];
  let channel: Record<string, unknown> | null = null;
  const errText = new Response(p.stderr).text();
  try {
    const decoder = new TextDecoder();
    let buf = '';
    const take = (line: string) => {
      const tag = line.slice(0, 2);
      if (tag !== 'E ' && tag !== 'P ') return;
      try {
        const v: unknown = JSON.parse(line.slice(2));
        if (!v || typeof v !== 'object') return;
        if (tag === 'P ') channel = v as Record<string, unknown>;
        else {
          entries.push(v as Record<string, unknown>);
          opts.onEntry?.(entries.length);
        }
      } catch {
        // a broken line: skip it
      }
    };
    for await (const chunk of p.stdout as unknown as AsyncIterable<Uint8Array>) {
      buf += decoder.decode(chunk, { stream: true });
      let nl: number;
      while ((nl = buf.indexOf('\n')) >= 0) {
        take(buf.slice(0, nl));
        buf = buf.slice(nl + 1);
      }
    }
    if (buf) take(buf);
    const code = await p.exited;
    const err = await errText;
    if (opts.signal?.aborted) return { entries, channel, complete: false };
    if (code !== 0 && entries.length === 0) {
      const kind = ytErrorKind(err);
      // A channel without Shorts (or videos) has no such tab: an empty list, not a failure.
      if (new RegExp(`does not have an? ${tab} tab`, 'i').test(err)) return { entries, channel, complete: true };
      throw new YtError(ytErrorText(err), kind);
    }
    return { entries, channel, complete: code === 0 && (!Number.isFinite(limit) || entries.length < limit) };
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener('abort', stop);
  }
}
