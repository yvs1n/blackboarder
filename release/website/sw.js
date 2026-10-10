const CACHE_NAME = 'sidekick-mobile-v13';
const STATIC_ASSETS = [
  './',
  './index.html',
  './styles.css',
  './styles.css?v=13',
  './app.js',
  './app.js?v=13',
  './manifest.json',
  './icon-192.png',
  './icon-512.png'
];

/**
 * Strips redirected flag and compression headers for WebKit/iOS Safari & Chromium compliance.
 * When a response body is decompressed into a Blob or reconstructed, keeping 'content-encoding: br/gzip'
 * causes browsers to fail with ERR_CONTENT_DECODING_FAILED when served offline.
 */
function cleanResponse(response) {
  if (!response) return response;
  const headers = new Headers(response.headers);
  headers.delete('content-encoding');
  headers.delete('content-length');

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

// Install: Cache core app shell with clean uncompressed, unredirected responses
self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(async cache => {
      for (const asset of STATIC_ASSETS) {
        try {
          const res = await fetch(asset, { redirect: 'follow' });
          if (res.ok) {
            const bodyBlob = await res.blob();
            const headers = new Headers(res.headers);
            // Crucial: remove compression headers because bodyBlob is uncompressed raw bytes
            headers.delete('content-encoding');
            headers.delete('content-length');

            // Store pristine uncompressed response
            const unredirected = new Response(bodyBlob, {
              headers,
              status: 200,
              statusText: 'OK'
            });
            await cache.put(asset, unredirected.clone());

            // Map root navigation paths directly to the primary shell
            if (asset === './index.html' || asset === './') {
              await cache.put('./', unredirected.clone());
              await cache.put('/', unredirected.clone());
              await cache.put('./index.html', unredirected.clone());
              await cache.put('/index.html', unredirected.clone());
            }
          }
        } catch (err) {
          console.warn('[SW] Failed caching asset during install:', asset, err);
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
        // Fast network-first with quick 2s timeout for instantaneous updates and offline fallback
        try {
          const networkPromise = fetch(event.request);
          const timeoutPromise = new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Network timeout')), 2000)
          );
          const netRes = await Promise.race([networkPromise, timeoutPromise]);
          if (netRes && netRes.ok) {
            const cache = await caches.open(CACHE_NAME);
            cache.put(event.request, netRes.clone());
            return cleanResponse(netRes);
          }
        } catch (err) {
          // Network failed or timed out: fall back to cached index.html
        }

        const cache = await caches.open(CACHE_NAME);
        let cached = await cache.match(event.request, { ignoreSearch: true });
        if (!cached) {
          cached = (await cache.match('./', { ignoreSearch: true })) ||
                   (await cache.match('/', { ignoreSearch: true })) ||
                   (await cache.match('./index.html', { ignoreSearch: true })) ||
                   (await cache.match('/index.html', { ignoreSearch: true }));
        }
        if (cached) {
          return cleanResponse(cached);
        }
        return new Response('Offline: Blackboarder cached shell not available.', {
          status: 503,
          headers: { 'Content-Type': 'text/plain; charset=utf-8' }
        });
      })()
    );
    return;
  }

  // 2. Tasks API: Network-first with cache fallback (same origin only)
  if (url.origin === self.location.origin && url.pathname.startsWith('/api/tasks')) {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          if (response && response.status === 200) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(async () => {
          const cache = await caches.open(CACHE_NAME);
          const cached = await cache.match(event.request, { ignoreSearch: true });
          if (cached) return cached;
          return new Response(JSON.stringify({ ok: false, error: 'Offline and not cached', offline: true }), {
            status: 503,
            headers: { 'Content-Type': 'application/json' }
          });
        })
    );
    return;
  }

  // 3. Application Code (app.js, styles.css): Network-first with fast 2s timeout & offline cache fallback
  if (url.origin === self.location.origin && (url.pathname.endsWith('/app.js') || url.pathname.endsWith('/styles.css'))) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE_NAME);
        try {
          const netPromise = fetch(event.request);
          const timeoutPromise = new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Network timeout')), 2000)
          );
          const netRes = await Promise.race([netPromise, timeoutPromise]);
          if (netRes && netRes.ok) {
            cache.put(event.request, netRes.clone());
            return cleanResponse(netRes);
          }
        } catch (err) {
          // Network unavailable or slow: fall back to cache below
        }

        const cached = (await cache.match(event.request)) ||
                       (await cache.match(event.request, { ignoreSearch: true })) ||
                       (await cache.match(url.pathname, { ignoreSearch: true })) ||
                       (await cache.match('.' + url.pathname, { ignoreSearch: true }));
        if (cached) return cleanResponse(cached);

        return new Response('', { status: 503, statusText: 'Offline Asset Unavailable' });
      })()
    );
    return;
  }

  // 4. Static media assets (icons, manifest): Same-origin only
  if (url.origin === self.location.origin) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE_NAME);
        let cached = await cache.match(event.request, { ignoreSearch: true });
        if (!cached) {
          const strippedUrl = url.origin + url.pathname;
          cached = (await cache.match(strippedUrl, { ignoreSearch: true })) ||
                   (await cache.match(url.pathname, { ignoreSearch: true })) ||
                   (await cache.match('.' + url.pathname, { ignoreSearch: true }));
        }

        if (cached) {
          return cleanResponse(cached);
        }

        try {
          const netRes = await fetch(event.request);
          if (netRes && netRes.ok) {
            cache.put(event.request, netRes.clone());
          }
          return cleanResponse(netRes);
        } catch (netErr) {
          const baseName = url.pathname.split('/').pop();
          if (baseName) {
            const fallback = await cache.match(baseName, { ignoreSearch: true });
            if (fallback) return cleanResponse(fallback);
          }
          return new Response('', { status: 503, statusText: 'Offline Asset Unavailable' });
        }
      })()
    );
    return;
  }
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

function formatSwNotification(task, windowType, timeRemaining) {
  const courseName = (task.courseName && task.courseName.toLowerCase() !== 'uos') ? task.courseName : 'General Course';
  const courseCode = (task.courseCode && task.courseCode.toLowerCase() !== 'uos' && task.courseCode !== courseName) ? task.courseCode : '';
  const courseDisplay = courseCode ? `${courseName} (${courseCode})` : courseName;

  const dueDateObj = new Date(task.dueDate);
  const timeStr = !isNaN(dueDateObj) ? dueDateObj.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '';
  const dateStr = !isNaN(dueDateObj) ? dueDateObj.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' }) : '';

  const room = task.room || '';
  let locationStr = '';
  if (room) {
    locationStr = `📍 Room: ${room}`;
  } else if (task.type === 'exam' || task.type === 'quiz') {
    locationStr = '📍 In-class on paper';
  } else {
    locationStr = '💻 Online Submission on Blackboard';
  }

  const weightStr = task.weight ? ` • Worth ${task.weight}%` : '';

  let title = '';
  let timeDesc = '';
  if (windowType === '24h') {
    const hoursLeft = Math.max(1, Math.round(timeRemaining / (3600 * 1000)));
    title = `⏰ 24h Reminder: ${task.title}`;
    timeDesc = `🕒 Due: ${dateStr} at ${timeStr} (~${hoursLeft}h left)`;
  } else if (windowType === '2h') {
    const minsLeft = Math.max(1, Math.round(timeRemaining / (60 * 1000)));
    const countdownStr = minsLeft >= 60 ? `about ${Math.round(minsLeft / 60)} hour(s)` : `${minsLeft} minutes`;
    title = `🚨 Urgent (2h): ${task.title}`;
    timeDesc = `🕒 Due: ${dateStr} at ${timeStr} (in ${countdownStr})`;
  } else {
    title = `⏳ Due Now: ${task.title}`;
    timeDesc = `🕒 Due time has arrived (${dateStr} at ${timeStr})`;
  }

  const body = `${courseDisplay}${weightStr}\n${timeDesc}\n${locationStr}`;

  return { title, body };
}

// Evaluates deadlines and triggers native notifications
async function checkDeadlinesInServiceWorker() {
  try {
    const store = await getStoredTasksForNotifications();
    if (!store || store.pushEnabled === false || !Array.isArray(store.tasks) || store.tasks.length === 0) {
      return;
    }

    // If an active window client is open and visible in foreground, let app.js handle alerts
    const windowClients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const isForeground = windowClients.some(c => c.visibilityState === 'visible');
    if (isForeground) {
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
          const { title, body } = formatSwNotification(task, '24h', timeRemaining);
          await self.registration.showNotification(title, {
            body,
            icon: './icon-192.png',
            badge: './icon-192.png',
            tag: `bbs-24h-${task.id}`,
            renotify: false,
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
          const { title, body } = formatSwNotification(task, '2h', timeRemaining);
          await self.registration.showNotification(title, {
            body,
            icon: './icon-192.png',
            badge: './icon-192.png',
            tag: `bbs-2h-${task.id}`,
            renotify: false,
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
          const { title, body } = formatSwNotification(task, 'due', timeRemaining);
          await self.registration.showNotification(title, {
            body,
            icon: './icon-192.png',
            badge: './icon-192.png',
            tag: `bbs-due-${task.id}`,
            renotify: false,
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
      })
    );
  } else if (event.data.type === 'CHECK_DEADLINES') {
    event.waitUntil(checkDeadlinesInServiceWorker());
  } else if (event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  } else if (event.data.type === 'CLEAR_CACHE') {
    event.waitUntil(
      caches.keys().then(keys => Promise.all(keys.map(k => caches.delete(k))))
    );
  }
});
