const CACHE_NAME = 'sidekick-mobile-v7';
const STATIC_ASSETS = [
  './index.html',
  './',
  './styles.css',
  './styles.css?v=6',
  './app.js',
  './app.js?v=5',
  './manifest.json',
  './icon-192.png',
  './icon-512.png'
];

/**
 * Strips redirected flag for WebKit/iOS Safari compliance.
 * Safari throws "Response served by the service worker has redirections"
 * if a navigation response has .redirected === true.
 */
function cleanResponse(response) {
  if (!response) return response;
  if (!response.redirected) return response;

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers
  });
}

// Install: Cache core app shell with clean unredirected responses
self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(async cache => {
      for (const asset of STATIC_ASSETS) {
        try {
          const res = await fetch(asset, { redirect: 'follow' });
          if (res.ok) {
            const bodyBlob = await res.blob();
            // Store pristine unredirected response
            const unredirected = new Response(bodyBlob, {
              headers: res.headers,
              status: res.status,
              statusText: res.statusText
            });
            await cache.put(asset, unredirected);

            // Also map root and ./ to index.html
            if (asset === './index.html') {
              const clone1 = new Response(bodyBlob, { headers: res.headers, status: res.status });
              const clone2 = new Response(bodyBlob, { headers: res.headers, status: res.status });
              await cache.put('./', clone1);
              await cache.put('/', clone2);
            }
          }
        } catch (err) {
          console.warn('Failed caching asset during install:', asset, err);
        }
      }
    })
  );
});

// Activate: Purge old cache versions immediately
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => {
      return Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch: Fast offline fallback & iOS/Android PWA resilience
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // 1. Top-Level Page Navigation (Opening or Reloading in Safari / PWA standalone)
  if (event.request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        // Fast-network-first with quick 2s timeout for instantaneous offline responsiveness
        try {
          const networkPromise = fetch(event.request).then(res => cleanResponse(res));
          const timeoutPromise = new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Network timeout')), 2000)
          );
          return await Promise.race([networkPromise, timeoutPromise]);
        } catch (err) {
          const cache = await caches.open(CACHE_NAME);
          const cached = (await cache.match('./index.html', { ignoreSearch: true })) ||
                         (await cache.match('/index.html', { ignoreSearch: true })) ||
                         (await cache.match('./', { ignoreSearch: true })) ||
                         (await cache.match('/', { ignoreSearch: true }));
          if (cached) {
            return cleanResponse(cached);
          }
          return new Response('Offline: Blackboarder cached shell not available.', {
            status: 503,
            headers: { 'Content-Type': 'text/plain; charset=utf-8' }
          });
        }
      })()
    );
    return;
  }

  // 2. Tasks API: Network-first with cache fallback
  if (url.pathname.startsWith('/api/tasks')) {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          if (response && response.status === 200) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          }
          return cleanResponse(response);
        })
        .catch(async () => {
          const cached = await caches.match(event.request, { ignoreSearch: true });
          if (cached) return cleanResponse(cached);
          return new Response(JSON.stringify({ ok: true, tasks: [], offline: true }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          });
        })
    );
    return;
  }

  // 3. Static assets: Cache-first with query-string tolerance (ignoreSearch) & safe offline fallback
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      // Try exact request match first
      let cached = await cache.match(event.request);
      if (!cached) {
        // Match ignoring query string (e.g. ?v=5)
        cached = await cache.match(event.request, { ignoreSearch: true });
      }
      if (!cached) {
        // Match by relative or clean path
        const strippedUrl = url.origin + url.pathname;
        cached = await cache.match(strippedUrl, { ignoreSearch: true }) ||
                 await cache.match(url.pathname, { ignoreSearch: true }) ||
                 await cache.match('.' + url.pathname, { ignoreSearch: true });
      }

      if (cached) {
        return cleanResponse(cached);
      }

      // If not cached, attempt network fetch
      try {
        const netRes = await fetch(event.request);
        if (netRes && netRes.ok) {
          const clone = netRes.clone();
          cache.put(event.request, clone);
        }
        return cleanResponse(netRes);
      } catch (netErr) {
        // Safe offline catch: return fallback by file name or empty 408 response without crashing
        const baseName = url.pathname.split('/').pop();
        if (baseName) {
          const fallback = await cache.match(baseName, { ignoreSearch: true });
          if (fallback) return cleanResponse(fallback);
        }
        return new Response('', { status: 408, statusText: 'Offline Asset Unavailable' });
      }
    })()
  );
});

// Push notification received
self.addEventListener('push', event => {
  let data = {
    title: '🚨 Blackboard Deadline Alert',
    body: 'You have an upcoming university deadline!',
    icon: './icon-192.png',
    badge: './icon-192.png',
    data: { url: './index.html' }
  };

  if (event.data) {
    try {
      const parsed = event.data.json();
      data = { ...data, ...parsed };
    } catch (e) {
      data.body = event.data.text();
    }
  }

  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: data.icon || './icon-192.png',
      badge: data.badge || './icon-192.png',
      vibrate: [200, 100, 200],
      data: data.data || { url: './index.html' },
      actions: [
        { action: 'open', title: 'Open Dashboard' }
      ]
    })
  );
});

// Notification click
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || './index.html';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windowClients => {
      for (const client of windowClients) {
        if (client.url.includes(targetUrl) && 'focus' in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(targetUrl);
      }
    })
  );
});

// Direct message from client (e.g. Test Notification)
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'TEST_NOTIFICATION') {
    self.registration.showNotification('🚨 Blackboarder Alert', {
      body: 'Test Notification: Calculus 1 Midterm is coming up!',
      icon: './icon-192.png',
      badge: './icon-192.png',
      vibrate: [200, 100, 200],
      data: { url: './index.html' }
    });
  }
});
