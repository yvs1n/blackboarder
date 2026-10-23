/**
 * Vercel entry point for every /api route and the calendar feed.
 *
 * It runs the same backend as Cloudflare Pages (mobile-web/_worker.js), so sync, sync-key checks,
 * rate limits and the calendar feed behave identically on both hosts. Vercel serves the web app's
 * files itself (see vercel.json); only API requests reach this function.
 *
 * Optional environment variables: FIREBASE_DB_URL, SYNC_SECRET, AI_KEY_SECRET (lets the web app use the extension's AI model; see docs/HOSTING_GUIDE.md).
 */
import pagesWorker from '../mobile-web/_worker.js';

// Request headers the backend reads; everything else stays out of the forwarded request
const FORWARDED_HEADERS = ['content-type', 'x-sync-key', 'x-sync-secret', 'x-forwarded-for', 'cf-connecting-ip'];

export async function toWorkerRequest(req) {
  const proto = req.headers['x-forwarded-proto'] || 'https';
  const url = new URL(req.url, `${proto}://${req.headers.host || 'localhost'}`);
  // vercel.json sends /feed.ics and /cal.ics here as /api/feed
  if (url.pathname === '/api/feed') url.pathname = '/feed.ics';

  const headers = new Headers();
  for (const name of FORWARDED_HEADERS) {
    const value = req.headers[name];
    if (typeof value === 'string') headers.set(name, value);
  }

  let body;
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    body = Buffer.concat(chunks);
  }
  return new Request(url, { method: req.method, headers, body });
}

export default async function handler(req, res) {
  const env = {
    FIREBASE_DB_URL: process.env.FIREBASE_DB_URL,
    SYNC_SECRET: process.env.SYNC_SECRET,
    AI_KEY_SECRET: process.env.AI_KEY_SECRET
  };
  const response = await pagesWorker.fetch(await toWorkerRequest(req), env, {});
  res.statusCode = response.status;
  response.headers.forEach((value, name) => res.setHeader(name, value));
  res.end(Buffer.from(await response.arrayBuffer()));
}
