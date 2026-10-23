import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import vm from 'node:vm';
import pagesWorker from '../mobile-web/_worker.js';

const subtle = globalThis.crypto.subtle;
const b64url = (b: ArrayBuffer | Uint8Array) => Buffer.from(b instanceof Uint8Array ? b : new Uint8Array(b)).toString('base64url');
const fromB64url = (s: string) => new Uint8Array(Buffer.from(s, 'base64url'));

// Made-up keys, made fresh for each run
let vapid: { publicKey: string; privateKey: string; verifyKey: CryptoKey };
let phone: { priv: CryptoKey; p256dh: string; auth: string };

beforeAll(async () => {
  const v = await subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  vapid = {
    publicKey: b64url(await subtle.exportKey('raw', v.publicKey)),
    privateKey: (await subtle.exportKey('jwk', v.privateKey)).d as string,
    verifyKey: v.publicKey
  };
  const p = await subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  phone = { priv: p.privateKey, p256dh: b64url(await subtle.exportKey('raw', p.publicKey)), auth: b64url(crypto.getRandomValues(new Uint8Array(16))) };
});

afterEach(() => { vi.unstubAllGlobals(); });

function kvEnv(extra: Record<string, unknown> = {}) {
  const kv = new Map<string, string>();
  return {
    kv,
    env: {
      SKIP_FIREBASE: true,
      VAPID_PUBLIC_KEY: vapid.publicKey,
      VAPID_PRIVATE_KEY: vapid.privateKey,
      VAPID_SUBJECT: 'mailto:test@example.com',
      PUSH_TICK_SECRET: 'made-up-tick-secret-1234',
      TASKS_KV: {
        get: async (k: string) => kv.get(k) || null,
        put: async (k: string, v: string) => { kv.set(k, v); },
        delete: async (k: string) => { kv.delete(k); },
        list: async ({ prefix }: { prefix: string }) => ({ keys: [...kv.keys()].filter(k => k.startsWith(prefix)).map(name => ({ name })) })
      },
      ...extra
    }
  };
}

let ipCounter = 0;
const call = (env: any, path: string, init: RequestInit = {}) => {
  const headers = new Headers(init.headers);
  headers.set('cf-connecting-ip', `10.0.0.${++ipCounter}`);
  return pagesWorker.fetch(new Request(`https://blackboarder.pages.dev${path}`, { ...init, headers }), env, {} as any);
};
const post = (env: any, path: string, body: unknown, headers: Record<string, string> = {}) =>
  call(env, path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });

const subscription = (endpoint = 'https://fcm.googleapis.com/fcm/send/made-up-device-1') => ({ endpoint, keys: { p256dh: phone.p256dh, auth: phone.auth } });

async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, bytes: number) {
  const k = await subtle.importKey('raw', ikm as BufferSource, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: salt as BufferSource, info: info as BufferSource }, k, bytes * 8));
}

/** What the phone's browser does with a push body (RFC 8291), so the test reads what the phone would. */
async function decryptOnPhone(body: Uint8Array) {
  const salt = body.slice(0, 16);
  const idLen = body[20];
  const asPublic = body.slice(21, 21 + idLen);
  const cipher = body.slice(21 + idLen);
  const asKey = await subtle.importKey('raw', asPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = new Uint8Array(await subtle.deriveBits({ name: 'ECDH', public: asKey }, phone.priv, 256));
  const te = new TextEncoder();
  const info = new Uint8Array([...te.encode('WebPush: info\0'), ...fromB64url(phone.p256dh), ...asPublic]);
  const ikm = await hkdf(fromB64url(phone.auth), shared, info, 32);
  const cek = await hkdf(salt, ikm, te.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, te.encode('Content-Encoding: nonce\0'), 12);
  const aes = await subtle.importKey('raw', cek, 'AES-GCM', false, ['decrypt']);
  const plain = new Uint8Array(await subtle.decrypt({ name: 'AES-GCM', iv: nonce }, aes, cipher));
  expect(plain[plain.length - 1]).toBe(2);
  return JSON.parse(new TextDecoder().decode(plain.slice(0, -1)));
}

/** Catches what the worker sends to push services. */
function stubPushService(status = 201) {
  const sent: { url: string; headers: Headers; body: Uint8Array }[] = [];
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    sent.push({ url: String(url), headers: new Headers(init.headers), body: new Uint8Array(init.body as ArrayBuffer) });
    return new Response(null, { status });
  });
  return sent;
}

const inHours = (h: number) => new Date(Date.now() + h * 3600 * 1000).toISOString();

describe('push subscribe and unsubscribe', () => {
  it('saves the subscription under its own sync key, with settings and already-shown reminders', async () => {
    const { env, kv } = kvEnv();
    const res = await post(env, '/api/push/subscribe?key=BBS-PUSHTEST01', {
      subscription: subscription(), advanceHours: 12, urgentHours: 1, dueAlertEnabled: false, reminded: ['quiz.1_adv_12h']
    });
    expect(res.status).toBe(200);
    expect((await res.json()).devices).toBe(1);
    const saved = JSON.parse(kv.get('bbs_push_BBS-PUSHTEST01')!);
    expect(saved.count).toBe(1);
    const sub: any = Object.values(saved.subs)[0];
    expect(sub).toMatchObject({ endpoint: subscription().endpoint, advanceHours: 12, urgentHours: 1, dueAlertEnabled: false });
    // Task ids can hold "." so the key is encoded for Firebase
    expect(Object.keys(sub.sent)).toEqual(['quiz%2E1_adv_12h']);
    expect([...kv.keys()].filter(k => k.startsWith('bbs_push_'))).toEqual(['bbs_push_BBS-PUSHTEST01']);
  });

  it('refuses endpoints that are not push services, a missing key, and a server without VAPID keys', async () => {
    const { env } = kvEnv();
    expect((await post(env, '/api/push/subscribe?key=BBS-PUSHTEST01', { subscription: subscription('https://evil.example/collect') })).status).toBe(400);
    expect((await post(env, '/api/push/subscribe?key=BBS-PUSHTEST01', { subscription: subscription('http://fcm.googleapis.com/x') })).status).toBe(400);
    expect((await post(env, '/api/push/subscribe', { subscription: subscription() })).status).toBe(400);
    const bare = kvEnv({ VAPID_PUBLIC_KEY: '', VAPID_PRIVATE_KEY: '' }).env;
    expect((await post(bare, '/api/push/subscribe?key=BBS-PUSHTEST01', { subscription: subscription() })).status).toBe(501);
    expect((await call(bare, '/api/push/key')).status).toBe(501);
    expect((await (await call(env, '/api/push/key')).json()).publicKey).toBe(vapid.publicKey);
  });

  it('unsubscribing removes the record once no device is left', async () => {
    const { env, kv } = kvEnv();
    await post(env, '/api/push/subscribe?key=BBS-PUSHTEST01', { subscription: subscription() });
    const res = await post(env, '/api/push/unsubscribe?key=BBS-PUSHTEST01', { endpoint: subscription().endpoint });
    expect((await res.json()).devices).toBe(0);
    expect(kv.has('bbs_push_BBS-PUSHTEST01')).toBe(false);
  });
});

describe('push tick', () => {
  async function setup() {
    const { env, kv } = kvEnv();
    await post(env, '/api/push/subscribe?key=BBS-PUSHTEST01', { subscription: subscription(), advanceHours: 24, urgentHours: 2 });
    kv.set('bbs_tasks_BBS-PUSHTEST01', JSON.stringify({ tasks: [
      { id: 'q1', title: 'Quiz 1', dueDate: inHours(1), status: 'pending', courseName: 'Calculus I', notes: 'private note' },
      { id: 'h2', title: 'Homework 2', dueDate: inHours(10), status: 'pending' },
      { id: 'done', title: 'Lab 3', dueDate: inHours(1), status: 'completed' },
      { id: 'far', title: 'Project', dueDate: inHours(100), status: 'pending' }
    ] }));
    // Another student's deadline must never reach this phone
    kv.set('bbs_tasks_BBS-OTHERKEY99', JSON.stringify({ tasks: [{ id: 'x', title: 'Other student quiz', dueDate: inHours(1), status: 'pending' }] }));
    return { env, kv };
  }

  it('needs the tick secret', async () => {
    const { env } = kvEnv();
    expect((await post(env, '/api/push/tick', {})).status).toBe(401);
    expect((await post(env, '/api/push/tick', {}, { 'x-tick-secret': 'wrong-secret-of-same-len' })).status).toBe(401);
  });

  it('sends each due reminder once, encrypted and signed, with only the fields a reminder shows', async () => {
    const { env } = await setup();
    const sent = stubPushService();
    const res = await post(env, '/api/push/tick', {}, { 'x-tick-secret': 'made-up-tick-secret-1234' });
    const result = await res.json();
    expect(result).toMatchObject({ ok: true, sent: 2, more: false });
    expect(sent.every(s => s.url === subscription().endpoint)).toBe(true);
    expect(sent[0].headers.get('content-encoding')).toBe('aes128gcm');

    const messages = await Promise.all(sent.map(s => decryptOnPhone(s.body)));
    expect(messages.map(m => m.key).sort()).toEqual(['h2_adv_24h', 'q1_urg_2h']);
    const quiz = messages.find(m => m.task.id === 'q1');
    expect(quiz).toMatchObject({ v: 1, label: '2h', task: { title: 'Quiz 1', courseName: 'Calculus I' } });
    expect(JSON.stringify(messages)).not.toContain('private note');
    expect(JSON.stringify(messages)).not.toContain('Other student');

    // VAPID: a JWT for the push service's origin, signed with the server's key
    const auth = sent[0].headers.get('authorization')!;
    const [, jwt, k] = /^vapid t=([^,]+), k=(.+)$/.exec(auth)!;
    expect(k).toBe(vapid.publicKey);
    const [h, c, sig] = jwt.split('.');
    expect(JSON.parse(Buffer.from(c, 'base64url').toString()).aud).toBe('https://fcm.googleapis.com');
    expect(await subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, vapid.verifyKey, fromB64url(sig), new TextEncoder().encode(`${h}.${c}`))).toBe(true);

    const again = await (await post(env, '/api/push/tick', {}, { 'x-tick-secret': 'made-up-tick-secret-1234' })).json();
    expect(again.sent).toBe(0);
  });

  it('drops a subscription the push service says is gone', async () => {
    const { env, kv } = await setup();
    stubPushService(410);
    const result = await (await post(env, '/api/push/tick', {}, { 'x-tick-secret': 'made-up-tick-secret-1234' })).json();
    expect(result.removed).toBe(1);
    expect(kv.has('bbs_push_BBS-PUSHTEST01')).toBe(false);
  });

  it('with Firebase, finds subscribed keys with FIREBASE_AUTH and saves the sent marks', async () => {
    const env = { ...kvEnv().env, SKIP_FIREBASE: false, TASKS_KV: undefined, FIREBASE_DB_URL: 'https://made-up-db.example', FIREBASE_AUTH: 'made-up-db-secret' };
    const subId = 'abc123';
    const calls: { url: string; init?: RequestInit }[] = [];
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      if (String(url).startsWith('https://made-up-db.example/users.json')) {
        return new Response(JSON.stringify({
          'BBS-PUSHTEST01': {
            push: { count: 1, subs: { [subId]: { ...subscription(), advanceHours: 24, urgentHours: 2, sent: {} } } },
            data: { tasks: [{ id: 'quiz.1', title: 'Quiz 1', dueDate: inHours(1), status: 'pending' }] }
          }
        }));
      }
      return new Response(null, { status: 201 });
    });
    const result = await (await post(env, '/api/push/tick', {}, { 'x-tick-secret': 'made-up-tick-secret-1234' })).json();
    expect(result.sent).toBe(1);
    const list = new URL(calls[0].url);
    expect(list.searchParams.get('orderBy')).toBe('"push/count"');
    expect(list.searchParams.get('auth')).toBe('made-up-db-secret');
    const write = calls.find(c => c.url === 'https://made-up-db.example/users/BBS-PUSHTEST01/push.json')!;
    expect(write.init!.method).toBe('PUT');
    expect(Object.keys(JSON.parse(String(write.init!.body)).subs[subId].sent)).toEqual(['quiz%2E1_urg_2h']);
  });

  it('the Firebase rules accept a push record and index it for the tick', () => {
    const rules = JSON.parse(fs.readFileSync('database.rules.json', 'utf8')).rules;
    expect(rules.users['.indexOn']).toContain('push/count');
    expect(rules.users.$syncKey.push['.validate']).toContain("hasChildren(['count', 'subs'])");
  });
});

describe('service worker push handler', () => {
  const sw = fs.readFileSync('mobile-web/companion/sw.js', 'utf8');

  function loadSw() {
    const handlers: Record<string, (e: any) => void> = {};
    const store = new Map<string, string>();
    const shown: { title: string; options: any }[] = [];
    const cache = {
      match: async (k: any) => { const v = store.get(String(k.url || k)); return v ? new Response(v) : undefined; },
      put: async (k: any, r: Response) => { store.set(String(k.url || k), await r.text()); },
      keys: async () => []
    };
    const self: any = {
      addEventListener: (t: string, fn: any) => { handlers[t] = fn; },
      skipWaiting: () => {},
      location: { origin: 'https://blackboarder.pages.dev' },
      clients: { matchAll: async () => [], claim: async () => {} },
      registration: { scope: 'https://blackboarder.pages.dev/companion/', showNotification: async (title: string, options: any) => { shown.push({ title, options }); } }
    };
    vm.runInNewContext(sw, {
      self, Response, Request: class { url: string; constructor(u: string) { this.url = u; } },
      Headers, URL, console: { log() {}, info() {}, warn() {}, error() {} }, setTimeout, Promise, Date, JSON, Object, Array, Math, Number, isNaN, String, Boolean,
      caches: { open: async () => cache, keys: async () => [] },
      clients: self.clients,
      fetch: async () => new Response('{}')
    });
    return { handlers, store, shown };
  }

  const firePush = async (h: (e: any) => void, msg: unknown) => {
    let p: Promise<any> | undefined;
    h({ data: { json: () => msg, text: () => JSON.stringify(msg) }, waitUntil: (x: Promise<any>) => { p = x; } });
    await p;
  };

  it('shows the reminder with the app\'s tag and remembers it in the shared "already reminded" map', async () => {
    const { handlers, shown, store } = loadSw();
    await firePush(handlers.push, { v: 1, key: 'q1_urg_2h', label: '2h', task: { id: 'q1', title: 'Quiz 1', dueDate: inHours(1), courseName: 'Calculus I' } });
    expect(shown).toHaveLength(1);
    expect(shown[0].title).toContain('Quiz 1');
    expect(shown[0].options).toMatchObject({ tag: 'bbs-urg-q1', silent: false, data: { taskId: 'q1' } });
    const saved = JSON.parse(store.get('/__bbs_scheduled_tasks__')!);
    expect(typeof saved.notifiedMap.q1_urg_2h).toBe('number');
  });

  it('a reminder the app already showed replaces it quietly instead of buzzing again', async () => {
    const { handlers, shown } = loadSw();
    let p: Promise<any> | undefined;
    handlers.message({ data: { type: 'SYNC_TASKS_FOR_NOTIFICATIONS', tasks: [], notifiedMap: { h2_adv_24h: Date.now() - 60000 }, enabled: true }, waitUntil: (x: Promise<any>) => { p = x; } });
    await p;
    await firePush(handlers.push, { v: 1, key: 'h2_adv_24h', label: '1d', task: { id: 'h2', title: 'Homework 2', dueDate: inHours(10) } });
    expect(shown.at(-1)!.options).toMatchObject({ tag: 'bbs-adv-h2', silent: true });
  });

  it('any other push still shows a notification, as iPhones require', async () => {
    const { handlers, shown } = loadSw();
    await firePush(handlers.push, { title: 'Hello', body: 'Made-up message' });
    expect(shown.map(s => s.title)).toEqual(['Hello']);
  });
});

describe('Alerts settings toggle', () => {
  const app = fs.readFileSync('mobile-web/companion/app.js', 'utf8');
  const html = fs.readFileSync('mobile-web/companion/index.html', 'utf8');

  it('has a "Reminders While Closed" switch that subscribes through the server', () => {
    expect(html).toContain('id="toggle-server-push"');
    expect(app).toContain("reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: serverKey })");
    expect(app).toContain("postPushSubscription('/api/push/subscribe'");
    // Turning all reminders off also stops the server's
    expect(app).toMatch(/localStorage\.setItem\('bbs_push_enabled', 'false'\);\s*\/\/[^\n]*\n\s*await unsubscribeServerPush\(\)/);
  });
});
