import { describe, it, expect } from 'vitest';
import fs from 'node:fs';

const html = fs.readFileSync('mobile-web/companion/index.html', 'utf8');
const app = fs.readFileSync('mobile-web/companion/app.js', 'utf8');
const section = html.slice(html.indexOf('<section id="view-settings"'), html.indexOf('</section>', html.indexOf('<section id="view-settings"')));

function cardsIn(group: string) {
  const start = section.indexOf(`id="settings-group-${group}"`);
  const next = section.indexOf('id="settings-group-', start + 10);
  const part = section.slice(start, next < 0 ? undefined : next);
  return [...part.matchAll(/<h3 class="settings-card-title">([^<]+)/g)].map(m => m[1].trim());
}

describe('phone Settings is split into groups', () => {
  it('has four tabs, Sync first and shown by default', () => {
    const tabs = [...section.matchAll(/class="filter-chip settings-group-tab[^"]*"[^>]*data-settings-group="([a-z]+)"/g)].map(m => m[1]);
    expect(tabs).toEqual(['sync', 'calendar', 'alerts', 'general']);
    expect(section).toMatch(/id="settings-group-sync"[^>]*role="tabpanel"[^>]*>/);
    expect(section).not.toMatch(/id="settings-group-sync"[^>]*hidden/);
    for (const g of ['calendar', 'alerts', 'general']) expect(section).toMatch(new RegExp(`id="settings-group-${g}"[^>]*hidden>`));
  });

  it('puts every card in exactly one group', () => {
    expect(cardsIn('sync')).toEqual(['Extension Sync Key', 'Automated Wi-Fi Sync']);
    expect(cardsIn('calendar')).toEqual(['Live Calendar Feed (WebCal)', 'iOS Home &amp; Lock Screen Widgets']);
    expect(cardsIn('alerts')).toEqual(['Mobile Push Notifications']);
    expect(cardsIn('general')).toEqual(['Appearance &amp; Help', 'App Updates', 'Backup &amp; Data Management']);
    expect((section.match(/class="settings-card"/g) || []).length).toBe(8);
  });

  it('remembers the last group, but an unpaired phone opens on Sync', () => {
    expect(app).toContain("const SETTINGS_GROUP_KEY = 'bbs_settings_group';");
    expect(app).toContain("openSettingsGroup(getSyncKey() ? saved : 'sync');");
    expect(app).toMatch(/initSettings\(\);\s*initSettingsGroups\(\);/);
  });

  it('text that points into Settings names the right group', () => {
    expect(html).not.toContain('Settings &gt; iOS Home');
    expect(html).not.toContain('Calendar feed below');
    expect(html).toContain('Steps are in Settings &gt; Calendar.');
  });
});
