import { generateIcsFeed } from '../self-hosted/server/calendarFeed.js';
import fs from 'fs';
import path from 'path';

const FIREBASE_DB_URL = 'https://blackboard-sidekick-default-rtdb.asia-southeast1.firebasedatabase.app';

async function getStoredTasks(syncKey) {
  const cleanKey = (syncKey || '').trim().replace(/[^a-zA-Z0-9_-]/g, '');

  // 1. If user syncKey is provided, check Firebase Realtime Database
  if (cleanKey) {
    try {
      const fbRes = await fetch(`${FIREBASE_DB_URL}/users/${cleanKey}/data.json`, {
        headers: { 'Accept': 'application/json' }
      });
      if (fbRes.ok) {
        const fbData = await fbRes.json();
        if (fbData && Array.isArray(fbData.tasks)) {
          return { tasks: fbData.tasks, lastSync: fbData.lastSync || null };
        }
      }
    } catch {}
  }

  // 2. If Upstash Redis or KV env vars are provided
  if (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) {
    try {
      const redisKey = cleanKey ? `bbs_tasks_${cleanKey}` : 'bbs_tasks';
      const res = await fetch(`${process.env.KV_REST_API_URL}/get/${redisKey}`, {
        headers: { Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}` }
      });
      const data = await res.json();
      if (data.result) return JSON.parse(data.result);
    } catch {}
  }

  // 3. Fallback to /tmp filesystem in serverless container
  const tmpFile = path.join('/tmp', cleanKey ? `bbs_tasks_${cleanKey}.json` : 'bbs_tasks.json');
  if (fs.existsSync(tmpFile)) {
    try {
      return JSON.parse(fs.readFileSync(tmpFile, 'utf8'));
    } catch {}
  }

  // 4. Fallback to repo initial tasks if present
  const repoFile = path.join(process.cwd(), 'self-hosted', 'server', 'data', 'tasks.json');
  if (fs.existsSync(repoFile)) {
    try {
      return JSON.parse(fs.readFileSync(repoFile, 'utf8'));
    } catch {}
  }

  return { tasks: [], lastSync: null };
}

export default async function handler(req, res) {
  const key = req.query?.key || req.query?.sync || req.query?.code || '';
  const data = await getStoredTasks(key);
  const ics = generateIcsFeed(data.tasks || [], {
    calendarName: key ? `Blackboard Deadlines (${key})` : 'Blackboard Deadlines (UOS)',
    description: 'Live academic deadlines feed from Blackboarder'
  });

  res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
  res.setHeader('Content-Disposition', 'inline; filename="blackboard-feed.ics"');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-cache, must-revalidate');
  res.setHeader('X-Published-TTL', 'PT1H');

  return res.status(200).send(ics);
}
