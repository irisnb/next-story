// 只读图标诊断：解析 PE 可执行内嵌图标资源（RT_GROUP_ICON / RT_ICON），
// 与本仓库 src-tauri/icons/icon.ico 的帧逐字节比对，并报告各帧尺寸/类型/alpha。
// 不修改应用、不删缓存、不写生产目录；只读取并在 approved temp 下导出供观察的图。
//
// 运行：node openspec/changes/update-frontend-ui-v5/verification/icon-diagnosis.mjs

import { Buffer } from 'node:buffer';
import { readFileSync } from 'node:fs';
import console from 'node:console';
import process from 'node:process';
import { fileURLToPath, URL } from 'node:url';
import { inflateSync } from 'node:zlib';

const root = fileURLToPath(new URL('../../../../', import.meta.url));
const icoPath = `${root}src-tauri/icons/icon.ico`;
const exes = [
  { tag: 'debug', path: `${root}src-tauri/target/debug/next-story.exe` },
  { tag: 'release', path: `${root}src-tauri/target/release/next-story.exe` },
];

function parseIco(buffer) {
  const count = buffer.readUInt16LE(4);
  const frames = [];
  for (let i = 0; i < count; i += 1) {
    const entry = 6 + i * 16;
    const width = buffer.readUInt8(entry) || 256;
    const height = buffer.readUInt8(entry + 1) || 256;
    const size = buffer.readUInt32LE(entry + 8);
    const offset = buffer.readUInt32LE(entry + 12);
    const raw = Buffer.from(buffer.subarray(offset, offset + size));
    const isPng = raw.readUInt32BE(0) === 0x89504e47;
    frames.push({ size: width, height, bytes: raw, kind: isPng ? 'png' : 'bmp' });
  }
  return frames;
}

// 解码 ICO 内的 32 位 BMP/DIB 帧，返回 BGRA 像素（用于 alpha 统计）。
function dibAlphaStats(frame) {
  const raw = frame.bytes;
  const width = raw.readInt32LE(4);
  const height = raw.readInt32LE(8) / 2;
  const xor = raw.subarray(40, 40 + width * height * 4);
  let transparent = 0;
  let opaque = 0;
  let intermediate = 0;
  for (let i = 3; i < xor.length; i += 4) {
    const a = xor[i];
    if (a < 20) transparent += 1;
    else if (a > 235) opaque += 1;
    else intermediate += 1;
  }
  return { width, height, transparent, opaque, intermediate };
}

function decodePngRgba(buffer) {
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
      if (filter === 0) value = row[x];
      else if (filter === 1) value = row[x] + a;
      else if (filter === 2) value = row[x] + b;
      else if (filter === 3) value = row[x] + ((a + b) >> 1);
      else {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        value = row[x] + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
      }
      row[x] = value & 0xff;
    }
    row.copy(out, y * rowBytes);
    prev = row;
  }
  return { width, height, data: out };
}

// 解析 PE 资源目录，返回 RT_ICON / RT_GROUP_ICON 资源字节。
function parsePeResources(buffer) {
  const peOffset = buffer.readUInt32LE(0x3c);
  if (buffer.toString('ascii', peOffset, peOffset + 4) !== 'PE\u0000\u0000') {
    throw new Error('不是有效的 PE 文件');
  }
  const coff = peOffset + 4;
  const sectionCount = buffer.readUInt16LE(coff + 2);
  const optionalHeaderSize = buffer.readUInt16LE(coff + 16);
  const opt = coff + 20;
  const magic = buffer.readUInt16LE(opt);
  const is64 = magic === 0x20b;
  const dataDirOffset = opt + (is64 ? 112 : 96);
  const resourceRva = buffer.readUInt32LE(dataDirOffset + 2 * 8);
  const sections = [];
  let s = opt + optionalHeaderSize;
  for (let i = 0; i < sectionCount; i += 1) {
    sections.push({
      virtualAddress: buffer.readUInt32LE(s + 12),
      virtualSize: buffer.readUInt32LE(s + 8),
      rawSize: buffer.readUInt32LE(s + 16),
      rawPointer: buffer.readUInt32LE(s + 20),
    });
    s += 40;
  }
  const rvaToOffset = (rva) => {
    for (const sec of sections) {
      const span = Math.max(sec.virtualSize, sec.rawSize);
      if (rva >= sec.virtualAddress && rva < sec.virtualAddress + span) {
        return sec.rawPointer + (rva - sec.virtualAddress);
      }
    }
    return -1;
  };
  const resourceBase = rvaToOffset(resourceRva);
  const readDir = (offset) => {
    const numberNamed = buffer.readUInt16LE(offset + 12);
    const numberId = buffer.readUInt16LE(offset + 14);
    const total = numberNamed + numberId;
    const entries = [];
    for (let i = 0; i < total; i += 1) {
      const entryOffset = offset + 16 + i * 8;
      const nameField = buffer.readUInt32LE(entryOffset);
      const offsetField = buffer.readUInt32LE(entryOffset + 4);
      entries.push({
        id: (nameField & 0x80000000) ? null : (nameField & 0x7fffffff),
        isDir: (offsetField & 0x80000000) !== 0,
        offset: offsetField & 0x7fffffff,
      });
    }
    return entries;
  };
  if (process.env.ICON_DIAG_DEBUG) {
    console.log(`  [debug] peOffset=${peOffset} is64=${is64} resourceRva=0x${resourceRva.toString(16)} resourceBase=${resourceBase}`);
    console.log(`  [debug] sectionCount=${sectionCount} optionalHeaderSize=${optionalHeaderSize} magic=0x${magic.toString(16)}`);
    try {
      const types = readDir(resourceBase).map((e) => `${e.id}${e.isDir ? '/' : ''}`).join(',');
      console.log(`  [debug] top-level types=${types}`);
    } catch (error) {
      console.log(`  [debug] readDir failed: ${error.message}`);
    }
  }
  const readDataEntry = (offset) => {
    const rva = buffer.readUInt32LE(offset);
    const size = buffer.readUInt32LE(offset + 4);
    const fileOff = rvaToOffset(rva);
    return Buffer.from(buffer.subarray(fileOff, fileOff + size));
  };
  const collect = (typeId) => {
    const map = new Map();
    const typeEntry = readDir(resourceBase).find((e) => e.id === typeId);
    if (!typeEntry || !typeEntry.isDir) return map;
    for (const nameEntry of readDir(resourceBase + typeEntry.offset)) {
      if (!nameEntry.isDir) continue;
      const languageEntry = readDir(resourceBase + nameEntry.offset).find((e) => !e.isDir);
      if (!languageEntry) continue;
      map.set(nameEntry.id, readDataEntry(resourceBase + languageEntry.offset));
    }
    return map;
  };
  return { rtIcon: collect(3), rtGroupIcon: collect(14) };
}

function parseGroupDir(data) {
  const count = data.readUInt16LE(4);
  const entries = [];
  for (let i = 0; i < count; i += 1) {
    const offset = 6 + i * 14;
    entries.push({
      width: data.readUInt8(offset) || 256,
      height: data.readUInt8(offset + 1) || 256,
      bytesInRes: data.readUInt32LE(offset + 8),
      iconId: data.readUInt16LE(offset + 12),
    });
  }
  return entries;
}

const icoBuffer = readFileSync(icoPath);
const frames = parseIco(icoBuffer);
console.log(`icon.ico: ${frames.length} frames`);
for (const frame of frames) {
  if (frame.kind === 'bmp') {
    const stats = dibAlphaStats(frame);
    console.log(`  ${frame.size}x${frame.size} ${frame.kind} bytes=${frame.bytes.length} transparent=${stats.transparent} intermediate=${stats.intermediate} opaque=${stats.opaque}`);
  } else {
    const decoded = decodePngRgba(frame.bytes);
    let transparent = 0;
    let intermediate = 0;
    let opaque = 0;
    for (let i = 3; i < decoded.data.length; i += 4) {
      const a = decoded.data[i];
      if (a < 20) transparent += 1;
      else if (a > 235) opaque += 1;
      else intermediate += 1;
    }
    console.log(`  ${frame.size}x${frame.size} ${frame.kind} bytes=${frame.bytes.length} transparent=${transparent} intermediate=${intermediate} opaque=${opaque}`);
  }
}

const icoFrameBySize = new Map(frames.map((f) => [f.size, f.bytes]));

for (const exe of exes) {
  console.log(`\n===== ${exe.tag}: ${exe.path} =====`);
  let pe;
  try {
    pe = parsePeResources(readFileSync(exe.path));
  } catch (error) {
    console.log(`  解析失败: ${error.message}`);
    continue;
  }
  console.log(`  RT_GROUP_ICON groups=${pe.rtGroupIcon.size} RT_ICON images=${pe.rtIcon.size}`);
  for (const [groupId, groupData] of pe.rtGroupIcon) {
    const declared = parseGroupDir(groupData);
    console.log(`  group ${groupId}: declares ${declared.length} frames`);
    for (const entry of declared) {
      const image = pe.rtIcon.get(entry.iconId);
      const icoFrame = icoFrameBySize.get(entry.width);
      const byteMatch = image && icoFrame && image.equals(icoFrame);
      console.log(`    ${entry.width}x${entry.height} bytesInRes=${entry.bytesInRes} rtIcon=${entry.iconId} present=${Boolean(image)} matchesIcoFrame=${Boolean(byteMatch)}`);
    }
  }
}

console.log('\n结论提示：matchesIcoFrame=true 表示 exe 内嵌的就是本仓库生成的 icon.ico 对应帧。');
