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
 *
 * Using the key also needs the AI pass: a random value only the extension and phones paired with
 * its link have (it travels after "#" in that link, which browsers never send to a server). Only
 * its hash is kept, inside the encrypted text. The sync key alone, which also sits in calendar
 * links, is not enough to spend the student's AI credit.
 */
const AI_PASS_PATTERN = /^[A-Za-z0-9_-]{32,128}$/;

async function sha256Hex(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(text)));
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
}

/** Same-length comparison that does not stop at the first different character. */
function sameText(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
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

/*
 * Web Push reminders. Phones (iPhone home screen apps included) cannot run checks while the app is
 * closed, so the server sends the reminder. Subscriptions live at users/{syncKey}/push, next to that
 * key's deadlines, and a reminder only ever goes to the subscriptions of the key whose deadline it is.
 * A scheduler (the "Push reminders" GitHub Action) calls POST /api/push/tick with PUSH_TICK_SECRET.
 * Needs VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY and VAPID_SUBJECT (made by `node scripts/vapid-keys.js`),
 * and FIREBASE_AUTH (a database secret) so the tick can find the keys that have subscriptions.
 * Payloads are encrypted for the phone (RFC 8291), so the push service never sees deadline titles.
 */
const PUSH_HOSTS = /^(fcm\.googleapis\.com|android\.googleapis\.com|updates\.push\.services\.mozilla\.com|[a-z0-9.-]+\.push\.apple\.com|[a-z0-9-]+\.notify\.windows\.com)$/;
const PUSH_MAX_SUBS = 10;
const PUSH_MAX_PER_SUB = 5;
const PUSH_SENT_KEEP_MS = 8 * 24 * 3600 * 1000;
const PUSH_FETCH_BUDGET = 40;

const b64url = (bytes) => b64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64url = (str) => unb64(String(str).replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((String(str).length + 3) % 4));
const concatBytes = (...parts) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let i = 0;
  for (const p of parts) { out.set(p, i); i += p.length; }
  return out;
};

function isPushConfigured(env) {
  return Boolean(env && env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY);
}

/** A subscription as the browser gives it, kept only when it points at a known push service. */
function cleanPushSubscription(sub) {
  if (!sub || typeof sub.endpoint !== 'string' || sub.endpoint.length > 1000) return null;
  let host;
  try {
    const u = new URL(sub.endpoint);
    if (u.protocol !== 'https:') return null;
    host = u.hostname;
  } catch {
    return null;
  }
  if (!PUSH_HOSTS.test(host)) return null;
  const keys = sub.keys || {};
  try {
    if (unb64url(keys.p256dh).length !== 65 || unb64url(keys.auth).length !== 16) return null;
  } catch {
    return null;
  }
  return { endpoint: sub.endpoint, keys: { p256dh: String(keys.p256dh), auth: String(keys.auth) } };
}

function cleanPushPrefs(body) {
  const num = (v, def, max) => {
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 && n <= max ? n : def;
  };
  return {
    advanceHours: num(body && body.advanceHours, 24, 168),
    urgentHours: num(body && body.urgentHours, 2, 24),
    dueAlertEnabled: !(body && body.dueAlertEnabled === false)
  };
}

async function pushSubId(endpoint) {
  return (await sha256Hex(endpoint)).slice(0, 24);
}

function pushStoreUrl(env, syncKey) {
  const dbUrl = (env && env.SKIP_FIREBASE) ? null : ((env && env.FIREBASE_DB_URL) || FIREBASE_DB_URL);
  return dbUrl ? `${dbUrl}/users/${syncKey}/push.json` : '';
}

async function readPush(env, syncKey) {
  const target = pushStoreUrl(env, syncKey);
  if (target) {
    const res = await fetch(target, { cache: 'no-store' });
    if (!res.ok) throw new Error(`push read failed (${res.status})`);
    const v = await res.json();
    return v && typeof v === 'object' ? v : null;
  }
  if (env && env.TASKS_KV) {
    const raw = await env.TASKS_KV.get(`bbs_push_${syncKey}`);
    return raw ? JSON.parse(raw) : null;
  }
  return null;
}

/** Saves the whole push record, or removes it when no subscription is left. */
async function writePush(env, syncKey, push) {
  const subs = (push && push.subs) || {};
  const count = Object.keys(subs).length;
  const value = count ? { count, subs, updatedAt: new Date().toISOString() } : null;
  const target = pushStoreUrl(env, syncKey);
  if (target) {
    const res = await fetch(target, value
      ? { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) }
      : { method: 'DELETE' });
    if (!res.ok) throw new Error(`push write failed (${res.status})`);
  }
  if (env && env.TASKS_KV) {
    if (value) await env.TASKS_KV.put(`bbs_push_${syncKey}`, JSON.stringify(value));
    else if (env.TASKS_KV.delete) await env.TASKS_KV.delete(`bbs_push_${syncKey}`);
  }
}

/**
 * Every sync key that has a subscription, with its push record and (from Firebase) its deadlines.
 * Firebase only answers this with FIREBASE_AUTH, because the rules never let anyone list keys.
 */
async function listPushUsers(env) {
  const dbUrl = (env && env.SKIP_FIREBASE) ? null : ((env && env.FIREBASE_DB_URL) || FIREBASE_DB_URL);
  if (dbUrl) {
    if (!env.FIREBASE_AUTH) throw new Error('FIREBASE_AUTH is not set');
    const q = `orderBy=${encodeURIComponent('"push/count"')}&startAt=1&auth=${encodeURIComponent(env.FIREBASE_AUTH)}`;
    const res = await fetch(`${dbUrl}/users.json?${q}`, { cache: 'no-store' });
    if (!res.ok) throw new Error(`push list failed (${res.status})`);
    const all = (await res.json()) || {};
    return Object.entries(all)
      .filter(([key, v]) => cleanSyncKey(key) === key && v && v.push && v.push.subs)
      .map(([key, v]) => ({ key, push: v.push, data: v.data || { tasks: [] } }));
  }
  if (env && env.TASKS_KV && env.TASKS_KV.list) {
    const listed = await env.TASKS_KV.list({ prefix: 'bbs_push_' });
    const out = [];
    for (const { name } of listed.keys || []) {
      const key = name.slice('bbs_push_'.length);
      if (cleanSyncKey(key) !== key) continue;
      const push = JSON.parse((await env.TASKS_KV.get(name)) || 'null');
      if (push && push.subs) out.push({ key, push });
    }
    return out;
  }
  return [];
}

/** Which reminder a deadline is in for these settings, with the same names the phone uses. */
function pushReminderFor(task, prefs, now) {
  if (!task || !task.id || task.status === 'completed') return null;
  const due = new Date(task.dueDate).getTime();
  if (isNaN(due)) return null;
  const left = due - now;
  const hour = 3600 * 1000;
  if (prefs.dueAlertEnabled && left <= 0 && left >= -hour) {
    return { key: `${task.id}_due`, label: 'due' };
  }
  if (prefs.urgentHours > 0 && left > 0 && left <= prefs.urgentHours * hour) {
    const h = prefs.urgentHours;
    return { key: `${task.id}_urg_${h}h`, label: h < 1 ? `${Math.round(h * 60)}m` : `${h}h` };
  }
  if (prefs.advanceHours > 0 && left > Math.max(prefs.urgentHours, 0) * hour && left <= prefs.advanceHours * hour) {
    const h = prefs.advanceHours;
    return { key: `${task.id}_adv_${h}h`, label: h >= 24 ? `${Math.round(h / 24)}d` : `${h}h` };
  }
  return null;
}

async function vapidAuthHeader(env, endpoint) {
  const pub = unb64url(env.VAPID_PUBLIC_KEY);
  const jwk = { kty: 'EC', crv: 'P-256', d: env.VAPID_PRIVATE_KEY, x: b64url(pub.slice(1, 33)), y: b64url(pub.slice(33, 65)), ext: true };
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const enc = (obj) => b64url(new TextEncoder().encode(JSON.stringify(obj)));
  const claims = {
    aud: new URL(endpoint).origin,
    exp: Math.floor(Date.now() / 1000) + 12 * 3600,
    sub: env.VAPID_SUBJECT || 'mailto:admin@blackboarder.invalid'
  };
  const unsigned = `${enc({ typ: 'JWT', alg: 'ES256' })}.${enc(claims)}`;
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, new TextEncoder().encode(unsigned));
  return `vapid t=${unsigned}.${b64url(sig)}, k=${env.VAPID_PUBLIC_KEY}`;
}

async function hkdf(salt, ikm, info, bytes) {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, bytes * 8));
}

/** Encrypts a payload for one subscription (aes128gcm, RFC 8188 and RFC 8291). */
async function encryptPushPayload(sub, text) {
  const uaPublic = unb64url(sub.keys.p256dh);
  const authSecret = unb64url(sub.keys.auth);
  const local = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', local.publicKey));
  const uaKey = await crypto.subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, local.privateKey, 256));
  const te = new TextEncoder();
  const ikm = await hkdf(authSecret, shared, concatBytes(te.encode('WebPush: info\0'), uaPublic, asPublic), 32);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, te.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, te.encode('Content-Encoding: nonce\0'), 12);
  const aes = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const plain = concatBytes(te.encode(text), new Uint8Array([2]));
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, aes, plain));
  const header = new Uint8Array(21);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, 4096);
  header[20] = asPublic.length;
  return concatBytes(header, asPublic, cipher);
}

async function sendWebPush(env, sub, message) {
  const body = await encryptPushPayload(sub, JSON.stringify(message));
  return fetch(sub.endpoint, {
    method: 'POST',
    headers: {
      'Authorization': await vapidAuthHeader(env, sub.endpoint),
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      'TTL': '3600',
      'Urgency': 'high'
    },
    body
  });
}

/** Only the fields a reminder shows, so a push never carries notes or marks. */
function pushTaskFields(t) {
  const s = (v, n) => (typeof v === 'string' ? v.slice(0, n) : undefined);
  return {
    id: s(t.id, 200), title: s(t.title, 200), dueDate: s(t.dueDate, 40), type: s(t.type, 30),
    courseName: s(t.courseName, 120), courseCode: s(t.courseCode, 40), room: s(t.room, 80),
    weight: typeof t.weight === 'number' ? t.weight : undefined
  };
}

/**
 * One pass of the scheduler: for every subscribed key, sends each reminder that is due and not
 * sent yet, remembers it (keys go through encodeKey, task ids can hold . # $ / [ ]) and drops
 * subscriptions the push service says are gone. Stops at PUSH_FETCH_BUDGET outgoing requests
 * (Cloudflare caps them per request) and reports `more`, so the scheduler calls again.
 */
async function runPushTick(env, now = Date.now()) {
  const users = await listPushUsers(env);
  let budget = PUSH_FETCH_BUDGET;
  const result = { users: users.length, sent: 0, removed: 0, failed: 0, more: false };
  for (const user of users) {
    if (budget <= 1) { result.more = true; break; }
    const data = user.data || await getStoredTasks(env, user.key);
    const tasks = Array.isArray(data.tasks) ? data.tasks : [];
    const subs = { ...user.push.subs };
    let changed = false;
    for (const [id, stored] of Object.entries(subs)) {
      const sub = cleanPushSubscription(stored);
      if (!sub) { delete subs[id]; changed = true; result.removed++; continue; }
      const prefs = cleanPushPrefs(stored);
      const sent = {};
      for (const [k, t] of Object.entries(stored.sent || {})) {
        if (typeof t === 'number' && now - t < PUSH_SENT_KEEP_MS) sent[k] = t;
      }
      if (Object.keys(sent).length !== Object.keys(stored.sent || {}).length) changed = true;
      let sentHere = 0;
      for (const task of tasks) {
        if (sentHere >= PUSH_MAX_PER_SUB) break;
        const r = pushReminderFor(task, prefs, now);
        if (!r || sent[encodeKey(r.key)]) continue;
        if (budget <= 1) { result.more = true; break; }
        budget--;
        let res;
        try {
          res = await sendWebPush(env, sub, { v: 1, key: r.key, label: r.label, task: pushTaskFields(task) });
        } catch (e) {
          result.failed++;
          continue;
        }
        if (res.status === 404 || res.status === 410) {
          delete subs[id];
          result.removed++;
          changed = true;
          break;
        }
        if (!res.ok) { result.failed++; continue; }
        sent[encodeKey(r.key)] = now;
        sentHere++;
        result.sent++;
        changed = true;
      }
      if (subs[id]) subs[id] = { ...stored, sent };
    }
    if (changed) {
      budget--;
      await writePush(env, user.key, { subs });
    }
  }
  return result;
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
      if (!AI_PASS_PATTERN.test(String(body.aiPass || ''))) {
        return jsonResponse({ ok: false, error: 'Missing AI pass' }, 400);
      }
      const passHash = await sha256Hex(body.aiPass);
      const sealed = await sealAiConfig({ provider, chatUrl, model, apiKey, passHash }, env.AI_KEY_SECRET, activeKey);
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
      const givenPass = String(body.aiPass || '');
      if (!config.passHash || !AI_PASS_PATTERN.test(givenPass) || !sameText(await sha256Hex(givenPass), config.passHash)) {
        return jsonResponse({ ok: false, error: 'AI pass missing or out of date. Open the pairing link from the extension again.' }, 403);
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

    // 5d. Web Push reminders (see the Web Push section above)
    if (request.method === 'GET' && pathname === '/api/push/key') {
      if (!isPushConfigured(env)) return jsonResponse({ ok: false, error: 'Push reminders are not set up on this server' }, 501);
      return jsonResponse({ ok: true, publicKey: env.VAPID_PUBLIC_KEY });
    }

    if (request.method === 'POST' && (pathname === '/api/push/subscribe' || pathname === '/api/push/unsubscribe')) {
      const body = await request.json().catch(() => ({}));
      const activeKey = syncKey || cleanSyncKey(body && body.syncKey);
      if (!activeKey) return jsonResponse({ ok: false, error: KEY_REQUIRED_MESSAGE }, 400);
      if (isRateLimited(request, activeKey, 10)) {
        return jsonResponse({ ok: false, error: 'Too many requests. Please slow down.' }, 429);
      }
      if (!isPushConfigured(env)) return jsonResponse({ ok: false, error: 'Push reminders are not set up on this server' }, 501);
      const subscribing = pathname === '/api/push/subscribe';
      const sub = subscribing ? cleanPushSubscription(body.subscription) : null;
      const endpoint = subscribing ? (sub && sub.endpoint) : (typeof body.endpoint === 'string' ? body.endpoint : '');
      if (!endpoint) return jsonResponse({ ok: false, error: 'Invalid push subscription' }, 400);
      try {
        const push = (await readPush(env, activeKey)) || {};
        const subs = { ...(push.subs || {}) };
        const id = await pushSubId(endpoint);
        if (subscribing) {
          // Reminders the phone already showed are marked sent, so they do not arrive twice
          const sent = { ...((subs[id] && subs[id].sent) || {}) };
          const reminded = Array.isArray(body.reminded) ? body.reminded.slice(0, 500) : [];
          for (const k of reminded) if (typeof k === 'string' && k.length <= 300) sent[encodeKey(k)] = Date.now();
          subs[id] = { ...sub, ...cleanPushPrefs(body), sent, createdAt: (subs[id] && subs[id].createdAt) || new Date().toISOString() };
          if (Object.keys(subs).length > PUSH_MAX_SUBS) {
            const oldest = Object.entries(subs).filter(([k]) => k !== id)
              .sort((a, b) => String(a[1].createdAt).localeCompare(String(b[1].createdAt)))[0];
            if (oldest) delete subs[oldest[0]];
          }
        } else {
          delete subs[id];
        }
        await writePush(env, activeKey, { subs });
        return jsonResponse({ ok: true, subscribed: subscribing, devices: Object.keys(subs).length });
      } catch (e) {
        console.error('Worker: push subscription save failed:', e);
        return jsonResponse({ ok: false, error: 'Could not save the push subscription' }, 502);
      }
    }

    if (request.method === 'POST' && pathname === '/api/push/tick') {
      const given = request.headers.get('x-tick-secret') || '';
      if (!env || !env.PUSH_TICK_SECRET || !sameText(given, env.PUSH_TICK_SECRET)) {
        return jsonResponse({ ok: false, error: 'Invalid tick secret' }, 401);
      }
      if (!isPushConfigured(env)) return jsonResponse({ ok: false, error: 'Push reminders are not set up on this server' }, 501);
      try {
        return jsonResponse({ ok: true, ...(await runPushTick(env)) });
      } catch (e) {
        console.error('Worker: push tick failed:', e);
        return jsonResponse({ ok: false, error: 'Push tick failed' }, 502);
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
