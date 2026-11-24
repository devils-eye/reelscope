// YouTube content script: the Instagram one's twin (entrypoints/content),
// same UI, YouTube's pages and words. See content/ytRuntime.tsx.
import { render } from 'solid-js/web';
import '../content/style.css';
import '../content/panel.css';
import '../content/stats.css';
import ContentApp from '../content/ContentApp';
import { useSite, YOUTUBE } from '../content/site';
import { ytDeps } from '../content/ytDeps';
import { startYoutubeRuntime } from '../content/ytRuntime';

export default defineContentScript({
  matches: ['*://www.youtube.com/*'],
  cssInjectionMode: 'ui',

  async main(ctx) {
    useSite(YOUTUBE);
    const rt = startYoutubeRuntime({
      deps: ytDeps,
      timers: {
        setInterval: (fn, ms) => ctx.setInterval(fn, ms),
        setTimeout: (fn, ms) => ctx.setTimeout(fn, ms),
        addEventListener: (target, type, fn) => ctx.addEventListener(target as Window, type as 'popstate', fn),
      },
    });
    ctx.onInvalidated(() => rt.dispose());

    // Toast, side panel, scan pill and lightbox share one body-level shadow root.
    const ui = await createShadowRootUi(ctx, {
      name: 'reelscope-ui',
      position: 'inline',
      anchor: 'body',
      append: 'last',
      onMount: (container) => render(() => <ContentApp rt={rt} />, container),
      onRemove: (dispose) => dispose?.(),
    });
    ui.mount();
    ctx.setInterval(() => {
      if (!ui.shadowHost.isConnected) {
        ui.remove();
        ui.mount();
      }
    }, 5000);
  },
});
