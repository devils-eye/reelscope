// Client for the local ReelScope server (server/index.ts), for extension pages
// that talk to it directly (the library and popup). host_permissions cover localhost.
import { SERVER_BASE_URL } from './config';
import type { ProfileScanSummary, ReelLatestRow, ReelStatus, SnapshotRow } from './types';

export type ReelSort = 'saved' | 'views' | 'outlier' | 'velocity' | 'newest_upload';

/** A reel_latest row as the list endpoint returns it. */
export interface LibraryReel extends ReelLatestRow {
  /** Whether /api/thumbs/:shortcode has a cached cover. */
  has_thumb: boolean;
  /** Whether the full video was cached at save time, and where (absolute path). */
  has_video: boolean;
  video_file: string | null;
}

/** GET /api/summary. */
export interface LibrarySummary {
  reels: number;
  instagram: number;
  youtube: number;
  /** Creators (per site and format) with at least one scan. */
  creators: number;
  last_saved_at: string | null;
}

export interface ReelDetail {
  reel: LibraryReel;
  snapshots: SnapshotRow[];
}

export interface ReelPatch {
  notes?: string | null;
  tags?: string[];
  status?: ReelStatus;
}

export interface ListParams {
  status?: ReelStatus;
  limit?: number;
  q?: string;
  sort?: ReelSort;
}

/** The server could not be reached at all (not running, wrong port). */
export class ServerDownError extends Error {
  constructor() {
    super(`Can't reach the server at ${SERVER_BASE_URL}`);
    this.name = 'ServerDownError';
  }
}

/** The server answered with an error. */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(SERVER_BASE_URL + path, init);
  } catch {
    throw new ServerDownError();
  }
  let body: { ok?: boolean; data?: T; error?: string } | null = null;
  try {
    body = await res.json();
  } catch {
    // fall through to the status check
  }
  if (!res.ok || !body || body.ok === false) {
    throw new ApiError(body?.error ?? `HTTP ${res.status}`, res.status);
  }
  return body.data as T;
}

/** Tags arrive parsed, but tolerate the raw JSON-string column too. */
export function normalizeReel<T extends Partial<LibraryReel>>(row: T): T {
  let tags: unknown = row.tags;
  if (typeof tags === 'string') {
    try {
      tags = JSON.parse(tags);
    } catch {
      tags = [];
    }
  }
  if (!Array.isArray(tags)) tags = [];
  return { ...row, tags: (tags as unknown[]).filter((t): t is string => typeof t === 'string') };
}

export async function listReels(params: ListParams = {}): Promise<LibraryReel[]> {
  const qs = new URLSearchParams();
  if (params.status) qs.set('status', params.status);
  if (params.limit != null) qs.set('limit', String(params.limit));
  if (params.q) qs.set('q', params.q);
  if (params.sort) qs.set('sort', params.sort);
  const s = qs.toString();
  const rows = await request<LibraryReel[]>(`/api/reels${s ? `?${s}` : ''}`);
  return (rows ?? []).map(normalizeReel);
}

export async function getReel(shortcode: string): Promise<ReelDetail> {
  const d = await request<ReelDetail>(`/api/reels/${encodeURIComponent(shortcode)}`);
  return { reel: normalizeReel(d.reel), snapshots: d.snapshots ?? [] };
}

export async function patchReel(shortcode: string, patch: ReelPatch): Promise<LibraryReel> {
  const row = await request<LibraryReel>(`/api/reels/${encodeURIComponent(shortcode)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  return normalizeReel(row);
}

/** The full reel video cached at save time (GET /api/videos/:shortcode, Range). */
export function videoUrl(shortcode: string): string {
  return `${SERVER_BASE_URL}/api/videos/${encodeURIComponent(shortcode)}`;
}

export function thumbUrl(shortcode: string): string {
  return `${SERVER_BASE_URL}/api/thumbs/${encodeURIComponent(shortcode)}`;
}

/** Latest scan per profile (GET /api/profiles). */
export async function listProfiles(): Promise<ProfileScanSummary[]> {
  return (await request<ProfileScanSummary[]>('/api/profiles')) ?? [];
}

export async function getSummary(): Promise<LibrarySummary> {
  return await request<LibrarySummary>('/api/summary');
}
