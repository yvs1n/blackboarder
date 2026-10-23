import { describe, it, expect } from 'vitest';
import fs from 'node:fs';

const phone = fs.readFileSync('mobile-web/companion/index.html', 'utf8');
const popup = fs.readFileSync('src/popup/index.html', 'utf8');
const popupTs = fs.readFileSync('src/popup/popup.ts', 'utf8');

const between = (s: string, a: string, b: string) => s.slice(s.indexOf(a), s.indexOf(b, s.indexOf(a)));
const phoneGuide = between(phone, 'id="modal-onboarding"', '<!-- TOAST NOTIFICATION CONTAINER -->');
const tour = between(popup, 'id="modal-walkthrough"', '<!-- Floating Action Toast Container -->');

function missingIcons(page: string, part: string) {
  const defined = new Set([...page.matchAll(/symbol id="(icon-[a-z-]+)"/g)].map(m => m[1]));
  return [...part.matchAll(/href="#(icon-[a-z-]+)"/g)].map(m => m[1]).filter(id => !defined.has(id));
}

describe('in-app guides stay accurate', () => {
  it('every icon they use exists', () => {
    expect(missingIcons(phone, phoneGuide)).toEqual([]);
    expect(missingIcons(popup, tour)).toEqual([]);
  });

  it('both point to the real place of the pairing link and explain the AI pass', () => {
    expect(phoneGuide).toContain('Settings &gt; Sync');
    expect(phoneGuide).toContain('Copy Phone Pairing Link');
    expect(phoneGuide).toContain('Pair Key');
    expect(tour).toContain('id="btn-wt-copy-pairing-link"');
    expect(popupTs).toContain("document.getElementById('btn-copy-pairing-link')?.click()");
    for (const g of [phoneGuide, tour]) expect(g).toMatch(/AI model/);
  });

  it('describe offline use, optional AI and the real scan button', () => {
    expect(phoneGuide).toMatch(/Works Offline[\s\S]*Pasting announcements needs internet/);
    for (const g of [phoneGuide, tour]) {
      expect(g).toContain('Settings &gt; Scanning');
      expect(g).toContain('Alt+B');
      expect(g).toMatch(/bottom right/);
    }
  });

  it('do not promise things the apps no longer do or look like', () => {
    for (const g of [phoneGuide, tour]) {
      expect(g).not.toMatch(/GPA|floating blue|green|runs entirely on your device|Calculus 1, Physics 1/i);
    }
    expect(popupTs).not.toContain("'Next Step ->'");
  });
});
