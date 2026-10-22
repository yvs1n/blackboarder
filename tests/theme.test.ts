import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_SETTINGS, UserSettings } from '../src/types';


/** The design system: two-tone colours with Swiss Grid type, corners and flat surfaces. */
function expectSwissGridTokens(css: string) {
  // Light: near-white page, white surfaces, near-black primary; the main action uses the primary colour
  for (const token of ['--bg: #f8fafc;', '--surface: #ffffff;', '--primary: #18181b;', '--text-main: #0f172a;',
    '--accent: #18181b;', '--on-accent: #ffffff;', '--radius-md: 0px;']) {
    expect(css).toContain(token);
  }
  // Dark: the same two tones swapped
  expect(css).toContain('[data-theme="dark"]');
  for (const token of ['--bg: #121215;', '--surface: #1a1a1f;', '--text-main: #f4f4f6;', '--primary: #f4f4f6;',
    '--accent: #f4f4f6;', '--on-accent: #121215;']) {
    expect(css).toContain(token);
  }
  expect(css).toMatch(/font-family: "Inter Tight"/);
  expect(css).not.toMatch(/linear-gradient\((135deg|90deg)/);
  // No other hues in the interface (blue, green, purple, amber)
  expect(css).not.toMatch(/#(2563eb|3b82f6|6366f1|16a34a|10b981|7c3aed|f59e0b)/i);
  // Red neither: course colours are the only colour in the interface
  const nonCourseLines = css.split('\n').filter(line => !line.includes('--course-'));
  expect(nonCourseLines.join('\n')).not.toMatch(/#(dc2626|ef4444|b91c1c|f87171)/i);
}

describe('Dark Mode / Light Mode Theme System', () => {
  it('DEFAULT_SETTINGS follows the system theme by default', () => {
    expect(DEFAULT_SETTINGS.theme).toBe('system');
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

  it('Popup index.html includes sun/moon icons and the theme selector (header toggle moved to Settings)', () => {
    const htmlPath = path.resolve('src/popup/index.html');
    const html = fs.readFileSync(htmlPath, 'utf8');

    expect(html).toContain('id="icon-sun"');
    expect(html).toContain('id="icon-moon"');
    expect(html).not.toContain('id="btn-theme-toggle"');
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

  it('Mobile Web index.html includes sun/moon icons, the Settings theme toggle and selector (none in the header)', () => {
    const htmlPath = path.resolve('mobile-web/companion/index.html');
    const html = fs.readFileSync(htmlPath, 'utf8');

    expect(html).toContain('id="icon-sun"');
    expect(html).toContain('id="icon-moon"');
    expect(html).not.toContain('id="btn-web-theme-toggle"');
    expect(html).toContain('id="btn-settings-theme-toggle"');
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

  it('Landing page uses the same two-tone palette and design system', () => {
    const html = fs.readFileSync(path.resolve('mobile-web/index.html'), 'utf8');
    for (const token of ['--bg: #121215;', '--text-main: #f4f4f6;', '--action-primary-bg: #f4f4f6;',
      '--bg: #f8fafc;', '--text-main: #0f172a;', '--action-primary-bg: #0f172a;']) {
      expect(html).toContain(token);
    }
    expect(html).toContain('/companion/fonts/inter-tight.woff2');
    expect(html).not.toContain('linear-gradient');
  });
});
