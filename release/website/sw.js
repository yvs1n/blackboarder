const CACHE_NAME = 'sidekick-mobile-v8';
const STATIC_ASSETS = [
  './index.html',
  './',
  './styles.css',
  './styles.css?v=6',
  './app.js',
  './app.js?v=6',
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

// ============================================================================
// Deadline Notification Storage & Background Engine
// ============================================================================

const NOTIF_CACHE_URL = '/__bbs_scheduled_tasks__';

async function getStoredTasksForNotifications() {
  try {
    const cache = await caches.open(CACHE_NAME);
    const resp = await cache.match(NOTIF_CACHE_URL);
    if (resp) {
      return await resp.json();
    }
  } catch (e) {
    console.warn('[SW] Error reading cached notification tasks:', e);
  }
  return { tasks: [], notifiedMap: {}, pushEnabled: true };
}

async function saveStoredTasksForNotifications(data) {
  try {
    const cache = await caches.open(CACHE_NAME);
    const existing = await getStoredTasksForNotifications();
    const merged = {
      tasks: data.tasks !== undefined ? data.tasks : existing.tasks,
      notifiedMap: data.notifiedMap !== undefined ? data.notifiedMap : existing.notifiedMap,
      pushEnabled: data.pushEnabled !== undefined ? data.pushEnabled : existing.pushEnabled
    };
    await cache.put(
      new Request(NOTIF_CACHE_URL),
      new Response(JSON.stringify(merged), {
        headers: { 'Content-Type': 'application/json' }
      })
    );
  } catch (e) {
    console.warn('[SW] Failed to cache scheduled tasks:', e);
  }
}

// Evaluates deadlines and triggers native notifications
async function checkDeadlinesInServiceWorker() {
  try {
    const store = await getStoredTasksForNotifications();
    if (!store || store.pushEnabled === false || !Array.isArray(store.tasks) || store.tasks.length === 0) {
      return;
    }

    const now = Date.now();
    const tasks = store.tasks;
    const notifiedMap = store.notifiedMap || {};
    let changed = false;

    for (const task of tasks) {
      if (task.status === 'completed') continue;
      const dueTime = new Date(task.dueDate).getTime();
      if (isNaN(dueTime)) continue;

      const timeRemaining = dueTime - now;

      // 1. 24 Hour Advance Reminder (between 2h and 24h)
      if (timeRemaining > 2 * 3600 * 1000 && timeRemaining <= 24 * 3600 * 1000) {
        const key = `${task.id}_24h`;
        const last = notifiedMap[key] || 0;
        if (now - last > 18 * 3600 * 1000) {
          notifiedMap[key] = now;
          changed = true;
          const hoursLeft = Math.max(1, Math.round(timeRemaining / (3600 * 1000)));
          await self.registration.showNotification(`⏰ 24h Deadline: ${task.title}`, {
            body: `Due in about ${hoursLeft} hours! Course: ${task.courseCode || task.courseName}`,
            icon: './icon-192.png',
            badge: './icon-192.png',
            tag: `bbs-24h-${task.id}`,
            renotify: true,
            vibrate: [200, 100, 200],
            data: { url: './index.html', taskId: task.id }
          });
        }
      }

      // 2. 2 Hour Urgent Alert (between 0 and 2h)
      if (timeRemaining > 0 && timeRemaining <= 2 * 3600 * 1000) {
        const key = `${task.id}_2h`;
        const last = notifiedMap[key] || 0;
        if (now - last > 3 * 3600 * 1000) {
          notifiedMap[key] = now;
          changed = true;
          const minsLeft = Math.max(1, Math.round(timeRemaining / (60 * 1000)));
          const timeLeftStr = minsLeft >= 60 ? `about ${Math.round(minsLeft / 60)} hour(s)` : `${minsLeft} minutes`;
          await self.registration.showNotification(`🚨 Urgent (2h): ${task.title}`, {
            body: `Due in ${timeLeftStr}! Don't forget to submit for ${task.courseCode || task.courseName}.`,
            icon: './icon-192.png',
            badge: './icon-192.png',
            tag: `bbs-2h-${task.id}`,
            renotify: true,
            vibrate: [300, 150, 300],
            data: { url: './index.html', taskId: task.id }
          });
        }
      }

      // 3. Due Now / Closing (0 to -30m)
      if (timeRemaining <= 0 && timeRemaining >= -30 * 60 * 1000) {
        const key = `${task.id}_due`;
        const last = notifiedMap[key] || 0;
        if (now - last > 2 * 3600 * 1000) {
          notifiedMap[key] = now;
          changed = true;
          await self.registration.showNotification(`⏳ Deadline Closing: ${task.title}`, {
            body: `Due time has arrived for ${task.courseCode || task.courseName}.`,
            icon: './icon-192.png',
            badge: './icon-192.png',
            tag: `bbs-due-${task.id}`,
            renotify: true,
            vibrate: [200, 100, 200],
            data: { url: './index.html', taskId: task.id }
          });
        }
      }
    }

    if (changed) {
      await saveStoredTasksForNotifications({ notifiedMap });
    }
  } catch (err) {
    console.warn('[SW] Error checking deadlines:', err);
  }
}

// Push notification received via WebPush server
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

// Notification click: Focus app and open target task
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || './index.html';
  const taskId = event.notification.data && event.notification.data.taskId;

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windowClients => {
      for (const client of windowClients) {
        if (client.url.includes('index.html') && 'focus' in client) {
          if (taskId) {
            client.postMessage({ type: 'OPEN_TASK', taskId });
          }
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(targetUrl);
      }
    })
  );
});

// Periodic Background Sync (runs in background on Android/Chromium PWAs)
self.addEventListener('periodicsync', event => {
  if (event.tag === 'check-deadlines' || event.tag === 'bbs-check-deadlines') {
    event.waitUntil(checkDeadlinesInServiceWorker());
  }
});

// Background Sync
self.addEventListener('sync', event => {
  if (event.tag === 'check-deadlines' || event.tag === 'bbs-check-deadlines') {
    event.waitUntil(checkDeadlinesInServiceWorker());
  }
});

// Direct messages from client
self.addEventListener('message', event => {
  if (!event.data) return;

  if (event.data.type === 'TEST_NOTIFICATION') {
    self.registration.showNotification(event.data.title || '🚨 Blackboarder Alert', {
      body: event.data.body || 'Test Notification: Calculus 1 Midterm is coming up!',
      icon: './icon-192.png',
      badge: './icon-192.png',
      vibrate: [200, 100, 200],
      data: { url: './index.html' }
    });
  } else if (event.data.type === 'DISPATCH_NOTIFICATION') {
    self.registration.showNotification(event.data.title || 'Blackboarder Alert', {
      icon: './icon-192.png',
      badge: './icon-192.png',
      vibrate: [200, 100, 200],
      data: { url: './index.html' },
      ...event.data.options
    });
  } else if (event.data.type === 'SYNC_TASKS_FOR_NOTIFICATIONS') {
    event.waitUntil(
      saveStoredTasksForNotifications({
        tasks: event.data.tasks || [],
        notifiedMap: event.data.notifiedMap || {},
        pushEnabled: event.data.enabled !== false
      }).then(() => checkDeadlinesInServiceWorker())
    );
  } else if (event.data.type === 'CHECK_DEADLINES') {
    event.waitUntil(checkDeadlinesInServiceWorker());
  }
});
