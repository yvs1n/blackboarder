import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import vm from 'vm';

const webDir = join(__dirname, '..', 'mobile-web', 'companion');
const sw = readFileSync(join(webDir, 'sw.js'), 'utf8');
const app = readFileSync(join(webDir, 'app.js'), 'utf8');
const html = readFileSync(join(webDir, 'index.html'), 'utf8');
const versionJson = JSON.parse(readFileSync(join(webDir, 'version.json'), 'utf8'));

function loadUpdateHelpers() {
  const start = app.indexOf('async function fetchDeployedVersion()');
  const end = app.indexOf('function isUserBusy()');
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  const ctx: any = { APP_BUILD: { build: 'aaa', timestamp: '2026-10-20T10:00:00.000Z' } };
  vm.createContext(ctx);
  vm.runInContext(`${app.slice(start, end)}; this.isDeployedBuildNewer = isDeployedBuildNewer;`, ctx);
  return ctx;
}

describe('Web app automatic updates', () => {
  it('stamps app.js, sw.js and index.html with the build in version.json', () => {
    const build = versionJson.build;
    expect(build).toMatch(/^[0-9a-f]{12}$/);
    expect(app).toContain(`"build":"${build}"`);
    expect(sw).toContain(`const BUILD_ID = '${build}';`);
    expect(sw).toContain("const CACHE_NAME = 'blackboarder-web-' + BUILD_ID;");
    expect(html).toContain(`core.js?v=${build}`);
    expect(html).toContain(`app.js?v=${build}`);
    expect(html).toContain(`styles.css?v=${build}`);
    // The shared core loads before the app that uses it
    expect(html.indexOf('core.js?v=')).toBeLessThan(html.indexOf('app.js?v='));
  });

  it('treats only a different, not-older deployed build as an update', () => {
    const { isDeployedBuildNewer } = loadUpdateHelpers();
    expect(isDeployedBuildNewer({ build: 'aaa', timestamp: '2026-10-21T00:00:00Z' })).toBe(false);
    expect(isDeployedBuildNewer({ build: 'bbb', timestamp: '2026-10-21T00:00:00Z' })).toBe(true);
    // A stale CDN copy of an older build must not trigger a reload
    expect(isDeployedBuildNewer({ build: 'bbb', timestamp: '2026-10-19T00:00:00Z' })).toBe(false);
    expect(isDeployedBuildNewer({ build: 'bbb' })).toBe(true);
    expect(isDeployedBuildNewer(null)).toBe(false);
    // A development copy without a stamp never updates itself
    expect(isDeployedBuildNewer({ build: 'bbb' }, {})).toBe(false);
  });

  it('checks the deployed version.json and guards against reload loops', () => {
    expect(app).toContain("fetch('./version.json?t=' + Date.now(), { cache: 'no-store'");
    expect(app).toContain('bbs_update_tried');
    expect(app).toContain("checkForUpdate('quiet')");
    expect(app).not.toContain('api.github.com');
  });

  it('lets a new service worker take over and never serves version.json from cache', () => {
    const install = sw.slice(sw.indexOf("addEventListener('install'"), sw.indexOf("addEventListener('activate'"));
    expect(install).toContain('self.skipWaiting()');
    expect(sw).toContain("url.pathname.endsWith('/version.json')");
    expect(sw).toContain("'./core.js'");
    expect(sw).not.toContain("'./version.json'");
  });

  it('keeps the notification schedule in a cache that updates never purge', () => {
    expect(sw).toContain('NOTIF_STORE_NAME');
    expect(sw).toContain('k !== CACHE_NAME && k !== NOTIF_STORE_NAME');
    expect(sw).toContain('caches.open(NOTIF_STORE_NAME)');
  });

  it('keeps a manual update button as a fallback', () => {
    for (const id of ['app-update-banner', 'btn-check-update', 'btn-apply-update', 'btn-update-banner-apply']) {
      expect(html).toContain(`id="${id}"`);
    }
  });

  it('fires missed due alerts up to 6 hours late in app and service worker', () => {
    expect(sw).toContain('timeRemaining >= -6 * 3600 * 1000');
    expect(app).toContain('timeRemaining >= -6 * 3600 * 1000');
  });
});
