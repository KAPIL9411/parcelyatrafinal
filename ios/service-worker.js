/**
 * Parcel Yatra iPhone PWA — service worker.
 *
 * Compiled into `dist/sw.js` by `ios/scripts/build.mjs`, which substitutes this build's version stamp,
 * cache namespace and first-paint file list for the three placeholders below. Edit this file, not the
 * copy in `dist/`.
 *
 * ## The rule behind what it stores
 *
 * Only this app's own static files, and only those whose name carries a content hash or sits under a
 * hashed directory: the bundles under `/_expo/`, the images and fonts under `/assets/`, the icons, the
 * document shell and the offline page. A new build renames them, so a hit can never be stale.
 *
 * It never touches the API. Anything addressed at `/v1`, at the Socket.IO endpoint, at a different
 * origin, or answered with `no-store` or `private` is passed straight to the network with no cache read
 * and no cache write. Bookings, parcels, trips, conversations, notifications, identity documents and
 * the profile behind them are personal data belonging to whoever is signed in on this phone, not to
 * this cache — a shared iPhone must not keep the previous user's messages in an offline store, and a
 * service worker has no way to evict one when the app signs out. This mirrors what the app already
 * does, where the session and the profile deliberately stay out of web storage.
 *
 * iOS treats a service-worker cache as app data and may evict it after a week without a visit. Nothing
 * here depends on a cache surviving: every cached file is fetchable again, and the worst case is a
 * slower load, not a lost booking.
 */

'use strict';

const VERSION = '__PY_VERSION__';
const PRECACHE = __PY_PRECACHE__;

const PREFIX = '__PY_CACHE_PREFIX__';
const SHELL = `${PREFIX}shell-${VERSION}`;
const ASSETS = `${PREFIX}assets-${VERSION}`;

/** Directories whose every file name is content-addressed, so cache-first is always correct. */
function isHashedStatic(url) {
  return url.pathname.startsWith('/_expo/') || url.pathname.startsWith('/assets/') || url.pathname.startsWith('/icons/');
}

/** Requests the network alone must answer. */
function isForeignOrigin(url) {
  return url.origin !== self.location.origin;
}

self.addEventListener('install', event => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(ASSETS);
      // addAll() rejects as a unit, which would leave the worker permanently installed-but-waiting on
      // one renamed file. Install anyway and let the network cover the gap.
      const settled = await Promise.allSettled(PRECACHE.map(url => cache.add(new Request(url, { cache: 'reload' }))));
      const failed = settled.filter(r => r.status === 'rejected');
      if (failed.length > 0) {
        console.warn(`[Parcel Yatra] ${failed.length} of ${PRECACHE.length} files were not precached.`);
      }
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    (async () => {
      const stale = (await caches.keys()).filter(key => key.startsWith(PREFIX) && !key.endsWith(VERSION));
      await Promise.all(stale.map(key => caches.delete(key)));
      await self.clients.claim();
    })(),
  );
});

/**
 * A page tells the worker when it is safe to take over, so an update never replaces the bundles under
 * a screen that is mid-flight.
 */
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'PY_SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;

  let url;
  try {
    url = new URL(request.url);
  } catch {
    return;
  }
  if (isForeignOrigin(url)) return;

  if (request.mode === 'navigate' || request.headers.get('accept')?.includes('text/html')) {
    event.respondWith(navigation(request));
    return;
  }
  // Anything that is not a hashed build file — /v1, /socket.io, the manifest, this worker's own
  // sibling scripts — is left on the network, which is also exactly how a fetch with no service
  // worker would behave.
  if (isHashedStatic(url)) {
    event.respondWith(staticAsset(request));
  }
});

/**
 * A screen load goes to the network first, so a returning user always gets the current document and
 * therefore the current bundle names. Only a failure falls back to cache, and only a cache miss falls
 * back to the offline page.
 */
async function navigation(request) {
  try {
    const response = await fetch(request);
    if (response.ok && cacheable(response)) {
      const cache = await caches.open(SHELL);
      await cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match(request);
    if (cached) return cached;
    const shell = await caches.match('/index.html');
    if (shell) return shell;
    const offline = await caches.match('/offline.html');
    if (offline) return offline;
    return new Response('Parcel Yatra is offline.', {
      status: 503,
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    });
  }
}

/** Content-addressed files are safe to serve from cache without asking the network first. */
async function staticAsset(request, url) {
  const cached = await caches.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (response.ok && cacheable(response) && response.type === 'basic') {
      const cache = await caches.open(ASSETS);
      await cache.put(request, response.clone());
    }
    return response;
  } catch {
    // A missing image is a blank tile, not a broken screen: hand the page a void and move on.
    return new Response(null, { status: 504, statusText: 'offline' });
  }
}

function cacheable(response) {
  const control = response.headers.get('cache-control') || '';
  return !/no-store|private|max-age=0/.test(control);
}
