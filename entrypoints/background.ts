import type { ExtensionMessage, SavePayload } from '../lib/types';
import {
  checkServer,
  enqueuePending,
  fetchList,
  flushPending,
  getPending,
  getProfile,
  getSavedShortcodes,
  getYtInfo,
  getYtScan,
  postProfileScan,
  postSave,
  startYtScan,
  stopYtScan,
} from '../lib/sync';

export default defineBackground(() => {
  browser.runtime.onMessage.addListener((message) => {
    return handleMessage(message as ExtensionMessage);
  });

  browser.alarms.create('flush-pending', { periodInMinutes: 5 });
  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === 'flush-pending') void flushPending();
  });

  // Flush anything queued while the worker was down.
  void flushPending();
});

async function handleMessage(message: ExtensionMessage): Promise<unknown> {
  if (!message || typeof message !== 'object') return undefined;
  switch (message.type) {
    case 'save': {
      const payload = message.payload as SavePayload;
      try {
        const result = await postSave(payload);
        if (result.ok) {
          void flushPending();
          return { ok: true, isNew: result.isNew, data: result.data };
        }
        // A save the server refused for good (a removed YouTube video) is not queued.
        if (!result.retry) return { ok: false, queued: false, error: result.error };
        await enqueuePending(payload);
        return { ok: false, queued: true, error: result.error };
      } catch (e) {
        await enqueuePending(payload);
        return {
          ok: false,
          queued: true,
          error: e instanceof Error ? e.message : String(e),
        };
      }
    }
    case 'list': {
      try {
        const data = await fetchList(50);
        return { ok: true, data };
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
      }
    }
    case 'status': {
      const serverUp = await checkServer();
      const pending = (await getPending()).length;
      return { serverUp, pending };
    }
    case 'profileScan': {
      try {
        const result = await postProfileScan(message.profile, message.analysis, message.format);
        if (result.ok) return { ok: true, id: result.id };
        return { ok: false, error: result.error };
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
      }
    }
    case 'profileGet': {
      try {
        const data = await getProfile(message.username, message.platform, message.format);
        return { ok: true, data };
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
      }
    }
    case 'savedShortcodes':
      return reply(async () => ({ saved: await getSavedShortcodes(message.shortcodes) }));
    case 'ytScanStart':
      return reply(async () => ({ id: await startYtScan(message.channel, message.limit, message.since, message.format) }));
    case 'ytScanGet':
      return reply(async () => ({ data: await getYtScan(message.id) }));
    case 'ytScanStop':
      return reply(async () => (await stopYtScan(message.id), {}));
    case 'ytInfo':
      return getYtInfo(message.id);
    default:
      return undefined;
  }
}

/** `{ ok: true, ...value }`, or `{ ok: false, error }` when it throws. */
async function reply(fn: () => Promise<object>): Promise<unknown> {
  try {
    return { ok: true, ...(await fn()) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
