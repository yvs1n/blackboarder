import { generateIcsFeed } from '../server/calendarFeed.js';
import fs from 'fs';
import path from 'path';

const TMP_FILE = path.join('/tmp', 'bbs_tasks.json');

async function getStoredTasks() {
  // If Upstash Redis or KV env vars are provided
  if (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) {
    try {
      const res = await fetch(`${process.env.KV_REST_API_URL}/get/bbs_tasks`, {
        headers: { Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}` }
      });
      const data = await res.json();
      if (data.result) return JSON.parse(data.result);
    } catch (e) {}
  }

  // Fallback to /tmp filesystem in serverless container
  if (fs.existsSync(TMP_FILE)) {
    try {
      return JSON.parse(fs.readFileSync(TMP_FILE, 'utf8'));
    } catch (e) {}
  }

  // Fallback to repo initial tasks if present
  const repoFile = path.join(process.cwd(), 'server', 'data', 'tasks.json');
  if (fs.existsSync(repoFile)) {
    try {
      return JSON.parse(fs.readFileSync(repoFile, 'utf8'));
    } catch (e) {}
  }

  return { tasks: [], lastSync: null };
}

export default async function handler(req, res) {
  const data = await getStoredTasks();
  const ics = generateIcsFeed(data.tasks || [], {
    calendarName: 'Blackboard Deadlines (UOS)',
    description: 'Live academic deadlines feed from Blackboarder'
  });

  res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
  res.setHeader('Content-Disposition', 'inline; filename="blackboard-feed.ics"');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-cache, must-revalidate');
  res.setHeader('X-Published-TTL', 'PT1H');

  return res.status(200).send(ics);
}
