import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_SETTINGS, UserSettings } from '../src/types';


/** The Swiss Grid design system, shared by the extension, the companion and the landing page. */
function expectSwissGridTokens(css: string) {
  // Light: neutral page, white surfaces, black text, grey metadata, one red for the main action
  for (const token of ['--bg: #f5f5f5;', '--surface: #ffffff;', '--text-main: #000000;', '--text-muted: #555555;',
    '--accent: #dc2626;', '--on-accent: #ffffff;', '--radius-md: 0px;']) {
    expect(css).toContain(token);
  }
  // Dark variant keeps the same red
  expect(css).toContain('[data-theme="dark"]');
  for (const token of ['--bg: #0a0a0a;', '--surface: #141414;', '--text-main: #f5f5f5;', '--text-muted: #a3a3a3;']) {
    expect(css).toContain(token);
  }
  expect(css).toMatch(/font-family: "Inter Tight"/);
  expect(css).not.toMatch(/linear-gradient\((135deg|90deg)/);
}

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
    expectSwissGridTokens(css);
  });

  it('Mobile Web styles.css defines full dark theme tokens matching extension', () => {
    const cssPath = path.resolve('mobile-web/companion/styles.css');
    const css = fs.readFileSync(cssPath, 'utf8');

    // Light root variables
    expect(css).toContain(':root');
    expectSwissGridTokens(css);

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
    const htmlPath = path.resolve('mobile-web/companion/index.html');
    const html = fs.readFileSync(htmlPath, 'utf8');

    expect(html).toContain('id="icon-sun"');
    expect(html).toContain('id="icon-moon"');
    expect(html).toContain('id="btn-web-theme-toggle"');
    expect(html).toContain('id="web-setting-theme"');
  });

  it('Mobile Web app.js implements theme initialization, toggling, and persistence', () => {
    const jsPath = path.resolve('mobile-web/companion/app.js');
    const js = fs.readFileSync(jsPath, 'utf8');

    expect(js).toContain('function applyTheme');
    expect(js).toContain('function toggleTheme');
    expect(js).toContain('function initTheme');
    expect(js).toContain("localStorage.setItem('bbs_theme'");
    expect(js).toContain("document.documentElement.setAttribute('data-theme'");
  });

  it('integrates Blackboard Web Dark Mode toggle in popup and manifests content scripts', () => {
    const htmlPath = path.resolve('src/popup/index.html');
    const html = fs.readFileSync(htmlPath, 'utf8');
    expect(html).toContain('id="setting-blackboard-dark-mode"');
    expect(html).toContain('id="icon-edit"');
    expect(html).toContain('id="icon-pencil"');

    expect(DEFAULT_SETTINGS.blackboardDarkMode).toBe(true);

    const manifestPath = path.resolve('public/manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const darkScript = manifest.content_scripts.find((cs: any) =>
      cs.js?.includes('blackboard-dark.js') && cs.css?.includes('blackboard-dark.css')
    );
    expect(darkScript).toBeDefined();
    expect(darkScript.run_at).toBe('document_start');
    expect(darkScript.all_frames).toBe(true);
  });

  it('renders visible edit button icon in course cards', () => {
    const popupTsPath = path.resolve('src/popup/popup.ts');
    const popupTs = fs.readFileSync(popupTsPath, 'utf8');
    expect(popupTs).toContain('<use href="#icon-pencil"></use>');

    const popupCssPath = path.resolve('src/popup/popup.css');
    const popupCss = fs.readFileSync(popupCssPath, 'utf8');
    expect(popupCss).toContain('.ucc-action-btn.edit');
  });

  it('Landing page uses the same Swiss Grid palette and red primary action', () => {
    const html = fs.readFileSync(path.resolve('mobile-web/index.html'), 'utf8');
    for (const token of ['--bg: #f5f5f5;', '--surface: #ffffff;', '--text-main: #000000;', '--text-muted: #555555;',
      '--action-primary-bg: #dc2626;', '--bg: #0a0a0a;', '--text-main: #f5f5f5;']) {
      expect(html).toContain(token);
    }
    expect(html).toContain('/companion/fonts/inter-tight.woff2');
    expect(html).not.toContain('linear-gradient');
  });
});
