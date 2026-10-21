import { describe, it, expect, vi, afterEach } from 'vitest';
import { Readable } from 'node:stream';
import fs from 'node:fs';
import worker from '../mobile-web/_worker.js';
import vercelHandler, { toWorkerRequest } from '../api/[...path].js';

const env = { SKIP_FIREBASE: true } as any;
const call = (path: string, init: RequestInit = {}, ip = '203.0.113.1') =>
  worker.fetch(new Request(`https://x.test${path}`, { ...init, headers: { 'cf-connecting-ip': ip, ...(init.headers || {}) } }), env, {} as any);

afterEach(() => vi.restoreAllMocks());

describe('sync API requires a sync key', () => {
  it('refuses to read or write data without a valid key', async () => {
    for (const [path, init] of [
      ['/api/tasks', {}],
      ['/api/sync', { method: 'POST', body: JSON.stringify({ tasks: [] }) }],
      ['/api/task-status', { method: 'POST', body: JSON.stringify({ taskId: 'a', status: 'completed' }) }],
      ['/feed.ics', {}],
      ['/api/tasks?key=short', {}],
      ['/api/tasks?key=bad%20key%2F..', {}]
    ] as const) {
      const res = await call(path, init as RequestInit, '203.0.113.10');
      expect(res.status, path).toBe(400);
    }
  });

  it('reports pairing state without exposing any tasks when unpaired', async () => {
    const data = await (await call('/api/status', {}, '203.0.113.11')).json();
    expect(data.paired).toBe(false);
    expect(data.totalTasks).toBe(0);
  });

  it('rate limits by IP, so trying many different keys does not help', async () => {
    let limited = 0;
    for (let i = 0; i < 70; i++) {
      const res = await call(`/api/sync?key=BBS-GUESS${String(i).padStart(3, '0')}`, { method: 'POST', body: JSON.stringify({ tasks: [] }) }, '198.51.100.7');
      if (res.status === 429) limited++;
    }
    expect(limited).toBeGreaterThan(0);
  });

  it('only lends the server AI key to paired devices', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const aiEnv = { ...env, OPENROUTER_API_KEY: 'server-key' };
    const res = await worker.fetch(new Request('https://x.test/api/ai/extract', {
      method: 'POST', headers: { 'cf-connecting-ip': '203.0.113.12' }, body: JSON.stringify({ text: 'Quiz on Sunday' })
    }), aiEnv, {} as any);
    expect(res.status).toBe(401);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('Firebase rules match where the apps store data', () => {
  it('validates users/<key>/data, the path every client writes', () => {
    const rules = JSON.parse(fs.readFileSync('database.rules.json', 'utf8')).rules;
    expect(rules['.read']).toBe(false);
    expect(rules.users.$syncKey.data['.validate']).toContain("hasChild('tasks')");
    expect(rules.users.$syncKey['.read']).toContain('length >= 8');
    expect(rules.users.$syncKey.$other['.validate']).toBe(false);
  });
});

describe('Vercel runs the same backend', () => {
  const fakeReq = (method: string, url: string, body?: string) => {
    const req: any = Readable.from(body ? [Buffer.from(body)] : []);
    req.method = method;
    req.url = url;
    req.headers = { host: 'app.vercel.app', 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.20' };
    return req;
  };

  it('maps the feed rewrite to the calendar route and forwards the body', async () => {
    const feed = await toWorkerRequest(fakeReq('GET', '/api/feed?key=BBS-TESTKEY1'));
    expect(new URL(feed.url).pathname).toBe('/feed.ics');
    const post = await toWorkerRequest(fakeReq('POST', '/api/sync?key=BBS-TESTKEY1', '{"tasks":[]}'));
    expect(await post.text()).toBe('{"tasks":[]}');
  });

  it('answers through the shared worker', async () => {
    const res: any = { headers: {} as Record<string, string>, setHeader(k: string, v: string) { this.headers[k] = v; }, end(b: Buffer) { this.body = b.toString(); } };
    await vercelHandler(fakeReq('GET', '/api/tasks'), res);
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toContain('sync key');
  });
});
