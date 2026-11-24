// Server communication + offline queue. Used by the background worker.
import { SERVER_BASE_URL } from './config';
import type {
  Platform,
  ProfileAnalysis,
  ProfileInfo,
  ProfileScanDetail,
  ReelLatestRow,
  SavePayload,
  ScanFormat,
  YtInfoResult,
  YtInfoSummary,
  YtScanState,
} from './types';

const PENDING_KEY = 'pendingSaves';

export type PostSaveResult =
  | { ok: true; isNew: boolean; data: ReelLatestRow }
  /** retry: the server was down or busy (queue it); otherwise it said no for good (a removed video). */
  | { ok: false; error: string; retry: boolean };

/** POST a payload to the local server. Network errors are returned, not thrown. */
export async function postSave(payload: SavePayload): Promise<PostSaveResult> {
  let res: Response;
  try {
    res = await fetch(`${SERVER_BASE_URL}/api/reels`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch (e) {
    return { ok: false, error: `network: ${e instanceof Error ? e.message : String(e)}`, retry: true };
  }
  let body: { isNew?: boolean; data?: ReelLatestRow; error?: string } = {};
  try {
    body = (await res.json()) as typeof body;
  } catch {
    // ignore malformed body
  }
  if (!res.ok) return { ok: false, error: body.error ?? `server ${res.status}`, retry: res.status >= 500 };
  if (!body.data) return { ok: false, error: 'empty server response', retry: true };
  return { ok: true, isNew: body.isNew ?? false, data: body.data };
}

export async function getPending(): Promise<SavePayload[]> {
  const stored = await browser.storage.local.get(PENDING_KEY);
  const raw: unknown = stored[PENDING_KEY];
  return Array.isArray(raw) ? (raw as SavePayload[]) : [];
}

export async function setPending(items: SavePayload[]): Promise<void> {
  await browser.storage.local.set({ [PENDING_KEY]: items });
}

export async function enqueuePending(payload: SavePayload): Promise<number> {
  const queue = await getPending();
  queue.push(payload);
  await setPending(queue);
  return queue.length;
}

/** Retry every queued save; keeps the ones that still fail. */
export async function flushPending(): Promise<{ flushed: number; remaining: number }> {
  const queue = await getPending();
  const remaining: SavePayload[] = [];
  let flushed = 0;
  for (const payload of queue) {
    try {
      const result = await postSave(payload);
      if (result.ok) flushed++;
      else if (result.retry) remaining.push(payload);
    } catch {
      remaining.push(payload);
    }
  }
  await setPending(remaining);
  return { flushed, remaining: remaining.length };
}

export async function fetchList(limit = 50): Promise<ReelLatestRow[]> {
  const res = await fetch(`${SERVER_BASE_URL}/api/reels?limit=${limit}`);
  if (!res.ok) throw new Error(`server ${res.status}`);
  const body = (await res.json()) as { data?: ReelLatestRow[] };
  return body.data ?? [];
}

export async function checkServer(): Promise<boolean> {
  try {
    const res = await fetch(`${SERVER_BASE_URL}/api/health`);
    return res.ok;
  } catch {
    return false;
  }
}

/** POST a profile scan. No queueing: scans are re-runnable from the profile page. */
export async function postProfileScan(
  profile: ProfileInfo,
  analysis: ProfileAnalysis,
  format: ScanFormat = 'short',
): Promise<{ ok: true; id: number } | { ok: false; error: string }> {
  let res: Response;
  try {
    res = await fetch(`${SERVER_BASE_URL}/api/profiles/scans`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ profile, analysis, format }),
    });
  } catch (e) {
    return { ok: false, error: `network: ${e instanceof Error ? e.message : String(e)}` };
  }
  let body: { id?: number; error?: string } = {};
  try {
    body = (await res.json()) as typeof body;
  } catch {
    // ignore malformed body
  }
  if (!res.ok) return { ok: false, error: body.error ?? `server ${res.status}` };
  return { ok: true, id: body.id ?? 0 };
}

/** Latest scan for a username, or null when never scanned. Throws on server errors. */
export async function getProfile(
  username: string,
  platform: Platform = 'instagram',
  format: ScanFormat = 'short',
): Promise<ProfileScanDetail | null> {
  const res = await fetch(
    `${SERVER_BASE_URL}/api/profiles/${encodeURIComponent(username)}?platform=${platform}&format=${format}`,
  );
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`server ${res.status}`);
  const body = (await res.json()) as { data?: ProfileScanDetail | null };
  return body.data ?? null;
}

/** Which of these shortcodes are already saved. Throws on server errors. */
export async function getSavedShortcodes(shortcodes: string[]): Promise<string[]> {
  if (shortcodes.length === 0) return [];
  const res = await fetch(
    `${SERVER_BASE_URL}/api/reels/exists?codes=${encodeURIComponent(shortcodes.join(','))}`,
  );
  if (!res.ok) throw new Error(`server ${res.status}`);
  const body = (await res.json()) as { saved?: unknown };
  return Array.isArray(body.saved) ? body.saved.filter((s): s is string => typeof s === 'string') : [];
}

// ---- YouTube channel scans (run by the server, see server/index.ts) ----------

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${SERVER_BASE_URL}${path}`, init);
  let body: { ok?: boolean; error?: string } & Record<string, unknown> = {};
  try {
    body = (await res.json()) as typeof body;
  } catch {
    // ignore malformed body
  }
  if (!res.ok || body.ok === false) throw new Error(body.error ?? `server ${res.status}`);
  return body as T;
}

/**
 * Start scanning a channel's Shorts, or its long-form videos with format
 * 'long' (limit null: all of them). Resolves the job id. `since` (ms epoch,
 * a time window): exact dates around its edge.
 */
export async function startYtScan(
  channel: string,
  limit: number | null,
  since: number | null = null,
  format: ScanFormat = 'short',
): Promise<string> {
  const body = await api<{ id: string }>('/api/youtube/scans', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ channel, limit, since, format }),
  });
  return body.id;
}

export async function getYtScan(id: string): Promise<YtScanState> {
  return (await api<{ data: YtScanState }>(`/api/youtube/scans/${encodeURIComponent(id)}`)).data;
}

export async function stopYtScan(id: string): Promise<void> {
  await api(`/api/youtube/scans/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

/**
 * One video's numbers for the stats card (GET /api/youtube/info/:id). Never
 * throws: reason 'offline' when the server didn't answer, 'gone' for a
 * private or removed video (422), 'retry' when YouTube may answer later.
 */
export async function getYtInfo(id: string): Promise<YtInfoResult> {
  let res: Response;
  try {
    res = await fetch(`${SERVER_BASE_URL}/api/youtube/info/${encodeURIComponent(id)}`);
  } catch (e) {
    return { ok: false, reason: 'offline', error: `network: ${e instanceof Error ? e.message : String(e)}` };
  }
  let body: { ok?: boolean; data?: YtInfoSummary; error?: string } = {};
  try {
    body = (await res.json()) as typeof body;
  } catch {
    // ignore malformed body
  }
  if (res.ok && body.data) return { ok: true, data: body.data };
  const error = body.error ?? `server ${res.status}`;
  return { ok: false, reason: res.status === 422 || res.status === 400 ? 'gone' : 'retry', error };
}
