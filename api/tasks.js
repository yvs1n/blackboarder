import fs from 'fs';
import path from 'path';

const TMP_FILE = path.join('/tmp', 'bbs_tasks.json');

export default async function handler(req, res) {
  // CORS Preflight
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    return res.status(204).end();
  }

  let taskData = { tasks: [], lastSync: null };

  // 1. If KV_REST_API_URL is configured
  if (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) {
    try {
      const kvRes = await fetch(`${process.env.KV_REST_API_URL}/get/bbs_tasks`, {
        headers: { Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}` }
      });
      const kvJson = await kvRes.json();
      if (kvJson.result) {
        taskData = JSON.parse(kvJson.result);
      }
    } catch (e) {}
  } else if (fs.existsSync(TMP_FILE)) {
    try {
      taskData = JSON.parse(fs.readFileSync(TMP_FILE, 'utf8'));
    } catch (e) {}
  } else {
    const repoFile = path.join(process.cwd(), 'server', 'data', 'tasks.json');
    if (fs.existsSync(repoFile)) {
      try {
        taskData = JSON.parse(fs.readFileSync(repoFile, 'utf8'));
      } catch (e) {}
    }
  }

  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');

  return res.status(200).json({
    ok: true,
    tasks: taskData.tasks || [],
    lastSync: taskData.lastSync,
    count: (taskData.tasks || []).length
  });
}
