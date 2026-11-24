import { defineConfig } from 'wxt';

// See https://wxt.dev/api/reference/wxt/interfaces/inlineconfig.html
export default defineConfig({
  modules: ['@wxt-dev/module-solid'],
  manifest: {
    name: 'ReelScope',
    description: 'Find the reels and videos that outperform their creator, and save them to a local library.',
    permissions: ['storage', 'alarms'],
    host_permissions: ['*://*.instagram.com/*', '*://www.youtube.com/*', 'http://localhost:8788/*'],
    // The library doubles as the options page, opened in its own tab.
    options_ui: { page: 'library.html', open_in_tab: true },
    // The profile panel fetches Archivo's bytes from the content script.
    web_accessible_resources: [
      { resources: ['fonts/*.woff2'], matches: ['*://*.instagram.com/*', '*://www.youtube.com/*'] },
    ],
  },
});
