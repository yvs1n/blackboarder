import http from 'http';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';
import { generateIcsFeed } from './calendarFeed.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT || 3456;
const DATA_DIR = path.join(__dirname, 'data');
const TASKS_FILE = path.join(DATA_DIR, 'tasks.json');
const SUBS_FILE = path.join(DATA_DIR, 'subscriptions.json');
const STATIC_DIR = path.join(__dirname, '..', 'mobile-web');

// Ensure data directories exist
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Initial storage files
if (!fs.existsSync(TASKS_FILE)) {
  fs.writeFileSync(TASKS_FILE, JSON.stringify({ tasks: [], lastSync: null }, null, 2), 'utf8');
}
if (!fs.existsSync(SUBS_FILE)) {
  fs.writeFileSync(SUBS_FILE, JSON.stringify([], null, 2), 'utf8');
}

/**
 * Get primary local LAN IPv4 address for mobile access
 */
function getLocalIpAddress() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return 'localhost';
}

/**
 * MIME type dictionary for static files
 */
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
  '.ics': 'text/calendar; charset=utf-8'
};

/**
 * Read request body as JSON
 */
function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 5 * 1024 * 1024) { // 5MB guard
        reject(new Error('Payload too large'));
      }
    });
    req.on('end', () => {
      if (!body.trim()) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch (err) {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

/**
 * Send JSON response with CORS
 */
function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-sync-secret',
    'Cache-Control': 'no-cache, no-store, must-revalidate'
  });
  res.end(JSON.stringify(data));
}

/**
 * Load tasks safely
 */
function loadTasksData() {
  try {
    const raw = fs.readFileSync(TASKS_FILE, 'utf8');
    return JSON.parse(raw);
  } catch (e) {
    return { tasks: [], lastSync: null };
  }
}

/**
 * Save tasks safely
 */
function saveTasksData(data) {
  fs.writeFileSync(TASKS_FILE, JSON.stringify(data, null, 2), 'utf8');
}

/**
 * Main HTTP Request Handler
 */
const server = http.createServer(async (req, res) => {
  // Global CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-sync-secret',
      'Access-Control-Max-Age': '86400'
    });
    res.end();
    return;
  }

  const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = parsedUrl.pathname;

  try {
    // 1. GET /api/status - Health, stats, and network info
    if (req.method === 'GET' && pathname === '/api/status') {
      const data = loadTasksData();
      const localIp = getLocalIpAddress();
      return sendJson(res, 200, {
        ok: true,
        version: '1.0.0',
        totalTasks: (data.tasks || []).length,
        lastSync: data.lastSync,
        localIp,
        port: PORT,
        mobileUrl: `http://${localIp}:${PORT}`,
        feedUrl: `http://${localIp}:${PORT}/feed.ics`,
        webcalUrl: `webcal://${localIp}:${PORT}/feed.ics`
      });
    }

    // 2. GET /api/tasks - Returns tasks array for PWA
    if (req.method === 'GET' && pathname === '/api/tasks') {
      const data = loadTasksData();
      return sendJson(res, 200, {
        ok: true,
        tasks: data.tasks || [],
        lastSync: data.lastSync,
        count: (data.tasks || []).length,
        quickLinks: data.quickLinks || []
      });
    }

    // 3. POST /api/sync - Upload tasks from Chrome extension
    if (req.method === 'POST' && pathname === '/api/sync') {
      const body = await readJsonBody(req);
      if (!Array.isArray(body.tasks)) {
        return sendJson(res, 400, { ok: false, error: 'Expected tasks array in payload' });
      }

      const syncTimestamp = new Date().toISOString();
      const existing = loadTasksData();
      const payload = {
        tasks: body.tasks,
        lastSync: syncTimestamp,
        device: body.device || 'Chrome Extension',
        count: body.tasks.length,
        quickLinks: Array.isArray(body.quickLinks) ? body.quickLinks : (existing.quickLinks || [])
      };

      saveTasksData(payload);

      console.log(`[Sync] Received ${body.tasks.length} tasks from ${payload.device} at ${syncTimestamp}`);

      return sendJson(res, 200, {
        ok: true,
        count: body.tasks.length,
        lastSync: syncTimestamp,
        message: 'Tasks synchronized successfully',
        quickLinks: payload.quickLinks
      });
    }

    // 4. POST /api/task-status - Mark task completed/pending from mobile web
    if (req.method === 'POST' && pathname === '/api/task-status') {
      const body = await readJsonBody(req);
      const { taskId, status } = body;
      if (!taskId || !status) {
        return sendJson(res, 400, { ok: false, error: 'Missing taskId or status' });
      }

      const data = loadTasksData();
      const tasks = data.tasks || [];
      const target = tasks.find(t => t.id === taskId);
      if (target) {
        target.status = status;
        target.updatedAt = new Date().toISOString();
        saveTasksData({ ...data, tasks });
        return sendJson(res, 200, { ok: true, task: target });
      } else {
        return sendJson(res, 404, { ok: false, error: 'Task not found' });
      }
    }

    // 5. GET /feed.ics or /cal.ics - Live RFC 5545 WebCal Feed
    if (req.method === 'GET' && (pathname === '/feed.ics' || pathname === '/cal.ics')) {
      const data = loadTasksData();
      const icsString = generateIcsFeed(data.tasks || [], {
        calendarName: 'Blackboard Deadlines (UOS)',
        description: 'Live academic deadlines feed from Blackboarder'
      });

      res.writeHead(200, {
        'Content-Type': 'text/calendar; charset=utf-8',
        'Content-Disposition': 'inline; filename="blackboard-feed.ics"',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-cache, must-revalidate',
        'X-Published-TTL': 'PT1H'
      });
      res.end(icsString);
      return;
    }

    // 6. POST /api/push-subscribe - Register Web Push subscription
    if (req.method === 'POST' && pathname === '/api/push-subscribe') {
      const sub = await readJsonBody(req);
      if (!sub || !sub.endpoint) {
        return sendJson(res, 400, { ok: false, error: 'Invalid subscription object' });
      }

      let subs = [];
      try {
        subs = JSON.parse(fs.readFileSync(SUBS_FILE, 'utf8'));
      } catch (e) {}

      // Deduplicate by endpoint
      subs = subs.filter(s => s.endpoint !== sub.endpoint);
      subs.push({
        ...sub,
        registeredAt: new Date().toISOString()
      });

      fs.writeFileSync(SUBS_FILE, JSON.stringify(subs, null, 2), 'utf8');
      return sendJson(res, 200, { ok: true, message: 'Subscribed to notifications' });
    }

    // 7. POST /api/ai/classify - Local AI Proxy for Jev System One
    if (req.method === 'POST' && pathname === '/api/ai/classify') {
      const body = await readJsonBody(req);
      const text = body.text || body.input || '';
      const apiKey = process.env.JEV_API_KEY || body.apiKey || '';
      if (!apiKey) return sendJson(res, 401, { ok: false, error: 'Missing JEV_API_KEY' });
      if (!text) return sendJson(res, 400, { ok: false, error: 'Missing text' });

      try {
        const jevRes = await fetch('https://api.typesafe.ai/v1/classify', {
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
        const data = await jevRes.json().catch(() => null);
        return sendJson(res, jevRes.ok ? 200 : jevRes.status, { ok: jevRes.ok, data });
      } catch (err) {
        return sendJson(res, 502, { ok: false, error: err.message });
      }
    }

    // 8. POST /api/ai/extract - Local AI Proxy for OpenRouter Generative AI
    if (req.method === 'POST' && pathname === '/api/ai/extract') {
      const body = await readJsonBody(req);
      const { text, context, model } = body;
      const apiKey = process.env.OPENROUTER_API_KEY || body.apiKey || '';
      if (!apiKey) return sendJson(res, 401, { ok: false, error: 'Missing OPENROUTER_API_KEY' });
      if (!text) return sendJson(res, 400, { ok: false, error: 'Missing text' });

      try {
        const aiRes = await fetch('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + apiKey,
            'HTTP-Referer': 'https://blackboard.sharjah.ac.ae',
            'X-Title': 'Blackboarder Local Server'
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
                content: 'Context: ' + (context || '') + '\nAnnouncement: ' + text
              }
            ],
            response_format: { type: 'json_object' }
          })
        });
        const data = await aiRes.json().catch(() => null);
        return sendJson(res, aiRes.ok ? 200 : aiRes.status, { ok: aiRes.ok, data });
      } catch (err) {
        return sendJson(res, 502, { ok: false, error: err.message });
      }
    }

    // 7. Static File Serving for Mobile Web App (mobile-web/)
    let reqFilePath = pathname;
    if (reqFilePath === '/' || reqFilePath === '') {
      reqFilePath = '/index.html';
    }

    const safeSuffix = path.normalize(reqFilePath).replace(/^(\.\.[\/\\])+/, '');
    let fullFilePath = path.join(STATIC_DIR, safeSuffix);

    // If file doesn't exist or is a directory, fallback to index.html for SPA routing
    if (!fs.existsSync(fullFilePath) || fs.statSync(fullFilePath).isDirectory()) {
      fullFilePath = path.join(STATIC_DIR, 'index.html');
    }

    if (fs.existsSync(fullFilePath) && !fs.statSync(fullFilePath).isDirectory()) {
      const ext = path.extname(fullFilePath).toLowerCase();
      const mime = MIME_TYPES[ext] || 'application/octet-stream';

      const isSw = path.basename(fullFilePath).toLowerCase() === 'sw.js';
      const isHtml = ext === '.html';

      const content = fs.readFileSync(fullFilePath);
      const headers = {
        'Content-Type': mime,
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': (isSw || isHtml) ? 'no-cache, no-store, must-revalidate' : 'public, max-age=3600'
      };
      if (isSw) {
        headers['Service-Worker-Allowed'] = '/';
      }
      res.writeHead(200, headers);
      res.end(content);
      return;
    }

    // 404 handler
    sendJson(res, 404, { ok: false, error: 'Endpoint or file not found' });
  } catch (err) {
    console.error('Server error:', err);
    sendJson(res, 500, { ok: false, error: err.message || 'Internal Server Error' });
  }
});

const isTest = Boolean(process.env.VITEST) || process.env.NODE_ENV === 'test';

if (!isTest) {
  server.listen(PORT, '0.0.0.0', () => {
    const localIp = getLocalIpAddress();
    console.log('\n======================================================');
    console.log('⚡ Blackboarder - Mobile & Sync Bridge Running');
    console.log('======================================================');
    console.log(`Local Access:         http://localhost:${PORT}`);
    console.log(`Mobile Phone (Wi-Fi): http://${localIp}:${PORT}`);
    console.log(`WebCal Feed (Phone):  webcal://${localIp}:${PORT}/feed.ics`);
    console.log(`Sync API:             http://${localIp}:${PORT}/api/sync`);
    console.log('======================================================\n');
  });
}

export default server;
