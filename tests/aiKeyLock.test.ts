import { describe, it, expect, vi, afterEach } from 'vitest';
import fs from 'node:fs';
import pagesWorker from '../mobile-web/_worker.js';
import { aiLockRequest, aiLockServerUrl, syncAiKeyLock, describeAiLock, newAiPass, pairingLink } from '../src/utils/aiKeyLock';
import { IFM_MODEL } from '../src/engine/aiProviders';

// Made-up values only
const SYNC = 'BBS-TESTKEY123';
const OTHER = 'BBS-OTHERKEY99';
const API_KEY = 'sk-or-v1-made-up-test-key';
const PASS = 'made-up-ai-pass-for-tests-0123456789abcdef';

function makeEnv(secret?: string) {
  const kv = new Map<string, string>();
  return {
    kv,
    env: {
      SKIP_FIREBASE: true,
      AI_KEY_SECRET: secret,
      TASKS_KV: {
        get: async (k: string) => kv.get(k) ?? null,
        put: async (k: string, v: string) => { kv.set(k, v); },
        delete: async (k: string) => { kv.delete(k); }
      }
    }
  };
}

const post = (path: string, body: any, env: any) =>
  pagesWorker.fetch(new Request(`https://blackboarder.pages.dev${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'cf-connecting-ip': `10.0.0.${Math.floor(Math.random() * 250)}` },
    body: JSON.stringify(body)
  }), env, {} as any);

const MESSAGES = [{ role: 'system', content: 'Extract deadlines.' }, { role: 'user', content: 'Quiz next week.' }];

afterEach(() => vi.unstubAllGlobals());

describe('server AI key locker', () => {
  it('stores only encrypted text, never the key itself', async () => {
    const { env, kv } = makeEnv('server-secret-for-tests');
    const res = await post('/api/ai/key', { syncKey: SYNC, provider: 'openrouter', apiKey: API_KEY, model: 'google/gemini-3.8-flash', aiPass: PASS }, env);
    expect(res.status).toBe(200);
    const stored = kv.get(`bbs_ai_${SYNC}`)!;
    expect(stored.startsWith('v1:')).toBe(true);
    expect(stored).not.toContain(API_KEY);
    expect(stored).not.toContain('gemini');
    expect(stored).not.toContain(PASS);
    const json = await res.json();
    expect(JSON.stringify(json)).not.toContain(API_KEY);
  });

  it('the web app reaches the model with the locked key; the reply never contains the key', async () => {
    const { env } = makeEnv('server-secret-for-tests');
    await post('/api/ai/key', { syncKey: SYNC, provider: 'ifm', apiKey: API_KEY, model: IFM_MODEL, aiPass: PASS }, env);

    const upstream = vi.fn(async (_url: string, _init: any) => new Response(JSON.stringify({ choices: [{ message: { content: '{"deadlines":[]}' } }] }), { status: 200 }));
    vi.stubGlobal('fetch', upstream);
    const res = await post('/api/ai/extract', { syncKey: SYNC, aiPass: PASS, messages: MESSAGES, max_tokens: 99999, model: 'attacker/model' }, env);
    expect(res.status).toBe(200);
    const [url, init] = upstream.mock.calls[0];
    expect(url).toBe('https://api.ifm.ai/v1/chat/completions');
    expect(init.headers.Authorization).toBe(`Bearer ${API_KEY}`);
    const sent = JSON.parse(init.body);
    expect(sent.model).toBe(IFM_MODEL);
    expect(sent.max_tokens).toBe(4000);
    expect(JSON.stringify(await res.json())).not.toContain(API_KEY);
  });

  it('the sync key alone cannot use the AI: the pass is required and must match', async () => {
    const { env } = makeEnv('server-secret-for-tests');
    await post('/api/ai/key', { syncKey: SYNC, provider: 'openrouter', apiKey: API_KEY, model: 'm', aiPass: PASS }, env);
    const upstream = vi.fn();
    vi.stubGlobal('fetch', upstream);
    for (const aiPass of [undefined, '', 'short', 'wrong-pass-but-long-enough-0123456789abcdef']) {
      const res = await post('/api/ai/extract', { syncKey: SYNC, aiPass, messages: MESSAGES }, env);
      expect(res.status).toBe(403);
    }
    expect(upstream).not.toHaveBeenCalled();
  });

  it('a key cannot be locked without a pass', async () => {
    const { env, kv } = makeEnv('server-secret-for-tests');
    const res = await post('/api/ai/key', { syncKey: SYNC, provider: 'openrouter', apiKey: API_KEY, model: 'm' }, env);
    expect(res.status).toBe(400);
    expect(kv.size).toBe(0);
  });

  it('another sync key cannot use or open someone else\'s key', async () => {
    const { env, kv } = makeEnv('server-secret-for-tests');
    await post('/api/ai/key', { syncKey: SYNC, provider: 'openrouter', apiKey: API_KEY, model: 'm', aiPass: PASS }, env);
    kv.set(`bbs_ai_${OTHER}`, kv.get(`bbs_ai_${SYNC}`)!);
    const upstream = vi.fn();
    vi.stubGlobal('fetch', upstream);
    const res = await post('/api/ai/extract', { syncKey: OTHER, aiPass: PASS, messages: MESSAGES }, env);
    expect(res.status).toBe(404);
    expect(upstream).not.toHaveBeenCalled();
  });

  it('without AI_KEY_SECRET the locker is off and nothing is stored', async () => {
    const { env, kv } = makeEnv(undefined);
    expect((await post('/api/ai/key', { syncKey: SYNC, provider: 'openrouter', apiKey: API_KEY, model: 'm', aiPass: PASS }, env)).status).toBe(501);
    expect((await post('/api/ai/extract', { syncKey: SYNC, messages: MESSAGES }, env)).status).toBe(501);
    expect(kv.size).toBe(0);
  });

  it('turning AI off or clearing the key removes the locked copy', async () => {
    const { env, kv } = makeEnv('server-secret-for-tests');
    await post('/api/ai/key', { syncKey: SYNC, provider: 'openrouter', apiKey: API_KEY, model: 'm', aiPass: PASS }, env);
    expect(kv.size).toBe(1);
    const res = await post('/api/ai/key', { syncKey: SYNC, provider: 'openrouter', apiKey: '', model: 'm' }, env);
    expect((await res.json()).cleared).toBe(true);
    expect(kv.size).toBe(0);
  });

  it('refuses custom URLs the server must not call, and odd messages', async () => {
    const { env } = makeEnv('server-secret-for-tests');
    for (const baseUrl of ['http://api.example.com/v1', 'https://localhost:11434/v1', 'https://192.168.1.5/v1']) {
      expect((await post('/api/ai/key', { syncKey: SYNC, provider: 'custom', baseUrl, apiKey: API_KEY, model: 'm', aiPass: PASS }, env)).status).toBe(400);
    }
    await post('/api/ai/key', { syncKey: SYNC, provider: 'openrouter', apiKey: API_KEY, model: 'm', aiPass: PASS }, env);
    const bad = await post('/api/ai/extract', { syncKey: SYNC, aiPass: PASS, messages: [{ role: 'assistant', content: 'x' }] }, env);
    expect(bad.status).toBe(400);
  });

  it('Firebase rules allow the encrypted copy and nothing else new', () => {
    const rules = JSON.parse(fs.readFileSync('database.rules.json', 'utf8')).rules.users.$syncKey;
    expect(rules.ai['.validate']).toContain("beginsWith('v1:')");
  });
});

describe('AI pass', () => {
  it('is random, URL-safe and long', () => {
    const a = newAiPass(), b = newAiPass();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('travels only after "#" in the pairing link, never in the query or the calendar link', () => {
    const link = pairingLink('https://blackboarder.pages.dev/companion/', SYNC, PASS);
    const url = new URL(link);
    expect(url.searchParams.get('key')).toBe(SYNC);
    expect(url.search).not.toContain(PASS);
    expect(new URLSearchParams(url.hash.slice(1)).get('ai')).toBe(PASS);
    expect(fs.readFileSync('src/popup/popup.ts', 'utf8')).toMatch(/feed\.ics\$\{syncKey \? `\?key=\$\{encodeURIComponent\(syncKey\)\}` : ''\}/);
  });

  it('the phone keeps the pass with its sync key, sends it, and drops it on disconnect', () => {
    const app = fs.readFileSync('mobile-web/companion/app.js', 'utf8');
    expect(app).toContain("get('ai')");
    expect(app).toContain('saved.key === syncKey');
    expect(app).toContain('{ url: `${location.origin}/api/ai/extract`, syncKey, aiPass }');
    expect(app).toContain('localStorage.removeItem(AI_PASS_STORE)');
  });
});

describe('extension side of the locker', () => {
  it('sends the picked provider\'s key, or nothing when AI is off', () => {
    const base = { syncKey: SYNC, useAiExtraction: true, openRouterApiKey: 'or', ifmApiKey: 'ifm', customAiApiKey: 'c', customAiModel: 'cm', customAiBaseUrl: 'https://x.example/v1' };
    expect(aiLockRequest({ ...base, aiProvider: 'ifm' })).toMatchObject({ provider: 'ifm', apiKey: 'ifm', model: IFM_MODEL, baseUrl: '' });
    expect(aiLockRequest({ ...base, aiProvider: 'custom' })).toMatchObject({ apiKey: 'c', model: 'cm', baseUrl: 'https://x.example/v1' });
    expect(aiLockRequest({ ...base, useAiExtraction: false }).apiKey).toBe('');
    expect(aiLockServerUrl({ hostedWebUrl: 'https://my.pages.dev/' })).toBe('https://my.pages.dev/api/ai/key');
    expect(aiLockRequest({ ...base, aiPass: PASS }).aiPass).toBe(PASS);
  });

  it('only calls the server when something changed, and keeps no copy of the key', async () => {
    const store: Record<string, any> = {};
    vi.stubGlobal('chrome', { storage: { local: {
      get: (keys: string[], cb: (r: any) => void) => cb(Object.fromEntries(keys.filter(k => k in store).map(k => [k, store[k]]))),
      set: (o: any, cb: () => void) => { Object.assign(store, o); cb(); }
    } } });
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ ok: true }) }));
    vi.stubGlobal('fetch', fetchMock);
    const settings = { syncKey: SYNC, useAiExtraction: true, openRouterApiKey: API_KEY, hostedWebUrl: 'https://blackboarder.pages.dev' };
    expect(await syncAiKeyLock(settings)).toBe('locked');
    expect(await syncAiKeyLock(settings)).toBe('locked');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(store)).not.toContain(API_KEY);
    await syncAiKeyLock({ ...settings, openRouterModel: 'openai/gpt-4o-mini' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    // Forced (Save Settings), and once the last send is a day old
    await syncAiKeyLock({ ...settings, openRouterModel: 'openai/gpt-4o-mini' }, true);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    store.bbs_ai_lock.at = new Date(Date.now() - 25 * 3600 * 1000).toISOString();
    await syncAiKeyLock({ ...settings, openRouterModel: 'openai/gpt-4o-mini' });
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(describeAiLock('server-off')).toContain('AI_KEY_SECRET');
  });
});
