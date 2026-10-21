import fs from 'fs';
import path from 'path';

const FIREBASE_DB_URL = 'https://blackboard-sidekick-default-rtdb.asia-southeast1.firebasedatabase.app';

// Simple sliding-window in-memory rate limiter per IP / syncKey (max 60 req / minute)
const rateLimitMap = new Map();
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX = 60;

function isRateLimited(identifier) {
  const now = Date.now();
  const entry = rateLimitMap.get(identifier);
  if (!entry || now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
    rateLimitMap.set(identifier, { windowStart: now, count: 1 });
    return false;
  }
  entry.count++;
  if (entry.count > RATE_LIMIT_MAX) {
    return true;
  }
  return false;
}

// Periodic cleanup of rate limiter map
if (typeof setInterval !== 'undefined') {
  setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of rateLimitMap.entries()) {
      if (now - entry.windowStart > RATE_LIMIT_WINDOW_MS * 2) {
        rateLimitMap.delete(key);
      }
    }
  }, 5 * 60 * 1000);
}

export default async function handler(req, res) {
  // CORS Preflight
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-sync-secret');
    return res.status(204).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  // Rate limiting
  const clientIp = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || 'anonymous';
  const rawKey = req.query?.key || req.query?.sync || req.body?.syncKey || '';
  const cleanKey = String(rawKey).trim().replace(/[^a-zA-Z0-9_-]/g, '');
  const rateLimitKey = cleanKey ? `key_${cleanKey}` : `ip_${clientIp}`;

  if (isRateLimited(rateLimitKey)) {
    res.setHeader('Retry-After', '60');
    return res.status(429).json({ ok: false, error: 'Too many requests. Please slow down.' });
  }

  // Secret verification if configured
  if (process.env.SYNC_SECRET && req.headers['x-sync-secret'] !== process.env.SYNC_SECRET) {
    return res.status(401).json({ ok: false, error: 'Invalid sync secret' });
  }

  const body = req.body || {};
  if (!Array.isArray(body.tasks)) {
    return res.status(400).json({ ok: false, error: 'Expected tasks array in payload' });
  }

  if (body.tasks.length > 500) {
    return res.status(400).json({ ok: false, error: 'Payload exceeds maximum limit of 500 tasks' });
  }

  const syncTimestamp = new Date().toISOString();
  const payload = {
    tasks: body.tasks,
    courses: Array.isArray(body.courses) ? body.courses : [],
    lastSync: syncTimestamp,
    device: String(body.device || 'Chrome Extension').slice(0, 50),
    count: body.tasks.length,
    syncKey: cleanKey || undefined
  };

  // 1. Sync to Firebase user namespace if key provided
  if (cleanKey) {
    try {
      await fetch(`${FIREBASE_DB_URL}/users/${cleanKey}/data.json`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
    } catch (e) {
      console.warn('Failed to save to Firebase user namespace:', e);
    }
  }

  // 2. If Upstash Redis / Vercel KV is configured
  if (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) {
    try {
      const redisKey = cleanKey ? `bbs_tasks_${cleanKey}` : 'bbs_tasks';
      await fetch(`${process.env.KV_REST_API_URL}/set/${redisKey}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(JSON.stringify(payload))
      });
    } catch (e) {
      console.warn('Failed to save to KV_REST_API_URL:', e);
    }
  }

  // 3. Save to /tmp
  try {
    const tmpFile = path.join('/tmp', cleanKey ? `bbs_tasks_${cleanKey}.json` : 'bbs_tasks.json');
    fs.writeFileSync(tmpFile, JSON.stringify(payload, null, 2), 'utf8');
  } catch (e) {}

  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  return res.status(200).json({
    ok: true,
    count: body.tasks.length,
    lastSync: syncTimestamp,
    syncKey: cleanKey || undefined,
    message: 'Synchronized successfully to serverless cloud'
  });
}
