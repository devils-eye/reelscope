// Real side effects for the profile panel. The panel takes these as a prop so
// the dev harness (dev/panel-harness) can render it against fake data.
import { loadMediaItem, saveReelByShortcode } from '@/lib/capture';
import type { ProfileScanDetail } from '@/lib/types';
import { captures } from './captures';
import { loadPanelFont, send, serverUp } from './ext';
import type { PanelDeps } from './panel-deps';
import { igPostStats } from './postStats';
import { scanByScrolling } from './reelScan';

export const realDeps: PanelDeps = {
  scanProfile: (username, opts) => scanByScrolling(username, captures, opts),
  async previousScan(username) {
    const r = await send<{ data: ProfileScanDetail | null }>({ type: 'profileGet', username });
    return r?.ok ? r.data : null;
  },
  async postScan(profile, analysis) {
    const r = await send<{ id: number }>({ type: 'profileScan', profile, analysis });
    return !!r?.ok;
  },
  async savedShortcodes(shortcodes) {
    const r = await send<{ saved: string[] }>({ type: 'savedShortcodes', shortcodes });
    return r?.ok ? r.saved : [];
  },
  saveReel: (shortcode, channel) => saveReelByShortcode(shortcode, channel, captures),
  serverUp,
  mediaItem: (code) => captures.get(code)?.item,
  loadMediaItem: (code, signal) => loadMediaItem(code, captures, signal),
  openUrl(url) {
    window.open(url, '_blank', 'noopener');
  },
  loadFont: loadPanelFont,
  postStats: (code, signal) => igPostStats(code, captures, (c, s) => loadMediaItem(c, captures, s), signal),
};
