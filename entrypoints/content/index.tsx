import { render } from 'solid-js/web';
import './style.css';
import './panel.css';
import './stats.css';
import { startCaptureBridge } from './captures';
import ContentApp from './ContentApp';
import { realDeps } from './deps';
import { startRuntime } from './runtime';

export default defineContentScript({
  matches: ['*://*.instagram.com/*'],
  cssInjectionMode: 'ui',

  async main(ctx) {
    // First, so the page hook's replay of what loaded before us lands.
    ctx.onInvalidated(startCaptureBridge());
    const rt = startRuntime({
      deps: realDeps,
      timers: {
        setInterval: (fn, ms) => ctx.setInterval(fn, ms),
        setTimeout: (fn, ms) => ctx.setTimeout(fn, ms),
        addEventListener: (target, type, fn) => ctx.addEventListener(target as Window, type as 'popstate', fn),
      },
    });
    ctx.onInvalidated(() => rt.dispose());

    // Toast + side panel live in one body-level shadow root.
    const ui = await createShadowRootUi(ctx, {
      name: 'reelscope-ui',
      position: 'inline',
      anchor: 'body',
      append: 'last',
      onMount: (container) => render(() => <ContentApp rt={rt} />, container),
      onRemove: (dispose) => dispose?.(),
    });
    ui.mount();
    // Our host sits on <body>, which survives SPA navigation; re-attach
    // defensively if anything ever detaches it.
    ctx.setInterval(() => {
      if (!ui.shadowHost.isConnected) {
        ui.remove();
        ui.mount();
      }
    }, 5000);
  },
});
