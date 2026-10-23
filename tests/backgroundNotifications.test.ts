import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import vm from 'node:vm';

const app = fs.readFileSync('mobile-web/companion/app.js', 'utf8');
const sw = fs.readFileSync('mobile-web/companion/sw.js', 'utf8');

/** Runs the app's service worker with fake browser parts and returns its handlers and cache. */
function loadSw(fetchImpl: (url: string) => Promise<Response>) {
  const handlers: Record<string, (e: any) => void> = {};
  const store = new Map<string, string>();
  const shown: string[] = [];
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
    registration: { showNotification: async (title: string) => { shown.push(title); } }
  };
  vm.runInNewContext(sw, {
    self, Response, Request: class { url: string; constructor(u: string) { this.url = u; } },
    Headers, URL, console: { log() {}, warn() {}, error() {} }, setTimeout, Promise, Date, JSON, Object, Array, Math, Number, isNaN, String,
    caches: { open: async () => cache, keys: async () => [] },
    clients: self.clients,
    fetch: fetchImpl
  });
  return { handlers, store, shown };
}

const fire = async (h: (e: any) => void, event: any) => {
  let p: Promise<any> | undefined;
  h({ ...event, waitUntil: (x: Promise<any>) => { p = x; } });
  await p;
};

describe('reminders while the app is closed', () => {
  it('registers background checks on the service worker registration, where periodicSync lives', () => {
    expect(app).not.toContain("'periodicSync' in navigator.serviceWorker");
    expect(app).toMatch(/const reg = await navigator\.serviceWorker\.ready[\s\S]{0,80}if \(reg && 'periodicSync' in reg\)/);
  });

  it('a background check fetches the newest deadlines, then shows the reminder that is due', async () => {
    const soon = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const cloud = { tasks: [{ id: 'q1', title: 'Quiz 1', dueDate: soon, status: 'pending', courseName: 'Calculus I', notes: 'not kept' }] };
    const { handlers, shown, store } = loadSw(async () => new Response(JSON.stringify(cloud)));
    await fire(handlers.message, { data: { type: 'SYNC_TASKS_FOR_NOTIFICATIONS', tasks: [], notifiedMap: {}, enabled: true, advanceHours: 24, urgentHours: 2, dueAlertEnabled: true, dataUrl: 'https://db.example/users/BBS-TESTKEY123/data.json' } });
    await fire(handlers.periodicsync, { tag: 'check-deadlines' });
    expect(shown.some(t => t.includes('Quiz 1'))).toBe(true);
    expect([...store.values()].join('')).not.toContain('not kept');
  });

  it('offline, it uses the saved list instead', async () => {
    const soon = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const { handlers, shown } = loadSw(async () => { throw new TypeError('offline'); });
    await fire(handlers.message, { data: { type: 'SYNC_TASKS_FOR_NOTIFICATIONS', tasks: [{ id: 'q2', title: 'Quiz 2', dueDate: soon, status: 'pending' }], notifiedMap: {}, enabled: true, dataUrl: 'https://db.example/x.json' } });
    shown.length = 0;
    await fire(handlers.periodicsync, { tag: 'check-deadlines' });
    // Already shown once when the list arrived, so the background check does not repeat it
    expect(shown).toEqual([]);
  });

  it('the app and the worker keep the latest "already reminded" time from each other', () => {
    expect(sw).toMatch(/v > \(notifiedMap\[k\] \|\| 0\)\) notifiedMap\[k\] = v/);
    expect(app).toContain("await (await caches.open('sidekick-notif-store')).match('/__bbs_scheduled_tasks__')");
  });
});

describe('settings tabs', () => {
  it('switching tabs does not scroll the page', () => {
    const fn = app.slice(app.indexOf('function initSettingsGroups'), app.indexOf('// Onboarding Tutorial'));
    expect(fn).not.toContain('scrollIntoView');
  });
});
