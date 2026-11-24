// Dev-only harness: the real in-page UI (entrypoints/content/runtime.tsx)
// running on a fake Instagram (fixture/ig.js) with fake data. Not part of
// the extension build.   bun run harness  ->  http://localhost:5199/
// Every route (/, /reels/<code>/, /fakecreator/, /p/<code>/ …) serves the
// same page, like Instagram's SPA. The fake API (fixture/api.js) answers
// /graphql/query, /api/v1/… and /ajax/…, and first loads get Instagram-style
// SSR JSON blobs.
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import solid from 'vite-plugin-solid';
// @ts-expect-error plain JS fixture module, no types
import { handleApi, ssrBlobs } from './fixture/api.js';

const API_DELAY_MS = 120;

function fakeInstagram(): Plugin {
  return {
    name: 'fake-instagram',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = new URL(req.url ?? '/', 'http://localhost');
        if (!/^\/(graphql\/query|api\/|ajax\/|fixture-thumb\/)/.test(url.pathname)) return next();
        let body = '';
        req.on('data', (c) => (body += c));
        req.on('end', () => {
          const out = handleApi({ method: req.method, pathname: url.pathname, search: url.search, body });
          if (!out) return next();
          setTimeout(() => {
            res.statusCode = out.status;
            res.setHeader('content-type', out.contentType);
            res.end(out.body);
          }, API_DELAY_MS);
        });
      });
    },
    transformIndexHtml(html, ctx) {
      const path = new URL(ctx.originalUrl ?? ctx.path, 'http://localhost').pathname;
      return html.replace('<!-- ssr -->', ssrBlobs(path));
    },
  };
}

const root = fileURLToPath(new URL('.', import.meta.url));
export default defineConfig({
  root,
  appType: 'spa',
  plugins: [solid(), fakeInstagram()],
  resolve: { alias: { '@': fileURLToPath(new URL('../..', import.meta.url)) } },
  server: { port: 5199 },
});
