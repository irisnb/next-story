// configure-isolated-from-real.mjs — 把正式应用 llm-config.json 的**白名单**字段
// （api_base_url / model / max_tokens）写入隔离实例 com.nextstory.acceptance 的配置。
// 授权（用户 2026-10-10）：只写这三个非秘密字段，**不含 api_key 键**；不调用 save_llm_config；
// 不改正式配置/钥匙串；api_key 由隔离实例经既有 keyring 只读 get 复用。
// 安全：若源文件含 legacy `api_key` 键则中止本路线，绝不触发 migration。
import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync } from 'node:fs';

const SRC = 'C:/Users/Administrator/AppData/Local/com.nextstory.desktop/llm-config.json';
const DST_DIR = 'C:/Users/Administrator/AppData/Local/com.nextstory.acceptance';
const DST = `${DST_DIR}/llm-config.json`;

if (!SRC.includes('com.nextstory.desktop')) throw new Error('拒绝：源非正式应用目录');
if (!DST_DIR.includes('com.nextstory.acceptance')) throw new Error('拒绝：目标非隔离 acceptance 目录');
if (!existsSync(SRC)) throw new Error('源配置不存在，停止');

const json = JSON.parse(readFileSync(SRC, 'utf8'));
if (Object.prototype.hasOwnProperty.call(json, 'api_key')) {
  console.log(JSON.stringify({ aborted: true, reason: 'source contains legacy api_key key; route stopped' }));
  process.exit(2);
}

const out = {};
if (typeof json.api_base_url === 'string') out.api_base_url = json.api_base_url;
if (typeof json.model === 'string') out.model = json.model;
if (typeof json.max_tokens === 'number') out.max_tokens = json.max_tokens;
if (!out.api_base_url || !out.model) throw new Error('源缺少 api_base_url/model，停止');

mkdirSync(DST_DIR, { recursive: true });
if (existsSync(DST)) copyFileSync(DST, `${DST}.cdp-bak`);
writeFileSync(DST, JSON.stringify(out, null, 2), 'utf8');

function sanitize(raw) { try { const u = new URL(raw); u.search = ''; u.hash = ''; u.username = ''; u.password = ''; return u.toString().replace(/\/$/, ''); } catch { return '<unparseable>'; } }
console.log(JSON.stringify({ wrote: DST, fields: { api_base_url: sanitize(out.api_base_url), model: out.model, max_tokens: out.max_tokens ?? null }, hadApiKeyKey: false }, null, 2));
