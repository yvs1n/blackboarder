/*
 * Retires the service worker that the companion app installed at the site root before it moved to
 * /companion/. Browsers re-check this file, install this version, and it removes itself and reloads
 * open pages, which then reach the companion at /companion/. The current app's worker is
 * /companion/sw.js and is not affected. Keep this file so phones that have not opened the app since
 * the move still get cleaned up.
 */
self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    await self.registration.unregister();
    const pages = await self.clients.matchAll({ type: 'window' });
    for (const page of pages) {
      try { page.navigate(page.url); } catch (e) {}
    }
  })());
});
