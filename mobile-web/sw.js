/*
 * Site-root service worker. The phone app lives at /companion/ and has its own worker
 * (/companion/sw.js) that keeps it working offline. Home screen apps installed before the move,
 * or added from the landing page, open at "/". This worker only steps in when "/" cannot be
 * reached: it sends the page to the offline copy of the app at /companion/, or shows a short
 * offline note if the app has never been opened on this device. Online, everything goes to the
 * network as usual. It never caches anything itself.
 */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));

const OFFLINE_NOTE = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>Blackboarder</title>
<style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;
font-family:system-ui,sans-serif;background:#111113;color:#f4f4f5;padding:24px;box-sizing:border-box;text-align:center}
p{max-width:320px;line-height:1.5;color:#a1a1aa}</style></head><body><div>
<h1 style="font-size:20px">You are offline</h1>
<p>Open Blackboarder once while online so it can save a copy on this device. After that it opens without internet.</p>
</div></body></html>`;

async function appIsCached() {
  try {
    return Boolean(await caches.match('/companion/', { ignoreSearch: true }));
  } catch (e) {
    return false;
  }
}

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.mode !== 'navigate') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith('/companion/')) return;

  event.respondWith((async () => {
    try {
      return await fetch(req);
    } catch (e) {
      if (await appIsCached()) {
        return Response.redirect(`${url.origin}/companion/${url.search}${url.hash}`, 302);
      }
      return new Response(OFFLINE_NOTE, { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
    }
  })());
});
