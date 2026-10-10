// read-real-llm-config.mjs — 安全读取正式应用 llm-config.json 的**白名单**字段。
// 授权（用户 2026-10-10 明确）：仅读取/输出 api_base_url、model、max_tokens（非秘密）。
// 绝不输出/读取 api_key 值；只报告 `api_key` 键是否存在（legacy 迁移风险）。
// 地址输出经脱敏（去 query / fragment / userinfo）。不写任何文件。
import { readFileSync, existsSync } from 'node:fs';

const candidates = [
  'C:/Users/Administrator/AppData/Local/com.nextstory.desktop/llm-config.json',
  'C:/Users/Administrator/AppData/Roaming/com.nextstory.desktop/llm-config.json',
];

function sanitizeUrl(raw) {
  if (typeof raw !== 'string') return null;
  try {
    const u = new URL(raw);
    u.search = '';
    u.hash = '';
    u.username = '';
    u.password = '';
    return u.toString().replace(/\/$/, '');
  } catch {
    return '<unparseable>';
  }
}

const out = { checked: [], chosen: null };
for (const path of candidates) {
  const entry = { path, exists: existsSync(path) };
  if (!entry.exists) { out.checked.push(entry); continue; }
  try {
    const json = JSON.parse(readFileSync(path, 'utf8'));
    entry.keys = Object.keys(json).sort();
    entry.legacyApiKeyPresent = Object.prototype.hasOwnProperty.call(json, 'api_key');
    if (entry.legacyApiKeyPresent) {
      // 仅报告存在，绝不输出值；调用方据此停止本路线。
      entry.note = 'LEGACY api_key key present — STOP route, do not migrate';
    } else {
      entry.api_base_url = sanitizeUrl(json.api_base_url);
      entry.model = typeof json.model === 'string' ? json.model : null;
      entry.max_tokens = typeof json.max_tokens === 'number' ? json.max_tokens : null;
    }
  } catch (error) {
    entry.error = String(error.message).slice(0, 200);
  }
  out.checked.push(entry);
  if (!out.chosen && entry.exists && entry.legacyApiKeyPresent === false) out.chosen = entry;
}
console.log(JSON.stringify(out, null, 2));
