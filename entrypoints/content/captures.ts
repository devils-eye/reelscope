// Content-script side of the page hook (lib/pageHook.ts): one capture store
// per tab, fed by the hook's postMessage stream. The hook starts at
// document_start and this script at document_idle, so on start we ask the
// hook to replay what it saw before we were listening.
import { CaptureStore } from '@/lib/captureStore';
import { decodeMessage, encodeMessage } from '@/lib/igCapture';

export const captures = new CaptureStore();

export function startCaptureBridge(store: CaptureStore = captures, win: Window = window): () => void {
  // No event.source check: in Firefox the page window reaches the content
  // script as a different wrapper. decodeMessage validates the payload instead.
  const onMessage = (e: MessageEvent) => {
    const m = decodeMessage(e.data);
    if (m?.kind === 'capture') store.ingest(m.media, m.users);
  };
  win.addEventListener('message', onMessage);
  win.postMessage(encodeMessage({ kind: 'replay' }), win.location.origin);
  return () => win.removeEventListener('message', onMessage);
}
