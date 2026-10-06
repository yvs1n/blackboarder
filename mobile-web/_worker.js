/**
 * Cloudflare Pages Function (Advanced Mode: _worker.js)
 * Automatically runs at https://yassinr-uossidekick.pages.dev
 * Handles API endpoints, live RFC 5545 calendar feed, and static assets.
 */

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

    const summary = courseLabel ? `[${courseLabel}] ${taskTitle}` : taskTitle;

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
    if (task.status === 'completed') {
      descParts.push('Status: Completed');
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
    
    if (task.status === 'completed') {
      lines.push('STATUS:COMPLETED');
    } else {
      lines.push('STATUS:CONFIRMED');
    }

    const category = (task.type || 'assignment').toUpperCase();
    lines.push(`CATEGORIES:${escapeIcsText(category)}`);

    if (task.priority === 'high') {
      lines.push('PRIORITY:1');
    } else if (task.priority === 'low') {
      lines.push('PRIORITY:9');
    } else {
      lines.push('PRIORITY:5');
    }

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

    lines.push('END:VEVENT');
  }

  lines.push('END:VCALENDAR');
  return lines.join('\r\n') + '\r\n';
}

const FIREBASE_DB_URL = 'https://blackboard-sidekick-default-rtdb.asia-southeast1.firebasedatabase.app';

// In-memory fallback
let memoryTasks = { tasks: [], lastSync: null };

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
          memoryTasks = fbData;
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
          memoryTasks = kvData;
          return kvData;
        }
      }
    } catch (e) {}
  }

  // 3. Fallback to memory
  return memoryTasks;
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
        body: JSON.stringify(payload)
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

    const syncKey = url.searchParams.get('key') || request.headers.get('x-sync-key') || '';

    // 2. GET /api/status
    if (request.method === 'GET' && pathname === '/api/status') {
      const taskData = await getStoredTasks(env, syncKey);
      return jsonResponse({
        ok: true,
        platform: 'Cloudflare Pages Functions + Firebase',
        firebaseDb: FIREBASE_DB_URL,
        totalTasks: (taskData.tasks || []).length,
        lastSync: taskData.lastSync,
        syncKey: syncKey || 'default',
        mobileUrl: url.origin + (syncKey ? `?key=${encodeURIComponent(syncKey)}` : ''),
        feedUrl: `${url.origin}/feed.ics${syncKey ? `?key=${encodeURIComponent(syncKey)}` : ''}`,
        webcalUrl: `webcal://${url.host}/feed.ics${syncKey ? `?key=${encodeURIComponent(syncKey)}` : ''}`
      });
    }

    // 3. GET /api/tasks
    if (request.method === 'GET' && pathname === '/api/tasks') {
      const taskData = await getStoredTasks(env, syncKey);
      return jsonResponse({
        ok: true,
        tasks: taskData.tasks || [],
        lastSync: taskData.lastSync,
        count: (taskData.tasks || []).length,
        syncKey: syncKey || 'default'
      });
    }

    // 4. POST /api/sync (Receives deadlines from Chrome Extension)
    if (request.method === 'POST' && pathname === '/api/sync') {
      const body = await request.json().catch(() => ({}));
      if (!Array.isArray(body.tasks)) {
        return jsonResponse({ ok: false, error: 'Expected tasks array in payload' }, 400);
      }

      const activeKey = syncKey || (body && body.syncKey) || '';
      const syncTimestamp = new Date().toISOString();
      const payload = {
        tasks: body.tasks,
        lastSync: syncTimestamp,
        device: body.device || 'Chrome Extension',
        count: body.tasks.length,
        syncKey: activeKey || undefined,
        // Keep quick links and deletion tombstones; dropping them here made deleted tasks reappear
        quickLinks: Array.isArray(body.quickLinks) ? body.quickLinks : undefined,
        tombstones: body.tombstones && typeof body.tombstones === 'object' ? body.tombstones : undefined
      };

      await saveStoredTasks(payload, env, activeKey);

      return jsonResponse({
        ok: true,
        count: body.tasks.length,
        lastSync: syncTimestamp,
        syncKey: activeKey || 'default',
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

      const activeKey = syncKey || (body && body.syncKey) || '';
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

    // 5b. POST /api/ai/classify - Edge Proxy for Jev System One
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

    // 5c. POST /api/ai/extract - Edge Proxy for OpenRouter Generative AI
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
            'X-Title': 'Blackboarder Pages Proxy'
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
        const resData = await res.json().catch(() => null);
        return jsonResponse({ ok: res.ok, data: resData, status: res.status });
      } catch (e) {
        return jsonResponse({ ok: false, error: e.message }, 502);
      }
    }

    // 6. GET /feed.ics or /cal.ics (RFC 5545 WebCal feed for Apple Calendar & Google Calendar)
    if (request.method === 'GET' && (pathname === '/feed.ics' || pathname === '/cal.ics')) {
      const taskData = await getStoredTasks(env, syncKey);

      const icsString = generateIcsFeed(taskData.tasks || [], {
        calendarName: syncKey ? `Blackboard Deadlines (${syncKey})` : 'Blackboard Deadlines (UOS)',
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

    // 7. Pass all other static requests (HTML, CSS, JS, icons) to Cloudflare Pages Assets
    if (env && env.ASSETS && typeof env.ASSETS.fetch === 'function') {
      const assetRes = await env.ASSETS.fetch(request);
      const isSw = pathname === '/sw.js';
      const isHtml = pathname === '/' || pathname === '/index.html';
      const isCode = pathname.endsWith('.js') || pathname.endsWith('.css');

      if (isSw || isHtml || isCode) {
        const newHeaders = new Headers(assetRes.headers);
        if (isSw || isHtml) {
          newHeaders.set('Cache-Control', 'no-cache, no-store, must-revalidate');
          if (isSw) newHeaders.set('Service-Worker-Allowed', '/');
        } else if (isCode) {
          newHeaders.set('Cache-Control', 'public, max-age=0, must-revalidate');
        }
        return new Response(assetRes.body, {
          status: assetRes.status,
          statusText: assetRes.statusText,
          headers: newHeaders
        });
      }
      return assetRes;
    }

    return new Response('Not Found', { status: 404 });
  }
};
