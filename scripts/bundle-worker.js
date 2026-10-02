import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.join(__dirname, '..');

const HTML_PATH = path.join(ROOT_DIR, 'mobile-web', 'index.html');
const CSS_PATH = path.join(ROOT_DIR, 'mobile-web', 'styles.css');
const JS_PATH = path.join(ROOT_DIR, 'mobile-web', 'app.js');
const MANIFEST_PATH = path.join(ROOT_DIR, 'mobile-web', 'manifest.json');
const SW_PATH = path.join(ROOT_DIR, 'mobile-web', 'sw.js');
const CALENDAR_FEED_PATH = path.join(ROOT_DIR, 'server', 'calendarFeed.js');
const OUTPUT_WORKER_PATH = path.join(ROOT_DIR, 'cloudflare-worker', 'worker.js');

console.log('⚡ Bundling Cloudflare Worker Serverless Project...');

const htmlContent = fs.readFileSync(HTML_PATH, 'utf8');
const cssContent = fs.readFileSync(CSS_PATH, 'utf8');
const jsContent = fs.readFileSync(JS_PATH, 'utf8');
const manifestContent = fs.readFileSync(MANIFEST_PATH, 'utf8');
const swContent = fs.readFileSync(SW_PATH, 'utf8');
const calendarFeedCode = fs.readFileSync(CALENDAR_FEED_PATH, 'utf8')
  .replace(/export\s*\{\s*generateIcsFeed[\s\S]*?\};/, ''); // Strip trailing export

const workerTemplate = `/**
 * Cloudflare Worker: 100% Free Serverless Edge Endpoint for Blackboarder
 * Serves Mobile Web App (PWA), 24/7 Live WebCal Feed, and Task Sync API.
 */

${calendarFeedCode}

// Embedded Static Mobile PWA Assets
const ASSETS = {
  '/index.html': {
    content: ${JSON.stringify(htmlContent)},
    contentType: 'text/html; charset=utf-8'
  },
  '/styles.css': {
    content: ${JSON.stringify(cssContent)},
    contentType: 'text/css; charset=utf-8'
  },
  '/app.js': {
    content: ${JSON.stringify(jsContent)},
    contentType: 'application/javascript; charset=utf-8'
  },
  '/sw.js': {
    content: ${JSON.stringify(swContent)},
    contentType: 'application/javascript; charset=utf-8'
  },
  '/manifest.json': {
    content: ${JSON.stringify(manifestContent)},
    contentType: 'application/manifest+json'
  }
};

const FIREBASE_DB_URL = 'https://blackboard-sidekick-default-rtdb.asia-southeast1.firebasedatabase.app';

// In-memory fallback if KV is not bound yet during local preview
let memoryTasks = { tasks: [], lastSync: null };

async function getStoredTasks(env, token = null) {
  const dbUrl = (env && env.SKIP_FIREBASE) ? null : ((env && env.FIREBASE_DB_URL) || FIREBASE_DB_URL);
  const pathSuffix = (token && /^[a-zA-Z0-9_-]{3,40}$/.test(token)) ? \`users/\${token}/data.json\` : 'data.json';

  // 1. Fetch from Firebase Realtime Database
  if (dbUrl) {
    try {
      const fbRes = await fetch(\`\${dbUrl}/\${pathSuffix}\`, {
        cache: 'no-store'
      });
      if (fbRes.ok) {
        const fbData = await fbRes.json();
        if (fbData && Array.isArray(fbData.tasks)) {
          memoryTasks = fbData;
          return fbData;
        }
      }
      // If user path has no data yet, fallback to main shared data
      if (token && pathSuffix !== 'data.json') {
        const fallbackRes = await fetch(\`\${dbUrl}/data.json\`, { cache: 'no-store' });
        if (fallbackRes.ok) {
          const fallbackData = await fallbackRes.json();
          if (fallbackData && Array.isArray(fallbackData.tasks)) {
            return fallbackData;
          }
        }
      }
    } catch (err) {
      console.warn('Worker: Firebase fetch error, falling back:', err);
    }
  }

  // 2. Fetch from Cloudflare KV if bound
  if (env && env.TASKS_KV) {
    try {
      const kvKey = token ? \`bbs_tasks_\${token}\` : 'bbs_tasks';
      const raw = await env.TASKS_KV.get(kvKey) || (!token ? null : await env.TASKS_KV.get('bbs_tasks'));
      if (raw) {
        const kvData = JSON.parse(raw);
        if (kvData && Array.isArray(kvData.tasks)) {
          memoryTasks = kvData;
          return kvData;
        }
      }
    } catch (e) {}
  }

  // 3. Fallback to memory
  return memoryTasks;
}

async function saveStoredTasks(payload, env, token = null) {
  const dbUrl = (env && env.SKIP_FIREBASE) ? null : ((env && env.FIREBASE_DB_URL) || FIREBASE_DB_URL);
  const pathSuffix = (token && /^[a-zA-Z0-9_-]{3,40}$/.test(token)) ? \`users/\${token}/data.json\` : 'data.json';

  // 1. Save to Firebase Realtime Database
  if (dbUrl) {
    try {
      await fetch(\`\${dbUrl}/\${pathSuffix}\`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
    } catch (err) {
      console.warn('Worker: Firebase save error:', err);
    }
  }

  // 2. Save to Cloudflare KV if bound
  if (env && env.TASKS_KV) {
    try {
      const kvKey = token ? \`bbs_tasks_\${token}\` : 'bbs_tasks';
      await env.TASKS_KV.put(kvKey, JSON.stringify(payload));
    } catch (e) {}
  }

  // 3. Keep in memory
  memoryTasks = payload;
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-sync-secret',
      'Cache-Control': 'no-cache, no-store, must-revalidate'
    }
  });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const pathname = url.pathname;

    // 1. CORS Preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-sync-secret',
          'Access-Control-Max-Age': '86400'
        }
      });
    }

    try {
      // 2. GET /api/status
      if (request.method === 'GET' && pathname === '/api/status') {
        const taskData = await getStoredTasks(env);
        return jsonResponse({
          ok: true,
          platform: 'Cloudflare Workers (Edge Serverless + Firebase)',
          firebaseDb: FIREBASE_DB_URL,
          totalTasks: (taskData.tasks || []).length,
          lastSync: taskData.lastSync,
          mobileUrl: url.origin,
          feedUrl: \`\${url.origin}/feed.ics\`,
          webcalUrl: \`webcal://\${url.host}/feed.ics\`
        });
      }

      const token = url.searchParams.get('token');

      // 3. GET /api/tasks
      if (request.method === 'GET' && pathname === '/api/tasks') {
        const taskData = await getStoredTasks(env, token);
        return jsonResponse({
          ok: true,
          tasks: taskData.tasks || [],
          lastSync: taskData.lastSync,
          count: (taskData.tasks || []).length,
          token: token || undefined
        });
      }

      // 4. POST /api/sync
      if (request.method === 'POST' && pathname === '/api/sync') {
        const body = await request.json().catch(() => ({}));
        if (!Array.isArray(body.tasks)) {
          return jsonResponse({ ok: false, error: 'Expected tasks array in payload' }, 400);
        }

        const syncTimestamp = new Date().toISOString();
        const payload = {
          tasks: body.tasks,
          lastSync: syncTimestamp,
          device: body.device || 'Chrome Extension',
          count: body.tasks.length
        };

        await saveStoredTasks(payload, env, token);

        return jsonResponse({
          ok: true,
          count: body.tasks.length,
          lastSync: syncTimestamp,
          token: token || undefined,
          message: 'Synchronized successfully to Firebase Realtime Database'
        });
      }

      // 5. POST /api/task-status
      if (request.method === 'POST' && pathname === '/api/task-status') {
        const body = await request.json().catch(() => ({}));
        const { taskId, status } = body;
        if (!taskId || !status) {
          return jsonResponse({ ok: false, error: 'Missing taskId or status' }, 400);
        }

        const taskData = await getStoredTasks(env, token);
        const tasks = taskData.tasks || [];
        const target = tasks.find(t => t.id === taskId);
        if (target) {
          target.status = status;
          target.updatedAt = new Date().toISOString();
          const updatedPayload = { ...taskData, tasks };
          await saveStoredTasks(updatedPayload, env, token);
          return jsonResponse({ ok: true, task: target });
        } else {
          return jsonResponse({ ok: false, error: 'Task not found' }, 404);
        }
      }

      // 6. POST /api/ai/classify - Secure Edge Proxy for Jev System One
      if (request.method === 'POST' && pathname === '/api/ai/classify') {
        const body = await request.json().catch(() => ({}));
        const text = body.text || body.input || '';
        const apiKey = (env && env.JEV_API_KEY) || body.apiKey || '';
        if (!apiKey) return jsonResponse({ ok: false, error: 'Missing JEV_API_KEY' }, 401);
        if (!text) return jsonResponse({ ok: false, error: 'Missing announcement text' }, 400);

        try {
          const res = await fetch('https://api.typesafe.ai/v1/classify', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': 'Bearer ' + apiKey
            },
            body: JSON.stringify({
              input: text.slice(0, 3000),
              schema: {
                is_deadline: 'boolean',
                category: 'string',
                urgency: 'number',
                has_room: 'boolean',
                has_time: 'boolean'
              }
            })
          });
          const resData = await res.json().catch(() => null);
          return jsonResponse({ ok: res.ok, data: resData, status: res.status });
        } catch (e) {
          return jsonResponse({ ok: false, error: e.message }, 502);
        }
      }

      // 7. POST /api/ai/extract - Secure Edge Proxy for OpenRouter Generative AI
      if (request.method === 'POST' && pathname === '/api/ai/extract') {
        const body = await request.json().catch(() => ({}));
        const { text, context, model } = body;
        const apiKey = (env && env.OPENROUTER_API_KEY) || body.apiKey || '';
        if (!apiKey) return jsonResponse({ ok: false, error: 'Missing OPENROUTER_API_KEY' }, 401);
        if (!text) return jsonResponse({ ok: false, error: 'Missing announcement text' }, 400);

        try {
          const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': 'Bearer ' + apiKey,
              'HTTP-Referer': 'https://blackboard.sharjah.ac.ae',
              'X-Title': 'Blackboarder Edge Proxy'
            },
            body: JSON.stringify({
              model: model || 'google/gemini-3.8-flash',
              messages: [
                {
                  role: 'system',
                  content: 'You are an academic deadline extraction engine for Blackboard. Extract deadlines in strict JSON.'
                },
                {
                  role: 'user',
                  content: 'Context: ' + (context || '') + '\\nAnnouncement: ' + text
                }
              ],
              response_format: { type: 'json_object' }
            })
          });
          const resData = await res.json().catch(() => null);
          return jsonResponse({ ok: res.ok, data: resData, status: res.status });
        } catch (e) {
          return jsonResponse({ ok: false, error: e.message }, 502);
        }
      }

      // 8. GET /feed.ics or /cal.ics (RFC 5545 WebCal feed, token-scoped or global)
      if (request.method === 'GET' && (pathname === '/feed.ics' || pathname === '/cal.ics')) {
        const taskData = await getStoredTasks(env, token);

        const icsString = generateIcsFeed(taskData.tasks || [], {
          calendarName: token ? \`Blackboard Deadlines (\${token})\` : 'Blackboard Deadlines (UOS)',
          description: 'Live academic deadlines feed from Blackboarder Cloud'
        });

        return new Response(icsString, {
          status: 200,
          headers: {
            'Content-Type': 'text/calendar; charset=utf-8',
            'Content-Disposition': 'inline; filename="blackboard-feed.ics"',
            'Access-Control-Allow-Origin': '*',
            'Cache-Control': 'no-cache, must-revalidate',
            'X-Published-TTL': 'PT1H'
          }
        });
      }

      // 7. Static Mobile PWA Hosting
      let assetKey = pathname;
      if (assetKey === '/' || assetKey === '') assetKey = '/index.html';

      if (ASSETS[assetKey]) {
        const asset = ASSETS[assetKey];
        const isSw = assetKey === '/sw.js';
        const isHtml = assetKey === '/index.html';
        const headers = {
          'Content-Type': asset.contentType,
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': (isSw || isHtml) ? 'no-cache, no-store, must-revalidate' : 'public, max-age=3600'
        };
        if (isSw) {
          headers['Service-Worker-Allowed'] = '/';
        }
        return new Response(asset.content, {
          status: 200,
          headers
        });
      }

      // Fallback to index.html for SPA routing
      return new Response(ASSETS['/index.html'].content, {
        status: 200,
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'no-cache, no-store, must-revalidate'
        }
      });
    } catch (err) {
      return jsonResponse({ ok: false, error: err.message || 'Internal Edge Error' }, 500);
    }
  }
};
`;

fs.writeFileSync(OUTPUT_WORKER_PATH, workerTemplate, 'utf8');
console.log('✅ Successfully generated standalone cloudflare-worker/worker.js!');
