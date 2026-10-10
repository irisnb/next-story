// 由已定案的应用图标 v3「04 开口」生成 Windows 图标资产。
//
// 设计决定（update-frontend-ui-v5 / frontend-ui-v5）：
// - 正式源在 src-tauri/icon-sources：16/20/24 独立光学稿，32 仅外框过渡，48+ 保持批准稿。
// - 历史 approved SVG 仅用于 before 对照，不修改。
// - 只更新 tauri.conf.json 实际引用的 Windows 图标：32x32.png、128x128.png、
//   128x128@2x.png 与 icon.ico。icon.icns 是 macOS 资源，产品只发行 Windows，
//   不重渲染、不盲改。
// - 不使用个人 PNG（发送彩蛋素材），不改真源 SVG。
//
// 实现：用仓库已有的 @tauri-apps/cli（内部 resvg）把 SVG 栅格化成 RGBA PNG，
// 再由本脚本组装多尺寸 ICO（<256 用 32 位 BMP/DIB 帧，256 用 PNG 帧，与
// `tauri icon` 惯例一致）。不引入任何新的第三方依赖；仅用 Node 内置模块。
//
// 运行：node scripts/generate-icons.mjs

import { Buffer } from 'node:buffer';
import { execFileSync } from 'node:child_process';
import console from 'node:console';
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { fileURLToPath, URL } from 'node:url';
import { deflateSync, inflateSync } from 'node:zlib';

const root = fileURLToPath(new URL('../', import.meta.url));
const sourceDir = join(root, 'src-tauri', 'icon-sources');
const standardSvg = join(sourceDir, '04-aperture.svg');
const approvedDir = join(root, '方向', '前端UI暂存-2026-10-09', 'Next-Story图标方案-v3');
const previewDir = join(root, 'openspec', 'changes', 'update-frontend-ui-v5', 'verification', 'icon-optical-r2-previews');
const iconsDir = join(root, 'src-tauri', 'icons');
const tauriCli = join(root, 'node_modules', '@tauri-apps', 'cli', 'tauri.js');

const smallSizes = [16, 20, 24];
const standardSizes = [32, 48, 64, 128, 256];
// ICO 帧顺序：小稿小尺寸在前，标准稿随后，256 收尾。
const icoPlan = [
  { size: 16, source: 'small' },
  { size: 20, source: 'small' },
  { size: 24, source: 'small' },
  { size: 32, source: 'standard' },
  { size: 48, source: 'standard' },
  { size: 64, source: 'standard' },
  { size: 128, source: 'standard' },
  { size: 256, source: 'standard' },
];

function runTauriIcon(svg, sizes, output) {
  execFileSync(
    process.execPath,
    [tauriCli, 'icon', svg, '-p', sizes.join(','), '-o', output],
    { stdio: 'inherit' },
  );
}

// 读取 resvg 产出的 RGBA PNG（bit depth 8, color type 6, 无隔行扫描）。
function decodePngRgba(buffer) {
  if (buffer.readUInt32BE(0) !== 0x89504e47 || buffer.readUInt32BE(4) !== 0x0d0a1a0a) {
    throw new Error('不是 PNG 文件');
  }
  let offset = 8;
  let width = 0;
  let height = 0;
  const idat = [];
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const dataStart = offset + 8;
    if (type === 'IHDR') {
      width = buffer.readUInt32BE(dataStart);
      height = buffer.readUInt32BE(dataStart + 4);
      const bitDepth = buffer.readUInt8(dataStart + 8);
      const colorType = buffer.readUInt8(dataStart + 9);
      const interlace = buffer.readUInt8(dataStart + 12);
      if (bitDepth !== 8 || colorType !== 6 || interlace !== 0) {
        throw new Error(`仅支持 8 位 RGBA 非隔行 PNG，当前 bitDepth=${bitDepth} colorType=${colorType} interlace=${interlace}`);
      }
    } else if (type === 'IDAT') {
      idat.push(buffer.subarray(dataStart, dataStart + length));
    } else if (type === 'IEND') {
      break;
    }
    offset = dataStart + length + 4;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const bpp = 4;
  const rowBytes = width * bpp;
  const out = Buffer.alloc(rowBytes * height);
  let prev = Buffer.alloc(rowBytes);
  let pos = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = raw[pos];
    pos += 1;
    const row = Buffer.from(raw.subarray(pos, pos + rowBytes));
    pos += rowBytes;
    for (let x = 0; x < rowBytes; x += 1) {
      const a = x >= bpp ? row[x - bpp] : 0;
      const b = prev[x];
      const c = x >= bpp ? prev[x - bpp] : 0;
      let value;
      switch (filter) {
        case 0: value = row[x]; break;
        case 1: value = row[x] + a; break;
        case 2: value = row[x] + b; break;
        case 3: value = row[x] + ((a + b) >> 1); break;
        case 4: {
          const p = a + b - c;
          const pa = Math.abs(p - a);
          const pb = Math.abs(p - b);
          const pc = Math.abs(p - c);
          value = row[x] + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
          break;
        }
        default: throw new Error(`未知 PNG 过滤器 ${filter}`);
      }
      row[x] = value & 0xff;
    }
    row.copy(out, y * rowBytes);
    prev = row;
  }
  return { width, height, data: out };
}

// 32 位 BMP/DIB 帧：BITMAPINFOHEADER(40) + BGRA 底到顶 + 1bpp AND 掩码。
function encodeBmpDib(rgba, width, height) {
  const headerSize = 40;
  const xorSize = width * height * 4;
  const andRowBytes = Math.ceil(width / 32) * 4;
  const andSize = andRowBytes * height;
  const buf = Buffer.alloc(headerSize + xorSize + andSize);
  buf.writeUInt32LE(headerSize, 0);
  buf.writeInt32LE(width, 4);
  buf.writeInt32LE(height * 2, 8);
  buf.writeUInt16LE(1, 12);
  buf.writeUInt16LE(32, 14);
  buf.writeUInt32LE(0, 16);
  buf.writeUInt32LE(xorSize, 20);
  let o = headerSize;
  for (let y = height - 1; y >= 0; y -= 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4;
      buf[o] = rgba[i + 2];
      buf[o + 1] = rgba[i + 1];
      buf[o + 2] = rgba[i];
      buf[o + 3] = rgba[i + 3];
      o += 4;
    }
  }
  return buf;
}

function buildIco(frames) {
  const count = frames.length;
  const dir = Buffer.alloc(6 + count * 16);
  dir.writeUInt16LE(0, 0);
  dir.writeUInt16LE(1, 2);
  dir.writeUInt16LE(count, 4);
  const blocks = [];
  let imageOffset = dir.length;
  frames.forEach((frame, i) => {
    const entry = 6 + i * 16;
    dir.writeUInt8(frame.size >= 256 ? 0 : frame.size, entry);
    dir.writeUInt8(frame.size >= 256 ? 0 : frame.size, entry + 1);
    dir.writeUInt8(0, entry + 2);
    dir.writeUInt8(0, entry + 3);
    dir.writeUInt16LE(1, entry + 4);
    dir.writeUInt16LE(32, entry + 6);
    dir.writeUInt32LE(frame.data.length, entry + 8);
    dir.writeUInt32LE(imageOffset, entry + 12);
    imageOffset += frame.data.length;
    blocks.push(frame.data);
  });
  return Buffer.concat([dir, ...blocks]);
}

function loadPng(path) {
  return decodePngRgba(readFileSync(path));
}

function pngChunk(type, data) {
  const body = Buffer.concat([Buffer.from(type), data]);
  let crc = 0xffffffff;
  for (const byte of body) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  const out = Buffer.alloc(data.length + 12);
  out.writeUInt32BE(data.length, 0);
  body.copy(out, 4);
  out.writeUInt32BE((crc ^ 0xffffffff) >>> 0, out.length - 4);
  return out;
}

function encodePng(width, height, data) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  const raw = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < height; y += 1) data.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  return Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), pngChunk('IHDR', header), pngChunk('IDAT', deflateSync(raw)), pngChunk('IEND', Buffer.alloc(0))]);
}

// Exact integer pixel placement/compositing; enlarged boards repeat pixels, never smooth.
function comparisonBoard(before, after, background, zoom) {
  const sizes = [16, 20, 24, 32];
  const width = 256;
  const height = 128;
  const pixels = Buffer.alloc(width * height * 4);
  for (let i = 0; i < pixels.length; i += 4) {
    pixels[i] = background; pixels[i + 1] = background; pixels[i + 2] = background; pixels[i + 3] = 255;
  }
  [before, after].forEach((paths, row) => sizes.forEach((size, col) => {
    const image = loadPng(paths[size]);
    const left = col * 64 + (64 - size) / 2;
    const top = row * 64 + (64 - size) / 2;
    for (let y = 0; y < size; y += 1) for (let x = 0; x < size; x += 1) {
      const src = (y * size + x) * 4;
      const dst = ((top + y) * width + left + x) * 4;
      const alpha = image.data[src + 3] / 255;
      for (let c = 0; c < 3; c += 1) pixels[dst + c] = Math.round(image.data[src + c] * alpha + background * (1 - alpha));
    }
  }));
  const enlarged = Buffer.alloc(width * height * zoom * zoom * 4);
  for (let y = 0; y < height * zoom; y += 1) for (let x = 0; x < width * zoom; x += 1) {
    const src = (Math.floor(y / zoom) * width + Math.floor(x / zoom)) * 4;
    pixels.copy(enlarged, (y * width * zoom + x) * 4, src, src + 4);
  }
  return encodePng(width * zoom, height * zoom, enlarged);
}

const tmp = mkdtempSync(join(tmpdir(), 'ns-icons-'));
try {
  const standardOut = join(tmp, 'standard');
  const smallPaths = {};
  for (const size of smallSizes) {
    const output = join(tmp, `optical-${size}`);
    runTauriIcon(join(sourceDir, `04-aperture-${size}.svg`), [size], output);
    smallPaths[size] = join(output, `${size}x${size}.png`);
  }
  runTauriIcon(standardSvg, standardSizes, standardOut);
  const bridgeOut = join(tmp, 'bridge-32');
  runTauriIcon(join(sourceDir, '04-aperture-32.svg'), [32], bridgeOut);

  const pngPaths = {
    small: smallPaths,
    standard: Object.fromEntries(standardSizes.map((s) => [s, join(standardOut, `${s}x${s}.png`)])),
  };
  pngPaths.standard[32] = join(bridgeOut, '32x32.png');

  // 直接引用的 PNG 图标（tauri.conf.json bundle.icon）。
  copyFileSync(pngPaths.standard[32], join(iconsDir, '32x32.png'));
  copyFileSync(pngPaths.standard[128], join(iconsDir, '128x128.png'));
  copyFileSync(pngPaths.standard[256], join(iconsDir, '128x128@2x.png'));

  // 多尺寸 ICO：独立光学稿供 16/20/24，256 用 PNG 帧。
  const frames = icoPlan.map(({ size, source }) => {
    const pngPath = pngPaths[source][size];
    if (size >= 256) {
      return { size, data: readFileSync(pngPath) };
    }
    const { width, height, data } = loadPng(pngPath);
    if (width !== size || height !== size) {
      throw new Error(`${pngPath} 尺寸为 ${width}x${height}，期望 ${size}x${size}`);
    }
    return { size, data: encodeBmpDib(data, width, height) };
  });
  writeFileSync(join(iconsDir, 'icon.ico'), buildIco(frames));

  const beforeStandard = join(tmp, 'before-standard');
  const before = {};
  for (const size of smallSizes) {
    const output = join(tmp, `before-${size}`);
    runTauriIcon(join(sourceDir, 'review-r1', `04-aperture-${size}.svg`), [size], output);
    before[size] = join(output, `${size}x${size}.png`);
  }
  runTauriIcon(join(approvedDir, '04-aperture.svg'), standardSizes, beforeStandard);
  before[32] = join(beforeStandard, '32x32.png');
  const after = { ...smallPaths, 32: pngPaths.standard[32] };
  mkdirSync(previewDir, { recursive: true });
  const metrics = [];
  for (const size of [16, 20, 24, 32]) {
    for (const [name, paths] of [['before', before], ['after', after]]) {
      copyFileSync(paths[size], join(previewDir, `${name}-${size}.png`));
      const image = loadPng(paths[size]);
      let dark = 0;
      for (let i = 0; i < image.data.length; i += 4) if (image.data[i + 3] > 127 && image.data[i] < 110) dark += 1;
      metrics.push({ name, size, darkPixels: dark, darkPercent: Number((100 * dark / (size * size)).toFixed(1)) });
    }
  }
  for (const [theme, background] of [['light', 243], ['dark', 32]]) for (const zoom of [1, 8]) {
    writeFileSync(join(previewDir, `${theme}-${zoom}x.png`), comparisonBoard(before, after, background, zoom));
  }
  writeFileSync(join(previewDir, 'metrics.json'), `${JSON.stringify(metrics, null, 2)}\n`);
  // Resource-only check: exact ICO plan, dimensions, 32-bit DIB bytes; 48+ unchanged.
  const ico = readFileSync(join(iconsDir, 'icon.ico'));
  if (ico.readUInt16LE(4) !== icoPlan.length) throw new Error('ICO frame count mismatch');
  frames.forEach((frame, index) => {
    const entry = 6 + index * 16;
    const offset = ico.readUInt32LE(entry + 12);
    const length = ico.readUInt32LE(entry + 8);
    if (ico[entry] !== (frame.size === 256 ? 0 : frame.size) || ico.readUInt16LE(entry + 6) !== 32 || !ico.subarray(offset, offset + length).equals(frame.data)) throw new Error(`ICO resource mismatch: ${frame.size}`);
  });
  for (const size of [48, 64, 128, 256]) {
    if (!readFileSync(join(beforeStandard, `${size}x${size}.png`)).equals(readFileSync(pngPaths.standard[size]))) throw new Error(`Standard ${size} changed unexpectedly`);
  }
  for (const [name, size] of [['32x32.png', 32], ['128x128.png', 128], ['128x128@2x.png', 256]]) {
    if (!readFileSync(join(iconsDir, name)).equals(readFileSync(pngPaths.standard[size]))) throw new Error(`Referenced PNG mismatch: ${name}`);
  }
  console.log('Resource check passed: 8 exact-size frames, 32-bit data, referenced PNGs exact; standard 48+ unchanged.');
  console.log('应用图标已生成：');
  console.log('  src-tauri/icons/32x32.png       (04-aperture-32.svg, border-only bridge)');
  console.log('  src-tauri/icons/128x128.png     (04-aperture.svg)');
  console.log('  src-tauri/icons/128x128@2x.png  (04-aperture.svg 256)');
  console.log('  src-tauri/icons/icon.ico        (16/20/24=optical, 32/48/64/128=BMP, 256=PNG)');
  console.log('  icon.icns 未改动（macOS 专用，产品只发行 Windows）。');
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
