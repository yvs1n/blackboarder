import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_SETTINGS, UserSettings } from '../src/types';

describe('Dark Mode / Light Mode Theme System', () => {
  it('DEFAULT_SETTINGS specifies theme: "light"', () => {
    expect(DEFAULT_SETTINGS.theme).toBe('light');
  });

  it('UserSettings type supports light, dark, and system themes', () => {
    const lightSettings: UserSettings = { ...DEFAULT_SETTINGS, theme: 'light' };
    const darkSettings: UserSettings = { ...DEFAULT_SETTINGS, theme: 'dark' };
    const systemSettings: UserSettings = { ...DEFAULT_SETTINGS, theme: 'system' };

    expect(lightSettings.theme).toBe('light');
    expect(darkSettings.theme).toBe('dark');
    expect(systemSettings.theme).toBe('system');
  });

  it('Extension popup.css defines full dark theme tokens and academic dark mode variables', () => {
    const cssPath = path.resolve('src/popup/popup.css');
    const css = fs.readFileSync(cssPath, 'utf8');

    // Light root variables
    expect(css).toContain(':root');
    expect(css).toContain('--bg: #f8fafc;');
    expect(css).toContain('--surface: #ffffff;');
    expect(css).toContain('--text-main: #0f172a;');

    // Dark theme token overrides
    expect(css).toContain('[data-theme="dark"]');
    expect(css).toContain('--bg: #121215;');
    expect(css).toContain('--surface: #1a1a1f;');
    expect(css).toContain('--surface-hover: #24242b;');
    expect(css).toContain('--surface-border: #2c2c36;');
    expect(css).toContain('--text-main: #f4f4f6;');
    expect(css).toContain('--text-muted: #a1a1aa;');
    expect(css).toContain('--primary: #f4f4f6;');
  });

  it('Mobile Web styles.css defines full dark theme tokens matching extension', () => {
    const cssPath = path.resolve('mobile-web/styles.css');
    const css = fs.readFileSync(cssPath, 'utf8');

    // Light root variables
    expect(css).toContain(':root');
    expect(css).toContain('--bg: #f8fafc;');
    expect(css).toContain('--surface: #ffffff;');

    // Dark theme token overrides
    expect(css).toContain('[data-theme="dark"]');
    expect(css).toContain('--bg: #121215;');
    expect(css).toContain('--surface: #1a1a1f;');
    expect(css).toContain('--text-main: #f4f4f6;');
    expect(css).toContain('--text-muted: #a1a1aa;');
    expect(css).toContain('--primary: #f4f4f6;');

    // Fixed scuffed dark mode overrides for calendar day cells and badges
    expect(css).toContain('[data-theme="dark"] .cal-day-cell');
    expect(css).toContain('[data-theme="dark"] .type-quiz');
    expect(css).toContain('[data-theme="dark"] .type-assignment');
    expect(css).toContain('[data-theme="dark"] .urgency-badge.overdue');
    expect(css).toContain('[data-theme="dark"] .task-card.is-active-reading');
    expect(css).toContain('[data-theme="dark"] .drag-pill');
  });

  it('Popup index.html includes theme toggle button, sun/moon icons, and settings selector', () => {
    const htmlPath = path.resolve('src/popup/index.html');
    const html = fs.readFileSync(htmlPath, 'utf8');

    expect(html).toContain('id="icon-sun"');
    expect(html).toContain('id="icon-moon"');
    expect(html).toContain('id="btn-theme-toggle"');
    expect(html).toContain('id="setting-theme"');
    expect(html).toContain('Alt+B');
  });

  it('Manifest defines commands with Alt+B shortcut for instant popup opening', () => {
    const manifestPath = path.resolve('public/manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

    expect(manifest.commands).toBeDefined();
    expect(manifest.commands._execute_action).toBeDefined();
    expect(manifest.commands._execute_action.suggested_key.default).toBe('Alt+B');
    expect(manifest.commands._execute_action.suggested_key.mac).toBe('Alt+Shift+B');
  });

  it('Extension popup.css has 480px width for comfortable breathing room', () => {
    const cssPath = path.resolve('src/popup/popup.css');
    const css = fs.readFileSync(cssPath, 'utf8');

    expect(css).toContain('width: 480px;');
    expect(css).toContain('.kbd-badge');
  });

  it('Mobile Web index.html includes theme toggle button, sun/moon icons, and settings selector', () => {
    const htmlPath = path.resolve('mobile-web/index.html');
    const html = fs.readFileSync(htmlPath, 'utf8');

    expect(html).toContain('id="icon-sun"');
    expect(html).toContain('id="icon-moon"');
    expect(html).toContain('id="btn-web-theme-toggle"');
    expect(html).toContain('id="web-setting-theme"');
  });

  it('Mobile Web app.js implements theme initialization, toggling, and persistence', () => {
    const jsPath = path.resolve('mobile-web/app.js');
    const js = fs.readFileSync(jsPath, 'utf8');

    expect(js).toContain('function applyTheme');
    expect(js).toContain('function toggleTheme');
    expect(js).toContain('function initTheme');
    expect(js).toContain("localStorage.setItem('bbs_theme'");
    expect(js).toContain("document.documentElement.setAttribute('data-theme'");
  });
});
