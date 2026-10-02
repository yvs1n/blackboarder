import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

function createPng(width, height, colorFn) {
  const bytesPerPixel = 4; // RGBA
  const rowSize = 1 + width * bytesPerPixel;
  const rawData = Buffer.alloc(rowSize * height);

  for (let y = 0; y < height; y++) {
    const rowOffset = y * rowSize;
    rawData[rowOffset] = 0; // Filter type 0 (None)
    for (let x = 0; x < width; x++) {
      const pixelOffset = rowOffset + 1 + x * bytesPerPixel;
      const [r, g, b, a] = colorFn(x, y, width, height);
      rawData[pixelOffset] = r;
      rawData[pixelOffset + 1] = g;
      rawData[pixelOffset + 2] = b;
      rawData[pixelOffset + 3] = a;
    }
  }

  const deflated = zlib.deflateSync(rawData);

  function crc32(buf) {
    let crc = 0xffffffff;
    for (let i = 0; i < buf.length; i++) {
      let byte = buf[i];
      crc = crc ^ byte;
      for (let j = 0; j < 8; j++) {
        crc = (crc >>> 1) ^ (-(crc & 1) & 0xedb88320);
      }
    }
    return (crc ^ 0xffffffff) >>> 0;
  }

  function makeChunk(type, data) {
    const typeBuf = Buffer.from(type, 'ascii');
    const len = data ? data.length : 0;
    const lenBuf = Buffer.alloc(4);
    lenBuf.writeUInt32BE(len, 0);

    const crcBuf = Buffer.alloc(4);
    const toCrc = data ? Buffer.concat([typeBuf, data]) : typeBuf;
    crcBuf.writeUInt32BE(crc32(toCrc), 0);

    return Buffer.concat([lenBuf, typeBuf, data || Buffer.alloc(0), crcBuf]);
  }

  // PNG Header
  const header = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  // IHDR
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData[8] = 8; // bit depth
  ihdrData[9] = 6; // RGBA
  ihdrData[10] = 0; // compression
  ihdrData[11] = 0; // filter
  ihdrData[12] = 0; // interlace
  const ihdrChunk = makeChunk('IHDR', ihdrData);

  // IDAT
  const idatChunk = makeChunk('IDAT', deflated);

  // IEND
  const iendChunk = makeChunk('IEND', null);

  return Buffer.concat([header, ihdrChunk, idatChunk, iendChunk]);
}

// Draw a stylized calendar/graduation icon with blue/indigo theme
function getPixelColor(x, y, w, h) {
  const nx = x / w;
  const ny = y / h;
  const cx = 0.5;
  const cy = 0.5;
  const r = 0.44;

  // Background rounded square
  const cornerR = 0.22;
  const dx = Math.max(0, Math.abs(nx - cx) - (0.45 - cornerR));
  const dy = Math.max(0, Math.abs(ny - cy) - (0.45 - cornerR));
  const dist = Math.sqrt(dx * dx + dy * dy);

  if (dist > cornerR) {
    return [0, 0, 0, 0]; // transparent
  }

  // Inner icon: Calendar book or graduation cap
  // Base background: Indigo to Deep Blue gradient (UOS style)
  const grad = ny;
  let bgR = Math.round(30 + grad * 15);
  let bgG = Math.round(58 + grad * 30);
  let bgB = Math.round(138 + grad * 80); // rgb(30, 58, 138) to rgb(45, 88, 218)

  // Calendar outline
  const calL = 0.22, calR = 0.78, calT = 0.24, calB = 0.80;
  if (nx >= calL && nx <= calR && ny >= calT && ny <= calB) {
    // Header bar of calendar
    if (ny <= 0.38) {
      // Red/Coral urgency accent
      return [239, 68, 68, 255];
    }
    // Binder rings
    if ((Math.abs(nx - 0.35) < 0.04 || Math.abs(nx - 0.65) < 0.04) && ny >= 0.18 && ny <= 0.28) {
      return [255, 255, 255, 255];
    }
    // Calendar body
    // Grid lines / checklist rows
    if (ny >= 0.46 && ny <= 0.50 && nx >= 0.30 && nx <= 0.70) {
      return [99, 102, 241, 255]; // Indigo line
    }
    if (ny >= 0.58 && ny <= 0.62 && nx >= 0.30 && nx <= 0.60) {
      return [99, 102, 241, 255]; // Indigo line
    }
    if (ny >= 0.70 && ny <= 0.74 && nx >= 0.30 && nx <= 0.50) {
      return [99, 102, 241, 255]; // Indigo line
    }
    // Checkmark or star on top right
    if (nx >= 0.58 && nx <= 0.70 && ny >= 0.56 && ny <= 0.72) {
      return [16, 185, 129, 255]; // Emerald check
    }

    return [255, 255, 255, 250]; // White card
  }

  // Outer border anti-aliasing edge
  if (dist > cornerR - 0.02) {
    return [bgR, bgG, bgB, 200];
  }

  return [bgR, bgG, bgB, 255];
}

const outDir = path.resolve('public/icons');
fs.mkdirSync(outDir, { recursive: true });

for (const size of [16, 32, 48, 128]) {
  const buf = createPng(size, size, getPixelColor);
  const filePath = path.join(outDir, `icon${size}.png`);
  fs.writeFileSync(filePath, buf);
  console.log(`Generated ${filePath} (${buf.length} bytes)`);
}
