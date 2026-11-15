import fs from 'fs';
import path from 'path';
import zlib from 'zlib';

// Sample points along cubic Bezier curve into polyline segments
function sampleCubicBezier(p0, p1, p2, p3, steps = 28) {
  const pts = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const mt = 1 - t;
    const x =
      mt * mt * mt * p0[0] +
      3 * mt * mt * t * p1[0] +
      3 * mt * t * t * p2[0] +
      t * t * t * p3[0];
    const y =
      mt * mt * mt * p0[1] +
      3 * mt * mt * t * p1[1] +
      3 * mt * t * t * p2[1] +
      t * t * t * p3[1];
    pts.push([x, y]);
  }
  return pts;
}

function buildWombatSegments() {
  const segments = [];
  const addPoly = (pts) => {
    for (let i = 0; i < pts.length - 1; i++) {
      segments.push([pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]]);
    }
  };

  // All coordinates normalized to 32x32 viewBox matching header SVG
  // Left Ear: M7.5 11.5 C5.5 7 7.5 4.5 11.5 6.8
  addPoly(sampleCubicBezier([7.5, 11.5], [5.5, 7], [7.5, 4.5], [11.5, 6.8]));
  // Right Ear: M24.5 11.5 C26.5 7 24.5 4.5 20.5 6.8
  addPoly(sampleCubicBezier([24.5, 11.5], [26.5, 7], [24.5, 4.5], [20.5, 6.8]));

  // Head Contour
  addPoly(sampleCubicBezier([11.5, 6.8], [14.3, 5.7], [17.7, 5.7], [20.5, 6.8]));
  addPoly(sampleCubicBezier([20.5, 6.8], [23.5, 8.2], [26.5, 12], [26.5, 17.5]));
  addPoly(sampleCubicBezier([26.5, 17.5], [26.5, 23], [22, 26.5], [16, 26.5]));
  addPoly(sampleCubicBezier([16, 26.5], [10, 26.5], [5.5, 23], [5.5, 17.5]));
  addPoly(sampleCubicBezier([5.5, 17.5], [5.5, 12], [8.5, 8.2], [11.5, 6.8]));

  // Broad Wombat Nose
  addPoly(sampleCubicBezier([13.2, 18.2], [13.2, 17], [18.8, 17], [18.8, 18.2]));
  addPoly(sampleCubicBezier([18.8, 18.2], [18.8, 19.6], [17.3, 20.8], [16, 20.8]));
  addPoly(sampleCubicBezier([16, 20.8], [14.7, 20.8], [13.2, 19.6], [13.2, 18.2]));

  // Mouth vertical + smile
  addPoly([[16, 20.8], [16, 22.5]]);
  addPoly(sampleCubicBezier([13.5, 22.8], [14.5, 23.6], [17.5, 23.6], [18.5, 22.8]));

  return segments;
}

const WOMBAT_SEGMENTS = buildWombatSegments();

function distToSegmentSq(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return (px - x1) * (px - x1) + (py - y1) * (py - y1);
  let t = ((px - x1) * dx + (py - y1) * dy) / lenSq;
  if (t < 0) t = 0;
  else if (t > 1) t = 1;
  const projX = x1 + t * dx;
  const projY = y1 + t * dy;
  const ddx = px - projX;
  const ddy = py - projY;
  return ddx * ddx + ddy * ddy;
}

function createPNG(size, isMaskable = false) {
  const buffer = Buffer.alloc(size * size * 4);

  // Scale factor: maskable keeps safe padding (~15% margin on all sides)
  const scale = isMaskable ? 0.68 : 0.84;
  const halfStroke = 0.72; // stroke half-width in 32x32 space
  const aaWidth = 32 / (size * scale) * 1.1;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // Map pixel center to normalized [-0.5, 0.5] then to 32x32 viewBox
      const nx = (x + 0.5) / size - 0.5;
      const ny = (y + 0.5) / size - 0.5;
      const distCenter = Math.sqrt(nx * nx + ny * ny);

      // Base dark background #1a1a1a with soft orange ambient glow in center
      const glowFactor = Math.max(0, 1 - distCenter / 0.45);
      const glowStrength = glowFactor * glowFactor * 0.22;
      let r = 0x1a + (0xf9 - 0x1a) * glowStrength;
      let g = 0x1a + (0x73 - 0x1a) * glowStrength;
      let b = 0x1a + (0x16 - 0x1a) * glowStrength;

      // Subtle outer safe-zone ring on non-maskable icons
      if (!isMaskable) {
        const ringR = 0.415;
        const ringDiff = Math.abs(distCenter - ringR);
        if (ringDiff < 0.008) {
          const ringAlpha = (1 - ringDiff / 0.008) * 0.35;
          r = r * (1 - ringAlpha) + 0xf9 * ringAlpha;
          g = g * (1 - ringAlpha) + 0x73 * ringAlpha;
          b = b * (1 - ringAlpha) + 0x16 * ringAlpha;
        }
      }

      // Transform into 32x32 coordinate space
      const vx = 16 + (nx / scale) * 32;
      const vy = 16 + (ny / scale) * 32;

      // Eyes (filled circles at (11.5, 14.5) and (20.5, 14.5), r = 1.2)
      const dEyeL = Math.hypot(vx - 11.5, vy - 14.5) - 1.25;
      const dEyeR = Math.hypot(vx - 20.5, vy - 14.5) - 1.25;
      let minDist = Math.min(dEyeL, dEyeR);

      // Stroke segments
      let minSegSq = Infinity;
      for (let i = 0; i < WOMBAT_SEGMENTS.length; i++) {
        const s = WOMBAT_SEGMENTS[i];
        const dSq = distToSegmentSq(vx, vy, s[0], s[1], s[2], s[3]);
        if (dSq < minSegSq) minSegSq = dSq;
      }
      const strokeDist = Math.sqrt(minSegSq) - halfStroke;
      if (strokeDist < minDist) minDist = strokeDist;

      // Anti-aliased coverage for orange #f97316
      if (minDist < aaWidth) {
        const alpha = minDist <= -aaWidth ? 1 : 0.5 - (minDist / (2 * aaWidth));
        const clamped = Math.max(0, Math.min(1, alpha));
        r = r * (1 - clamped) + 0xf9 * clamped;
        g = g * (1 - clamped) + 0x73 * clamped;
        b = b * (1 - clamped) + 0x16 * clamped;
      }

      const idx = (y * size + x) * 4;
      buffer[idx] = Math.round(r);
      buffer[idx + 1] = Math.round(g);
      buffer[idx + 2] = Math.round(b);
      buffer[idx + 3] = 255;
    }
  }

  const rowSize = size * 4 + 1;
  const rawData = Buffer.alloc(rowSize * size);
  for (let y = 0; y < size; y++) {
    rawData[y * rowSize] = 0;
    buffer.copy(rawData, y * rowSize + 1, y * size * 4, (y + 1) * size * 4);
  }

  const compressed = zlib.deflateSync(rawData);

  function crc32(buf) {
    let c = 0xffffffff;
    for (let i = 0; i < buf.length; i++) {
      c ^= buf[i];
      for (let j = 0; j < 8; j++) {
        c = (c >>> 1) ^ (c & 1 ? 0xedb88320 : 0);
      }
    }
    return (c ^ 0xffffffff) >>> 0;
  }

  function chunk(type, data) {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const typeBuf = Buffer.from(type, 'ascii');
    const crcBuf = Buffer.alloc(4);
    const crc = crc32(Buffer.concat([typeBuf, data]));
    crcBuf.writeUInt32BE(crc, 0);
    return Buffer.concat([len, typeBuf, data, crcBuf]);
  }

  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  return Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', compressed),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const pubDir = path.resolve(process.cwd(), 'public');
if (!fs.existsSync(pubDir)) {
  fs.mkdirSync(pubDir, { recursive: true });
}

fs.writeFileSync(path.join(pubDir, 'pwa-192x192.png'), createPNG(192, false));
fs.writeFileSync(path.join(pubDir, 'pwa-512x512.png'), createPNG(512, false));
fs.writeFileSync(path.join(pubDir, 'pwa-maskable-512x512.png'), createPNG(512, true));
fs.writeFileSync(path.join(pubDir, 'apple-touch-icon.png'), createPNG(180, false));
console.log('Generated orange wombat PNG icons successfully.');
