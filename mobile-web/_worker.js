/**
 * Cloudflare Pages Function (Advanced Mode: _worker.js)
 * Automatically runs at https://blackboarder.pages.dev
 * Handles API endpoints, live RFC 5545 calendar feed, and static assets.
 */

// ---- calendar feed start: scripts/build.js copies this section into self-hosted/server/calendarFeed.js ----
function escapeIcsText(text) {
  if (!text) return '';
  return text
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\n|\r/g, '\\n');
}

function formatUtcTimestamp(date) {
  const pad = (n) => String(n).padStart(2, '0');
  const year = date.getUTCFullYear();
  const month = pad(date.getUTCMonth() + 1);
  const day = pad(date.getUTCDate());
  const hours = pad(date.getUTCHours());
  const minutes = pad(date.getUTCMinutes());
  const seconds = pad(date.getUTCSeconds());
  return `${year}${month}${day}T${hours}${minutes}${seconds}Z`;
}

function formatDateOnly(date) {
  const pad = (n) => String(n).padStart(2, '0');
  const year = date.getFullYear();
  const month = pad(date.getMonth() + 1);
  const day = pad(date.getDate());
  return `${year}${month}${day}`;
}

function generateIcsFeed(tasks = [], options = {}) {
  const calName = options.calendarName || 'Blackboard Deadlines (UOS)';
  const calDesc = options.description || 'Live automated deadline and exam feed from Blackboarder';
  const now = new Date();
  const nowUtc = formatUtcTimestamp(now);

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Blackboarder//UOS Calendar Feed//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeIcsText(calName)}`,
    `X-WR-CALDESC:${escapeIcsText(calDesc)}`,
    'X-WR-TIMEZONE:Asia/Dubai',
    'X-PUBLISHED-TTL:PT1H',
    'REFRESH-INTERVAL;VALUE=DURATION:PT1H'
  ];

  for (const task of tasks) {
    if (!task || !task.dueDate) continue;
    if (task.status === 'dismissed') continue;

    const dueDate = new Date(task.dueDate);
    if (isNaN(dueDate.getTime())) continue;

    const uid = `bbs-${task.id || Math.random().toString(36).substring(2)}@blackboarder`;

    // Resolve clean course label for Google/Apple Calendar summary
    let courseLabel = '';
    const rawName = (task.courseName || '').trim();
    const rawCode = (task.courseCode || '').trim();

    if (rawCode && !/^uos$/i.test(rawCode)) {
      courseLabel = rawCode;
    } else if (rawName && !/^uos$/i.test(rawName) && !/^general course$/i.test(rawName)) {
      if (/calculus|calc/i.test(rawName)) courseLabel = 'Calculus 1';
      else if (/intro.*comp|computer.*eng/i.test(rawName)) courseLabel = 'Intro to Comp Eng';
      else if (/phys(?:ics)?.*lab|lab.*phys|measuring density|free fall/i.test(rawName)) courseLabel = 'Physics 1 Lab';
      else if (/phys(?:ics)?\s*1/i.test(rawName)) courseLabel = 'Physics 1';
      else if (/english|eap/i.test(rawName)) courseLabel = 'English';
      else if (/islamic/i.test(rawName)) courseLabel = 'Islamic Culture';
      else courseLabel = rawName.split(/\s*[-–—|]\s*/)[0].trim();
    }

    // Refine title if generic 'Assignment'
    let taskTitle = task.title || 'Academic Task';
    if (taskTitle === 'Assignment') {
      if (/measuring\s*density/i.test(rawName)) taskTitle = 'Measuring Density - Lab Report';
      else if (/free\s*fall/i.test(rawName)) taskTitle = 'Free Fall Exp. - Lab Report';
    }

    const isCompleted = task.status === 'completed';
    const baseSummary = courseLabel ? `[${courseLabel}] ${taskTitle}` : taskTitle;
    const summary = isCompleted ? `✓ ${baseSummary} (Done)` : baseSummary;

    const descParts = [];
    if (task.courseName) {
      descParts.push(`Course: ${task.courseName} (${task.courseCode || ''})`);
    }
    if (task.weightDisplay || task.weight) {
      descParts.push(`Weight: ${task.weightDisplay || `${task.weight}% of Grade`}`);
    }
    if (task.syllabusNote) {
      descParts.push(`Syllabus Note: ${task.syllabusNote}`);
    }
    if (task.room) {
      descParts.push(`Room: ${task.room}`);
    }
    if (isCompleted) {
      descParts.push('Status: Completed (Done)');
    } else {
      descParts.push('Status: Pending');
    }
    if (task.notes) {
      descParts.push(`Student Notes: ${task.notes}`);
    }
    const announcement = task.sourceSnippet || task.description;
    if (announcement) {
      descParts.push(`\nDoctor's Announcement:\n"${announcement}"`);
    }

    const description = descParts.join('\n');

    lines.push('BEGIN:VEVENT');
    lines.push(`UID:${uid}`);
    lines.push(`DTSTAMP:${nowUtc}`);

    if (task.hasSpecificTime) {
      const startDate = dueDate;
      const endDate = new Date(startDate.getTime() + 60 * 60 * 1000);
      lines.push(`DTSTART:${formatUtcTimestamp(startDate)}`);
      lines.push(`DTEND:${formatUtcTimestamp(endDate)}`);
    } else {
      const startDateStr = formatDateOnly(dueDate);
      const nextDay = new Date(dueDate.getFullYear(), dueDate.getMonth(), dueDate.getDate() + 1);
      const endDateStr = formatDateOnly(nextDay);
      lines.push(`DTSTART;VALUE=DATE:${startDateStr}`);
      lines.push(`DTEND;VALUE=DATE:${endDateStr}`);
    }

    lines.push(`SUMMARY:${escapeIcsText(summary)}`);
    if (task.room) {
      lines.push(`LOCATION:${escapeIcsText(task.room)}`);
    }
    lines.push(`DESCRIPTION:${escapeIcsText(description)}`);
    
    // RFC 5545 only allows TENTATIVE/CONFIRMED/CANCELLED on events (COMPLETED is for to-dos);
    // completion is shown by the check mark and "(Done)" in the summary.
    lines.push('STATUS:CONFIRMED');

    const category = (task.type || 'assignment').toUpperCase();
    lines.push(`CATEGORIES:${escapeIcsText(category)}`);

    if (task.priority === 'high') {
      lines.push('PRIORITY:1');
    } else if (task.priority === 'low') {
      lines.push('PRIORITY:9');
    } else {
      lines.push('PRIORITY:5');
    }

    // Alarms (VALARM): 24 hours before and 2 hours before - suppressed if completed
    if (!isCompleted) {
      lines.push('BEGIN:VALARM');
      lines.push('ACTION:DISPLAY');
      lines.push(`DESCRIPTION:${escapeIcsText(`Upcoming: ${summary}`)}`);
      lines.push('TRIGGER:-P1D');
      lines.push('END:VALARM');

      lines.push('BEGIN:VALARM');
      lines.push('ACTION:DISPLAY');
      lines.push(`DESCRIPTION:${escapeIcsText(`Due in 2 hours: ${summary}`)}`);
      lines.push('TRIGGER:-PT2H');
      lines.push('END:VALARM');
    }

    lines.push('END:VEVENT');
  }

  lines.push('END:VCALENDAR');
  return lines.join('\r\n') + '\r\n';
}

// ---- calendar feed end ----

const FIREBASE_DB_URL = 'https://blackboard-sidekick-default-rtdb.asia-southeast1.firebasedatabase.app';

// Firebase refuses keys with . $ # [ ] / ; deletion records are keyed by task id, so keys are encoded in Firebase
const encodeKey = (k) => { const e = String(k).replace(/[%.$#\[\]/]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')); return e === '' ? '%00' : e; };
const decodeKey = (k) => k === '%00' ? '' : String(k).replace(/%(25|2E|24|23|5B|5D|2F)/gi, (_, h) => String.fromCharCode(parseInt(h, 16)));
const mapKeys = (m, fn) => { if (!m || typeof m !== 'object') return m; const o = {}; for (const [k, v] of Object.entries(m)) o[fn(k)] = v; return o; };

// In-memory fallback, kept per sync key so one user's data can never be served to another
const memoryByKey = new Map();
const memKey = (cleanKey) => cleanKey || '__default__';
const emptyTasks = () => ({ tasks: [], lastSync: null });

// When SYNC_SECRET is configured, writes must carry a matching x-sync-secret header
function isAuthorizedWrite(request, env) {
  if (!env || !env.SYNC_SECRET) return true;
  return request.headers.get('x-sync-secret') === env.SYNC_SECRET;
}

async function getStoredTasks(env, syncKey = '') {
  const dbUrl = (env && env.SKIP_FIREBASE) ? null : ((env && env.FIREBASE_DB_URL) || FIREBASE_DB_URL);
  const cleanKey = (syncKey || '').trim().replace(/[^a-zA-Z0-9_-]/g, '');

  // 1. Fetch from Firebase Realtime Database
  if (dbUrl) {
    try {
      const targetUrl = cleanKey ? `${dbUrl}/users/${cleanKey}/data.json` : `${dbUrl}/data.json`;
      const fbRes = await fetch(targetUrl, {
        cache: 'no-store'
      });
      if (fbRes.ok) {
        const fbData = await fbRes.json();
        if (fbData && Array.isArray(fbData.tasks)) {
          if (fbData.tombstones) fbData.tombstones = mapKeys(fbData.tombstones, decodeKey);
          memoryByKey.set(memKey(cleanKey), fbData);
          return fbData;
        }
      }
    } catch (err) {
      console.warn('Worker: Firebase fetch error, falling back:', err);
    }
  }

  // 2. Fetch from Cloudflare KV if bound
  if (env && env.TASKS_KV) {
    try {
      const kvKey = cleanKey ? `bbs_tasks_${cleanKey}` : 'bbs_tasks';
      const raw = await env.TASKS_KV.get(kvKey);
      if (raw) {
        const kvData = JSON.parse(raw);
        if (kvData && Array.isArray(kvData.tasks)) {
          memoryByKey.set(memKey(cleanKey), kvData);
          return kvData;
        }
      }
    } catch (e) {}
  }

  // 3. Fallback to memory (scoped to this key)
  return memoryByKey.get(memKey(cleanKey)) || emptyTasks();
}

async function saveStoredTasks(payload, env, syncKey = '') {
  const dbUrl = (env && env.SKIP_FIREBASE) ? null : ((env && env.FIREBASE_DB_URL) || FIREBASE_DB_URL);
  const cleanKey = (syncKey || '').trim().replace(/[^a-zA-Z0-9_-]/g, '');

  // 1. Save to Firebase Realtime Database
  if (dbUrl) {
    try {
      const targetUrl = cleanKey ? `${dbUrl}/users/${cleanKey}/data.json` : `${dbUrl}/data.json`;
      await fetch(targetUrl, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload.tombstones ? { ...payload, tombstones: mapKeys(payload.tombstones, encodeKey) } : payload)
      });
    } catch (err) {
      console.warn('Worker: Firebase save error:', err);
    }
  }

  // 2. Save to Cloudflare KV if bound
  if (env && env.TASKS_KV) {
    try {
      const kvKey = cleanKey ? `bbs_tasks_${cleanKey}` : 'bbs_tasks';
      await env.TASKS_KV.put(kvKey, JSON.stringify(payload));
    } catch (e) {}
  }

  // 3. Keep in memory
  memoryByKey.set(memKey(cleanKey), payload);
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

const rateLimitMap = new Map();
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX = 60;

function checkRateLimit(key, max = RATE_LIMIT_MAX) {
  const now = Date.now();
  if (rateLimitMap.size > 10000) rateLimitMap.clear();
  const entry = rateLimitMap.get(key);
  if (!entry || now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
    rateLimitMap.set(key, { windowStart: now, count: 1 });
    return true;
  }
  entry.count++;
  return entry.count <= max;
}

/** A usable sync key (the same rule as database.rules.json), or '' when missing or malformed. */
function cleanSyncKey(raw) {
  const key = String(raw || '').trim();
  return /^[A-Za-z0-9_-]{8,64}$/.test(key) ? key : '';
}

function clientIpOf(request) {
  return request.headers.get('cf-connecting-ip') || request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
}

/*
 * Limits each IP, and each sync key, separately: counting only per key would let someone guessing
 * keys try a new key on every request. This map lives in one worker instance, so it slows abuse
 * down rather than stopping it; add a Cloudflare rate limiting rule for hard limits.
 */
function isRateLimited(request, key, maxPerIp = RATE_LIMIT_MAX) {
  if (!checkRateLimit(`ip_${clientIpOf(request)}`, maxPerIp)) return true;
  return Boolean(key) && !checkRateLimit(`key_${key}`);
}

/*
 * AI key locker. The extension sends its AI key here once; it is encrypted with AI_KEY_SECRET
 * (a server setting nobody else has) mixed with the sync key, and only the encrypted text is
 * stored, at users/{syncKey}/ai. The web app never holds the key: it sends the prompt here and
 * the server adds the key. Without AI_KEY_SECRET the locker is off and the web app uses its
 * built-in parser.
 */
const AI_CHAT_URLS = {
  openrouter: 'https://openrouter.ai/api/v1/chat/completions',
  ifm: 'https://api.ifm.ai/v1/chat/completions'
};
const b64 = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes)));
const unb64 = (str) => Uint8Array.from(atob(str), c => c.charCodeAt(0));

async function aiLockKey(secret, syncKey) {
  const raw = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${secret}|${syncKey}`));
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

async function sealAiConfig(config, secret, syncKey) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await aiLockKey(secret, syncKey);
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(config)));
  return `v1:${b64(iv)}:${b64(ct)}`;
}

async function openAiConfig(sealed, secret, syncKey) {
  const [v, iv, ct] = String(sealed || '').split(':');
  if (v !== 'v1' || !iv || !ct) return null;
  try {
    const key = await aiLockKey(secret, syncKey);
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(iv) }, key, unb64(ct));
    return JSON.parse(new TextDecoder().decode(plain));
  } catch {
    return null;
  }
}

/** The provider's chat URL. A custom one must be public https; the server cannot reach a home computer. */
function aiChatUrlFor(provider, baseUrl) {
  if (AI_CHAT_URLS[provider]) return AI_CHAT_URLS[provider];
  if (provider !== 'custom') return '';
  try {
    const u = new URL(String(baseUrl || '').trim());
    if (u.protocol !== 'https:' || /^(localhost|127\.|10\.|192\.168\.|\[)/.test(u.hostname)) return '';
    return `${u.origin}${u.pathname.replace(/\/+$/, '').replace(/\/chat\/completions$/i, '')}/chat/completions`;
  } catch {
    return '';
  }
}

function aiStoreUrl(env, syncKey) {
  const dbUrl = (env && env.SKIP_FIREBASE) ? null : ((env && env.FIREBASE_DB_URL) || FIREBASE_DB_URL);
  return dbUrl ? `${dbUrl}/users/${syncKey}/ai.json` : '';
}

async function readSealedAi(env, syncKey) {
  const target = aiStoreUrl(env, syncKey);
  if (target) {
    try {
      const res = await fetch(target, { cache: 'no-store' });
      if (res.ok) {
        const v = await res.json();
        if (typeof v === 'string') return v;
      }
    } catch (e) {}
  }
  if (env && env.TASKS_KV) {
    try { return await env.TASKS_KV.get(`bbs_ai_${syncKey}`); } catch (e) {}
  }
  return null;
}

async function writeSealedAi(env, syncKey, sealed) {
  const target = aiStoreUrl(env, syncKey);
  if (target) {
    await fetch(target, sealed
      ? { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(sealed) }
      : { method: 'DELETE' });
  }
  if (env && env.TASKS_KV) {
    try {
      if (sealed) await env.TASKS_KV.put(`bbs_ai_${syncKey}`, sealed);
      else await env.TASKS_KV.delete(`bbs_ai_${syncKey}`);
    } catch (e) {}
  }
}

/** Only a system and a user message of plain text are forwarded, never anything else from the caller. */
function cleanAiMessages(messages) {
  if (!Array.isArray(messages) || messages.length === 0 || messages.length > 4) return null;
  let total = 0;
  const out = [];
  for (const m of messages) {
    if (!m || (m.role !== 'system' && m.role !== 'user') || typeof m.content !== 'string') return null;
    total += m.content.length;
    out.push({ role: m.role, content: m.content });
  }
  return total <= 20000 ? out : null;
}

const KEY_REQUIRED_MESSAGE = 'A sync key is required. Pair this device from Settings in the Blackboarder extension.';

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

    const syncKey = cleanSyncKey(url.searchParams.get('key') || request.headers.get('x-sync-key') || '');

    // 2. GET /api/status
    if (request.method === 'GET' && pathname === '/api/status') {
      if (isRateLimited(request, syncKey)) return jsonResponse({ ok: false, error: 'Too many requests. Please slow down.' }, 429);
      const taskData = syncKey ? await getStoredTasks(env, syncKey) : emptyTasks();
      return jsonResponse({
        ok: true,
        platform: 'Cloudflare Pages Functions + Firebase',
        paired: Boolean(syncKey),
        totalTasks: (taskData.tasks || []).length,
        lastSync: taskData.lastSync,
        mobileUrl: url.origin + (syncKey ? `?key=${encodeURIComponent(syncKey)}` : ''),
        feedUrl: `${url.origin}/feed.ics${syncKey ? `?key=${encodeURIComponent(syncKey)}` : ''}`,
        webcalUrl: `webcal://${url.host}/feed.ics${syncKey ? `?key=${encodeURIComponent(syncKey)}` : ''}`
      });
    }

    // 3. GET /api/tasks
    if (request.method === 'GET' && pathname === '/api/tasks') {
      if (!syncKey) return jsonResponse({ ok: false, error: KEY_REQUIRED_MESSAGE }, 400);
      if (isRateLimited(request, syncKey, 120)) return jsonResponse({ ok: false, error: 'Too many requests. Please slow down.' }, 429);
      const taskData = await getStoredTasks(env, syncKey);
      return jsonResponse({
        ok: true,
        tasks: taskData.tasks || [],
        courses: taskData.courses || undefined,
        coursesUpdatedAt: taskData.coursesUpdatedAt || undefined,
        quickLinks: taskData.quickLinks || undefined,
        lastSync: taskData.lastSync,
        count: (taskData.tasks || []).length,
        syncKey
      });
    }

    // 4. POST /api/sync (Receives deadlines from Chrome Extension)
    if (request.method === 'POST' && pathname === '/api/sync') {
      const body = await request.json().catch(() => ({}));
      const activeKey = syncKey || cleanSyncKey(body && body.syncKey);
      if (!activeKey) return jsonResponse({ ok: false, error: KEY_REQUIRED_MESSAGE }, 400);
      if (isRateLimited(request, activeKey)) {
        return jsonResponse({ ok: false, error: 'Too many requests. Please slow down.' }, 429);
      }
      if (!Array.isArray(body.tasks)) {
        return jsonResponse({ ok: false, error: 'Expected tasks array in payload' }, 400);
      }

      if (!isAuthorizedWrite(request, env)) {
        return jsonResponse({ ok: false, error: 'Invalid sync secret' }, 401);
      }


      const syncTimestamp = new Date().toISOString();
      const existing = await getStoredTasks(env, activeKey);
      const payload = {
        tasks: body.tasks,
        lastSync: syncTimestamp,
        device: body.device || 'Chrome Extension',
        count: body.tasks.length,
        syncKey: activeKey,
        // Keep quick links and deletion tombstones; dropping them here made deleted tasks reappear
        // Fields the caller did not send are kept from the stored copy instead of being wiped
        quickLinks: Array.isArray(body.quickLinks) ? body.quickLinks : existing.quickLinks,
        courses: Array.isArray(body.courses) ? body.courses : existing.courses,
        coursesUpdatedAt: body.coursesUpdatedAt || existing.coursesUpdatedAt,
        tombstones: body.tombstones && typeof body.tombstones === 'object' ? body.tombstones : existing.tombstones
      };

      await saveStoredTasks(payload, env, activeKey);

      return jsonResponse({
        ok: true,
        count: body.tasks.length,
        lastSync: syncTimestamp,
        syncKey: activeKey,
        message: 'Synchronized successfully to Firebase Realtime Database'
      });
    }

    // 5. POST /api/task-status
    if (request.method === 'POST' && pathname === '/api/task-status') {
      const body = await request.json().catch(() => ({}));
      const activeKey = syncKey || cleanSyncKey(body && body.syncKey);
      if (!activeKey) return jsonResponse({ ok: false, error: KEY_REQUIRED_MESSAGE }, 400);
      if (isRateLimited(request, activeKey)) {
        return jsonResponse({ ok: false, error: 'Too many requests. Please slow down.' }, 429);
      }
      const { taskId, status } = body;
      if (!taskId || !status) {
        return jsonResponse({ ok: false, error: 'Missing taskId or status' }, 400);
      }
      if (!isAuthorizedWrite(request, env)) {
        return jsonResponse({ ok: false, error: 'Invalid sync secret' }, 401);
      }


      const taskData = await getStoredTasks(env, activeKey);
      const tasks = taskData.tasks || [];
      const target = tasks.find(t => t.id === taskId);
      if (target) {
        target.status = status;
        target.updatedAt = new Date().toISOString();
        const updatedPayload = { ...taskData, tasks };
        await saveStoredTasks(updatedPayload, env, activeKey);
        return jsonResponse({ ok: true, task: target });
      } else {
        return jsonResponse({ ok: false, error: 'Task not found' }, 404);
      }
    }

    // 5b. POST /api/ai/key - the extension locks its AI key here (see the AI key locker above)
    if (request.method === 'POST' && pathname === '/api/ai/key') {
      const body = await request.json().catch(() => ({}));
      const activeKey = syncKey || cleanSyncKey(body && body.syncKey);
      if (!activeKey) return jsonResponse({ ok: false, error: KEY_REQUIRED_MESSAGE }, 400);
      if (isRateLimited(request, activeKey, 10)) {
        return jsonResponse({ ok: false, error: 'Too many requests. Please slow down.' }, 429);
      }
      if (!isAuthorizedWrite(request, env)) {
        return jsonResponse({ ok: false, error: 'Invalid sync secret' }, 401);
      }
      if (!env || !env.AI_KEY_SECRET) {
        return jsonResponse({ ok: false, error: 'AI_KEY_SECRET is not set on this server' }, 501);
      }
      const apiKey = typeof body.apiKey === 'string' ? body.apiKey.trim() : '';
      if (!apiKey) {
        await writeSealedAi(env, activeKey, null);
        return jsonResponse({ ok: true, cleared: true });
      }
      const provider = String(body.provider || 'openrouter');
      const chatUrl = aiChatUrlFor(provider, body.baseUrl);
      const model = typeof body.model === 'string' ? body.model.trim().slice(0, 200) : '';
      if (!chatUrl || !model || apiKey.length > 500) {
        return jsonResponse({ ok: false, error: 'Unsupported AI provider, URL or model' }, 400);
      }
      const sealed = await sealAiConfig({ provider, chatUrl, model, apiKey }, env.AI_KEY_SECRET, activeKey);
      await writeSealedAi(env, activeKey, sealed);
      return jsonResponse({ ok: true, provider, model });
    }

    // 5c. POST /api/ai/extract - runs the extension's prompt for the web app with the locked key
    if (request.method === 'POST' && pathname === '/api/ai/extract') {
      const body = await request.json().catch(() => ({}));
      const activeKey = syncKey || cleanSyncKey(body && body.syncKey);
      if (!activeKey) return jsonResponse({ ok: false, error: KEY_REQUIRED_MESSAGE }, 400);
      if (isRateLimited(request, activeKey, 20)) {
        return jsonResponse({ ok: false, error: 'Too many requests. Please slow down.' }, 429);
      }
      if (!env || !env.AI_KEY_SECRET) {
        return jsonResponse({ ok: false, error: 'AI is not set up on this server' }, 501);
      }
      const messages = cleanAiMessages(body.messages);
      if (!messages) return jsonResponse({ ok: false, error: 'Invalid messages' }, 400);
      const config = await openAiConfig(await readSealedAi(env, activeKey), env.AI_KEY_SECRET, activeKey);
      if (!config || !config.apiKey) {
        return jsonResponse({ ok: false, error: 'No AI key set in the extension' }, 404);
      }
      // The URL is checked again so a stored value can never point the server somewhere else
      const chatUrl = aiChatUrlFor(config.provider, config.chatUrl);
      if (!chatUrl) return jsonResponse({ ok: false, error: 'Unsupported AI provider' }, 400);

      const payload = {
        model: config.model,
        messages,
        temperature: typeof body.temperature === 'number' ? Math.min(Math.max(body.temperature, 0), 1) : 0.1,
        max_tokens: Math.min(Number(body.max_tokens) || 1000, 4000),
        response_format: { type: 'json_object' }
      };
      const headers = { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + config.apiKey };
      if (config.provider === 'openrouter') {
        headers['HTTP-Referer'] = 'https://blackboarder.local';
        headers['X-Title'] = 'Blackboarder Web App';
      }
      try {
        let res = await fetch(chatUrl, { method: 'POST', headers, body: JSON.stringify(payload) });
        // Some OpenAI-compatible services refuse JSON mode; ask again without it
        if (res.status === 400 && config.provider !== 'openrouter') {
          const { response_format: _omit, ...plain } = payload;
          res = await fetch(chatUrl, { method: 'POST', headers, body: JSON.stringify(plain) });
        }
        const resData = await res.json().catch(() => null);
        return jsonResponse({ ok: res.ok, data: resData, status: res.status }, res.ok ? 200 : 502);
      } catch (e) {
        return jsonResponse({ ok: false, error: 'Could not reach the AI provider' }, 502);
      }
    }

    // 6. GET /feed.ics or /cal.ics (RFC 5545 WebCal feed for Apple Calendar & Google Calendar)
    if (request.method === 'GET' && (pathname === '/feed.ics' || pathname === '/cal.ics')) {
      if (!syncKey) {
        return new Response(KEY_REQUIRED_MESSAGE + ' Then copy the calendar link from the app.', {
          status: 400,
          headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Access-Control-Allow-Origin': '*' }
        });
      }
      // Calendar services fetch from shared IPs, so the feed is limited per key only
      if (!checkRateLimit(`feed_${syncKey}`)) return new Response('Too many requests', { status: 429 });
      const taskData = await getStoredTasks(env, syncKey);

      const icsString = generateIcsFeed(taskData.tasks || [], {
        calendarName: `Blackboard Deadlines (${syncKey})`,
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

        // 7. SEO: robots.txt and sitemap.xml
    if (request.method === 'GET' && pathname === '/robots.txt') {
      const robotsTxt = '# Robots.txt for Blackboarder\nUser-agent: *\nAllow: /\nAllow: /companion/\nDisallow: /api/\n\nSitemap: https://blackboarder.pages.dev/sitemap.xml\n';
      return new Response(robotsTxt, {
        status: 200,
        headers: {
          'Content-Type': 'text/plain; charset=utf-8',
          'Cache-Control': 'public, max-age=86400',
          'X-Content-Type-Options': 'nosniff'
        }
      });
    }

    if (request.method === 'GET' && pathname === '/sitemap.xml') {
      const sitemapXml = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url>\n    <loc>https://blackboarder.pages.dev/</loc>\n    <lastmod>2026-10-23</lastmod>\n    <changefreq>weekly</changefreq>\n    <priority>1.0</priority>\n  </url>\n  <url>\n    <loc>https://blackboarder.pages.dev/companion/</loc>\n    <lastmod>2026-10-23</lastmod>\n    <changefreq>daily</changefreq>\n    <priority>0.9</priority>\n  </url>\n</urlset>\n';
      return new Response(sitemapXml, {
        status: 200,
        headers: {
          'Content-Type': 'application/xml; charset=utf-8',
          'Cache-Control': 'public, max-age=86400',
          'X-Content-Type-Options': 'nosniff'
        }
      });
    }

    // 8. The landing page lives at /, the companion at /companion/. Pairing links made before the
    //    move (/?key=...) and the old installed app's start page go to the companion.
    if (request.method === 'GET' && (pathname === '/' || pathname === '/index.html') &&
        (url.searchParams.has('key') || url.searchParams.has('sync') || url.searchParams.has('code'))) {
      return Response.redirect(`${url.origin}/companion/${url.search}`, 302);
    }

    // 9. Pass all other static requests (HTML, CSS, JS, icons) to Cloudflare Pages Assets
    if (env && env.ASSETS && typeof env.ASSETS.fetch === 'function') {
      const assetRes = await env.ASSETS.fetch(request);
            const isSw = pathname === '/sw.js' || pathname === '/companion/sw.js';
      const isHtml = pathname === '/' || pathname === '/index.html' || pathname === '/companion/' || pathname === '/companion/index.html';
      const isCode = pathname.endsWith('.js') || pathname.endsWith('.css');
      const isFont = pathname.endsWith('.woff2');
      const isMedia = pathname.endsWith('.png') || pathname.endsWith('.ico') || pathname.endsWith('.svg');

      const newHeaders = new Headers(assetRes.headers);
      newHeaders.set('X-Content-Type-Options', 'nosniff');
      newHeaders.set('Referrer-Policy', 'strict-origin-when-cross-origin');

      if (isSw) {
        newHeaders.set('Cache-Control', 'no-cache, no-store, must-revalidate');
      } else if (isHtml) {
        newHeaders.set('Cache-Control', 'no-cache, must-revalidate');
      } else if (isCode) {
        newHeaders.set('Cache-Control', 'public, max-age=0, must-revalidate');
      } else if (isFont || isMedia) {
        newHeaders.set('Cache-Control', 'public, max-age=31536000, immutable');
      }

      return new Response(assetRes.body, {
        status: assetRes.status,
        statusText: assetRes.statusText,
        headers: newHeaders
      });
    }

    return new Response('Not Found', { status: 404 });
  }
};
