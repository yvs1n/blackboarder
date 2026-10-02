import fs from 'fs';
import path from 'path';

const TMP_FILE = path.join('/tmp', 'bbs_tasks.json');

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

  const body = req.body || {};
  if (!Array.isArray(body.tasks)) {
    return res.status(400).json({ ok: false, error: 'Expected tasks array in payload' });
  }

  const syncTimestamp = new Date().toISOString();
  const payload = {
    tasks: body.tasks,
    lastSync: syncTimestamp,
    device: body.device || 'Chrome Extension',
    count: body.tasks.length
  };

  // If Upstash Redis / Vercel KV is configured
  if (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) {
    try {
      await fetch(`${process.env.KV_REST_API_URL}/set/bbs_tasks`, {
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

  // Save to /tmp
  try {
    fs.writeFileSync(TMP_FILE, JSON.stringify(payload, null, 2), 'utf8');
  } catch (e) {}

  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  return res.status(200).json({
    ok: true,
    count: body.tasks.length,
    lastSync: syncTimestamp,
    message: 'Synchronized successfully to serverless cloud'
  });
}
