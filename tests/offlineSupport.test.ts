import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import vm from 'node:vm';

const rootSw = fs.readFileSync('mobile-web/sw.js', 'utf8');
const app = fs.readFileSync('mobile-web/companion/app.js', 'utf8');
const html = fs.readFileSync('mobile-web/companion/index.html', 'utf8');
const landing = fs.readFileSync('mobile-web/index.html', 'utf8');

/** Runs the root service worker with a fake browser and returns its fetch handler. */
function loadRootSw({ online, appCached }: { online: boolean; appCached: boolean }) {
  const handlers: Record<string, (e: any) => void> = {};
  const self = {
    location: { origin: 'https://blackboarder.pages.dev' },
    addEventListener: (type: string, fn: (e: any) => void) => { handlers[type] = fn; },
    skipWaiting: () => {},
    clients: { claim: async () => {} },
    registration: { unregister: () => { throw new Error('the root worker must not remove itself'); } }
  };
  const context = {
    self, URL, Response,
    caches: { match: async (url: string) => (appCached && url === '/companion/' ? new Response('app') : undefined) },
    fetch: async () => { if (!online) throw new TypeError('Failed to fetch'); return new Response('landing', { status: 200 }); }
  };
  vm.runInNewContext(rootSw, context);
  return async (url: string, mode = 'navigate') => {
    let result: Promise<Response> | undefined;
    handlers.fetch({ request: { url, mode }, respondWith: (p: Promise<Response>) => { result = p; } });
    return result ? await result : undefined;
  };
}

describe('offline: home screen apps that open at the site root', () => {
  it('online, the root page comes from the network as usual', async () => {
    const res = await loadRootSw({ online: true, appCached: true })('https://blackboarder.pages.dev/');
    expect(await res!.text()).toBe('landing');
  });

  it('offline, it goes to the saved copy of the app at /companion/, keeping the link', async () => {
    const res = await loadRootSw({ online: false, appCached: true })('https://blackboarder.pages.dev/?key=BBS-TESTKEY123');
    expect(res!.status).toBe(302);
    expect(res!.headers.get('Location')).toBe('https://blackboarder.pages.dev/companion/?key=BBS-TESTKEY123');
  });

  it('offline before the app was ever opened, it shows a short note instead of a browser error', async () => {
    const res = await loadRootSw({ online: false, appCached: false })('https://blackboarder.pages.dev/');
    expect(res!.status).toBe(503);
    expect(await res!.text()).toContain('You are offline');
  });

  it('leaves the app, its files and other requests to the app\'s own worker', async () => {
    const handle = loadRootSw({ online: false, appCached: true });
    expect(await handle('https://blackboarder.pages.dev/companion/')).toBeUndefined();
    expect(await handle('https://blackboarder.pages.dev/companion/app.js', 'no-cors')).toBeUndefined();
  });

  it('the landing page and the app both register it', () => {
    expect(landing).toContain("navigator.serviceWorker.register('/sw.js', { scope: '/' })");
    expect(app).toContain("navigator.serviceWorker.register('/sw.js', { scope: '/' })");
  });
});

describe('offline: phone app behaviour', () => {
  it('shows the real network state when it opens', () => {
    expect(app).toContain('updateStatus(!isOffline(), false);');
  });

  it('turns off pasting announcements while offline, with a note', () => {
    expect(app).toMatch(/function updatePasteAvailability\(\)[\s\S]*btn-ai-extract-modal[\s\S]*btn-run-extract/);
    expect(app).toMatch(/btn-ai-extract-modal'\)\?\.addEventListener\('click', \(\) => \{\s*if \(isOffline\(\)\)/);
    expect(html).toContain('id="extract-offline-note"');
  });

  it('keeps unsent changes marked and retries them until the server takes them', () => {
    const push = app.slice(app.indexOf('async function pushStateToCloud'));
    expect(push).toMatch(/if \(isOffline\(\)\) \{[\s\S]*?enqueueOfflineMutation\(\{ type: 'pending' \}\)[\s\S]*?return false;/);
    expect(push).toMatch(/if \(cloudOk\) \{\s*clearOfflineMutations\(\);\s*\} else if[\s\S]*?enqueueOfflineMutation/);
    expect(app).toMatch(/navigator\.onLine\) \{\s*flushOfflineMutations\(\)\.then\(\(\) => fetchTasksFromServer\(\)\)/);
    expect(app).toMatch(/async function refreshDataInBackground\(\) \{[\s\S]*?await flushOfflineMutations\(\);/);
  });

  it('never claims an offline edit was synced', () => {
    expect(app).not.toContain('Deadline updated and synced with Firebase');
  });
});
