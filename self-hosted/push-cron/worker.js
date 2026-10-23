/**
 * Blackboarder push scheduler: a tiny Cloudflare Worker that runs every 5 minutes (Cron Trigger)
 * and asks the Blackboarder server to send the push reminders that are due (POST /api/push/tick).
 * Cloudflare Pages cannot run on a schedule by itself, and GitHub's scheduled runs often start late.
 *
 * Secrets (Worker > Settings > Variables and Secrets):
 *   PUSH_TICK_URL     the site address, for example https://blackboarder.pages.dev
 *   PUSH_TICK_SECRET  the same value as the Pages project's PUSH_TICK_SECRET
 * Deploy: paste this file into a new Worker in the dashboard, or `npx wrangler deploy` in this folder.
 * Opening the Worker's own address runs one tick and shows the result, for checking the setup.
 */

async function runTicks(env) {
  const base = String(env.PUSH_TICK_URL || '').trim().replace(/\/+$/, '');
  const secret = String(env.PUSH_TICK_SECRET || '').trim();
  if (!base || !secret) return { ok: false, error: 'PUSH_TICK_URL or PUSH_TICK_SECRET is not set' };
  const results = [];
  // The server stops after a set number of pushes and answers "more"; ask again until done
  for (let i = 0; i < 10; i++) {
    const res = await fetch(`${base}/api/push/tick`, {
      method: 'POST',
      headers: { 'x-tick-secret': secret, 'Content-Type': 'application/json' },
      body: '{}'
    });
    const data = await res.json().catch(() => ({ ok: false, error: `HTTP ${res.status}` }));
    results.push({ status: res.status, ...data });
    if (!res.ok || !data.more) break;
  }
  const last = results[results.length - 1];
  return { ok: Boolean(last && last.ok), results };
}

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runTicks(env).then(r => {
      if (r.ok) console.info('Push tick:', JSON.stringify(r.results));
      else console.error('Push tick failed:', JSON.stringify(r));
    }));
  },

  async fetch(request, env) {
    const result = await runTicks(env);
    return new Response(JSON.stringify(result, null, 2), {
      status: result.ok ? 200 : 502,
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
    });
  }
};
