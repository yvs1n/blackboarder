/**
 * QR decoding for the phone app's pairing scanner, bundled by scripts/build.js into
 * mobile-web/companion/qr-scan.js and exposed as `window.BBQrScan`. It is loaded only when the
 * scanner opens on a browser without a built-in QR reader (iPhone Safari).
 */
import jsQR from 'jsqr';

function decode(data: Uint8ClampedArray, width: number, height: number): string | null {
  const hit = jsQR(data, width, height, { inversionAttempts: 'attemptBoth' });
  return hit && hit.data ? hit.data : null;
}

(globalThis as any).BBQrScan = { decode };
