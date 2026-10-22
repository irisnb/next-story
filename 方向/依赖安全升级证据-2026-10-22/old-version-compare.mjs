// old-version-compare.mjs — 从 npm cache 提取 dsh-session 0.1.0-rc.7 tarball，
// 解出 Session 的 events 属性实现，与 0.1.2 snapshotEvents 对照（只读查证，不改仓库）。
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const CACHE = 'C:\\Users\\Administrator\\AppData\\Local\\npm-cache\\_cacache';
const here = dirname(fileURLToPath(import.meta.url));

// 1) 在 index-v5 找 dsh-session-0.1.0-rc.7.tgz 条目
let entry = null;
for (const dir of readdirSync(join(CACHE, 'index-v5'), { recursive: true })) {
  const p = join(CACHE, 'index-v5', String(dir));
  let stat;
  try { stat = (await import('node:fs')).statSync(p); } catch { continue; }
  if (!stat.isFile()) continue;
  const text = readFileSync(p, 'utf8');
  for (const line of text.split('\n')) {
    const i = line.indexOf('\t');
    if (i < 0) continue;
    try {
      const j = JSON.parse(line.slice(i + 1));
      if (typeof j.key === 'string' && j.key.includes('dsh-session/-/dsh-session-0.1.0-rc.7.tgz')) {
        entry = j;
      }
    } catch { /* 非 JSON 行 */ }
  }
  if (entry) break;
}
if (!entry) { console.log('未找到 0.1.0-rc.7 tarball 缓存条目'); process.exit(0); }
console.log('integrity:', entry.integrity);

// 2) sha512 → hex → content-v2 路径
const b64 = entry.integrity.replace('sha512-', '');
const hex = Buffer.from(b64, 'base64').toString('hex');
const contentPath = join(CACHE, 'content-v2', 'sha512', hex.slice(0, 2), hex.slice(2, 4), hex.slice(4));
if (!existsSync(contentPath)) { console.log('content 不存在:', contentPath); process.exit(0); }
const tgz = join(here, 'dsh-session-0.1.0-rc.7.tgz');
writeFileSync(tgz, readFileSync(contentPath));

// 3) 解出 lib 里的 Session events 实现
const outDir = join(here, 'dsh-session-old');
execSync(`tar -xzf "${tgz}" -C "${here}"`, { cwd: here });
const idx = join(here, 'package', 'lib', 'index.js');
const src = readFileSync(idx, 'utf8');
const lines = src.split(/\r?\n/);
const hits = [];
lines.forEach((line, i) => {
  if (/get events|\bevents\b\s*[=;]|events\(\)|\bevents\b.*getter|expose.*events/.test(line)) hits.push(`${i + 1}: ${line.trim()}`);
});
console.log('---- 0.1.0-rc.7 lib/index.js 中 events 相关行 ----');
console.log(hits.slice(0, 40).join('\n') || '（无命中）');
// 顺带打出 constructor 与 snapshot/数组暴露附近的段落
const evIdx = lines.findIndex((l) => /get events/.test(l));
if (evIdx >= 0) {
  console.log('---- get events 上下文 ----');
  console.log(lines.slice(Math.max(0, evIdx - 6), evIdx + 10).map((l, k) => `${Math.max(0, evIdx - 6) + k + 1}: ${l}`).join('\n'));
}
