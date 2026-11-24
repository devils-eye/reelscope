// Page-world hook: runs in Instagram's own JavaScript world at document_start,
// before any of the page's scripts, and passes what the page loads to the
// content script (lib/pageHook.ts). A `world: 'MAIN'` content script works in
// Chrome MV3 (111+) and Firefox MV2 (128+), and unlike an injected <script>
// it is not blocked by Instagram's nonce-based CSP in Firefox.
import { installPageHook } from '@/lib/pageHook';

export default defineContentScript({
  matches: ['*://*.instagram.com/*'],
  runAt: 'document_start',
  world: 'MAIN',
  main() {
    installPageHook();
  },
});
