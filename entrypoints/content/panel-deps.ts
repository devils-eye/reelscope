import type { PostDetails } from '@/lib/metrics';
import type { ChannelContext, ProfileAnalysis, ProfileInfo, ProfileScanDetail, SaveResult, ScanFormat } from '@/lib/types';
import type { ScanOpts, ScanOutcome } from './reelScan';

/**
 * Everything the in-page UI does to the outside world. Passed in so the dev
 * harness (dev/panel-harness) can run the real UI against fake data.
 */
export interface PanelDeps {
  /** Scroll the creator's reels tab and read what Instagram loaded (reelScan.ts). */
  scanProfile(username: string, opts: ScanOpts): Promise<ScanOutcome>;
  /**
   * Latest stored scan for this username, or null (also when the server is
   * down). `format` 'long': their long-form YouTube videos, scanned apart.
   */
  previousScan(username: string, format?: ScanFormat): Promise<ProfileScanDetail | null>;
  /** Store a finished scan. Resolves false when the server didn't take it. */
  postScan(profile: ProfileInfo, analysis: ProfileAnalysis, format?: ScanFormat): Promise<boolean>;
  /** Which of these shortcodes are already in the library (empty when the server is down). */
  savedShortcodes(shortcodes: string[]): Promise<string[]>;
  saveReel(shortcode: string, channel?: ChannelContext): Promise<SaveResult>;
  /** Whether the local library server answers (false also when the extension is gone). */
  serverUp(): Promise<boolean>;
  openUrl(url: string): void;
  /** The media item Instagram's page loaded for this reel (video, poster), if any. */
  mediaItem(shortcode: string): Record<string, unknown> | undefined;
  /** Fetch the item when the page never loaded it (one rate-limited request; rejects on failure). */
  loadMediaItem(shortcode: string, signal?: AbortSignal): Promise<Record<string, unknown>>;
  loadFont(): Promise<void>;
  /**
   * Everything known about one post, for the stats card. Instagram: the item
   * the page loaded, else one rate-limited /media/info request; YouTube: the
   * library server asks yt-dlp (2–4 s, cached there for 10 minutes).
   */
  postStats(shortcode: string, signal?: AbortSignal): Promise<PostStatsResult>;
}

export type PostStatsResult =
  | {
      ok: true;
      details: PostDetails;
      /** ms epoch the numbers are from. */
      at: number;
      /** page: what the page already loaded; instagram / youtube: asked just now. */
      source: 'page' | 'instagram' | 'youtube';
    }
  /** offline: the library server didn't answer; gone: the video is private or removed; retry: try again later. */
  | { ok: false; reason: 'offline' | 'gone' | 'retry'; error: string };
