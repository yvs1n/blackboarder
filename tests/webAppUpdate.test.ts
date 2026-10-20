import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const sw = readFileSync(join(__dirname, '..', 'mobile-web', 'sw.js'), 'utf8');
const app = readFileSync(join(__dirname, '..', 'mobile-web', 'app.js'), 'utf8');
const html = readFileSync(join(__dirname, '..', 'mobile-web', 'index.html'), 'utf8');

describe('Web app update flow and notification durability', () => {
  it('does not force-activate a new service worker on install', () => {
    const install = sw.slice(sw.indexOf("addEventListener('install'"), sw.indexOf("addEventListener('activate'"));
    expect(install).not.toContain('self.skipWaiting()');
    expect(sw).toContain("event.data.type === 'SKIP_WAITING'");
  });

  it('keeps the notification schedule in a cache that updates never purge', () => {
    expect(sw).toContain('NOTIF_STORE_NAME');
    expect(sw).toContain('k !== CACHE_NAME && k !== NOTIF_STORE_NAME');
    expect(sw).toContain('caches.open(NOTIF_STORE_NAME)');
  });

  it('keeps SW cache version in sync with HTML asset query strings and APP_VERSION', () => {
    const v = /sidekick-mobile-v(\d+)/.exec(sw)![1];
    expect(html).toContain(`app.js?v=${v}`);
    expect(html).toContain(`styles.css?v=${v}`);
    expect(app).toContain(`const APP_VERSION = '${v}'`);
  });

  it('exposes update UI and only reloads after user consent', () => {
    for (const id of ['app-update-banner', 'btn-check-update', 'btn-apply-update', 'btn-update-banner-apply']) {
      expect(html).toContain(`id="${id}"`);
    }
    expect(app).toContain('userRequestedUpdate');
  });

  it('fires missed due alerts up to 6 hours late in app and service worker', () => {
    expect(sw).toContain('timeRemaining >= -6 * 3600 * 1000');
    expect(app).toContain('timeRemaining >= -6 * 3600 * 1000');
  });

  it('persists acknowledged and dismissed GitHub commits and handles pre-commit build parent SHA', () => {
    expect(app).toContain('APP_BUILD_TIMESTAMP');
    expect(app).toContain('bbs_webapp_ack_commit');
    expect(app).toContain('bbs_webapp_dismissed_commit');
    expect(app).toContain('remoteParentSha');
  });
});

