import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import vm from 'node:vm';
import { qrSvg } from '../src/utils/qrCode';
import { pairingLink } from '../src/utils/aiKeyLock';

const link = pairingLink('https://blackboarder.pages.dev/companion/', 'BBS-TEST123456', 'made-up-ai-pass-0123456789abcdef');

/** Draws the SVG's squares into RGBA pixels, like a camera frame of the screen. */
function rasterize(svg: string, px = 6): { data: Uint8ClampedArray; width: number; height: number } {
  const size = Number(svg.match(/viewBox="0 0 (\d+) /)![1]);
  const w = size * px;
  const data = new Uint8ClampedArray(w * w * 4).fill(255);
  const path = svg.match(/<path d="([^"]+)"/)![1];
  for (const m of path.matchAll(/M(\d+) (\d+)h1v1h-1z/g)) {
    const x0 = +m[1] * px, y0 = +m[2] * px;
    for (let y = y0; y < y0 + px; y++) {
      for (let x = x0; x < x0 + px; x++) {
        const i = (y * w + x) * 4;
        data[i] = 0x18; data[i + 1] = 0x18; data[i + 2] = 0x1b;
      }
    }
  }
  return { data, width: w, height: w };
}

describe('pairing QR code', () => {
  it('the phone scanner reads back the exact pairing link, AI pass included', () => {
    const ctx: any = {};
    vm.runInNewContext(fs.readFileSync('mobile-web/companion/qr-scan.js', 'utf8'), ctx);
    const frame = rasterize(qrSvg(link));
    expect(ctx.BBQrScan.decode(frame.data, frame.width, frame.height)).toBe(link);
  });

  it('is a two-tone SVG with a quiet zone and an accessible label', () => {
    const svg = qrSvg(link, { label: 'Phone <pairing> QR code' });
    expect(svg).toMatch(/^<svg [^>]*role="img"/);
    expect(svg).toContain('aria-label="Phone &lt;pairing&gt; QR code"');
    expect(svg).toContain('fill="#18181b"');
    expect(svg).toContain('M4 4h1v1h-1z'); // the first finder square starts after the 4-module margin
  });

  it('the extension shows it next to the pairing link, and the phone scans into the sync key box', () => {
    const popup = fs.readFileSync('src/popup/index.html', 'utf8');
    expect(popup).toContain('id="btn-show-pairing-qr"');
    const app = fs.readFileSync('mobile-web/companion/app.js', 'utf8');
    expect(app).toContain("document.getElementById('btn-save-web-sync-key')?.click()");
    expect(app).toContain("new window.BarcodeDetector({ formats: ['qr_code'] })");
    expect(fs.readFileSync('mobile-web/companion/sw.js', 'utf8')).toContain("'./qr-scan.js'");
  });
});
