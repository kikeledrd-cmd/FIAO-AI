/// <reference lib="webworker" />
import type { PrecacheEntry, SerwistGlobalConfig } from "serwist";
import { ExpirationPlugin, NetworkFirst, NetworkOnly, Serwist } from "serwist";
import { defaultCache } from "@serwist/next/worker";

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope;

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST ?? [],
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching: [
    // Auth and sync responses are NEVER cached. Offline continuity is owned by
    // Dexie + the sync client; the service worker only makes the app shell and
    // static assets available with intermittent connectivity. Caching these
    // endpoints would risk serving stale or sensitive data and would bypass
    // the explicit offline operation queue.
    {
      matcher: ({ url }) => url.pathname.startsWith("/api/"),
      handler: new NetworkOnly({ networkTimeoutSeconds: 10 })
    },
    // App shell: cache the HTML of same-origin navigations once seen online so
    // the shell (header, branch, sync status) still renders offline. Data stays
    // server-backed; this only covers the page document.
    {
      matcher: ({ request, sameOrigin }) => sameOrigin && request.mode === "navigate",
      handler: new NetworkFirst({
        cacheName: "fiao-shell",
        networkTimeoutSeconds: 5,
        plugins: [new ExpirationPlugin({ maxEntries: 16, maxAgeSeconds: 7 * 24 * 3600 })]
      })
    },
    ...defaultCache
  ]
});

serwist.addEventListeners();
