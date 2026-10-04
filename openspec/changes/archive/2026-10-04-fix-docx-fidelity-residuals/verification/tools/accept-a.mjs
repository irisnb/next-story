// fix-docx-fidelity-residuals 真机验收 Phase A：
// 创建新鲜可弃作品（生产命令·页面 API）→ 记录最近作品 → 重载 → 从最近列表打开
// → 记录起始树 → 切到「文件管理」视图 → 确认导入入口可见（不点击，交给用户）
import { writeFileSync, mkdirSync } from "node:fs";

const BASE = "http://127.0.0.1:9222";
const OUT = "D:\\Next Story\\本地测试文档\\导入冒烟证据\\保真-20261004";
const PARENT = "C:\\Users\\Administrator\\Desktop\\test";
const NAME = "保真复验-20261004";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
mkdirSync(OUT, { recursive: true });

const targets = await (await fetch(`${BASE}/json/list`)).json();
const page = targets.find(
  (t) =>
    t.type === "page" &&
    !t.url.includes("devtools") &&
    (t.url.startsWith("http://localhost:1420") || t.url.startsWith("http://tauri.localhost")),
);
if (!page) {
  console.log("NO-PAGE:", JSON.stringify(targets.map((t) => t.url)));
  process.exit(1);
}
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => {
  ws.onopen = res;
  ws.onerror = rej;
});
let seq = 0;
const pending = new Map();
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) {
    pending.get(m.id)(m);
    pending.delete(m.id);
  }
};
function cdp(method, params = {}, timeoutMs = 30000) {
  const id = ++seq;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`timeout ${method}`));
    }, timeoutMs);
    pending.set(id, (m) => {
      clearTimeout(timer);
      m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result);
    });
    ws.send(JSON.stringify({ id, method, params }));
  });
}
async function ev(expression, timeoutMs = 60000) {
  const r = await cdp("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }, timeoutMs);
  if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 600));
  return r.result.value;
}
async function shot(name) {
  const r = await cdp("Page.captureScreenshot", { format: "png" });
  writeFileSync(`${OUT}\\${name}`, Buffer.from(r.data, "base64"));
  console.log(`  [截图] ${name}`);
}
async function clickAt(x, y) {
  await cdp("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
  await cdp("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
}

console.log("== A1. 创建新鲜可弃作品 ==");
const created = await ev(
  `(async () => { const api = await import('/src/project-api.ts'); try { const root = await api.createProject(${JSON.stringify(NAME)}, ${JSON.stringify(PARENT)}); return { ok: true, root }; } catch (e) { return { ok: false, error: String(e) }; } })()`,
  120000,
);
console.log("  ", JSON.stringify(created));
if (!created.ok) process.exit(1);
const ROOT = created.root;
writeFileSync(`${OUT}\\project-root.txt`, ROOT, "utf8");

console.log("== A2. 记录最近作品 → 重载 → 从最近列表打开 ==");
await ev(
  `(async () => { const api = await import('/src/project-api.ts'); await api.recordRecentWork(${JSON.stringify(NAME)}, ${JSON.stringify(ROOT)}); return true; })()`,
);
await cdp("Page.reload", {});
await sleep(4000);
const rec = await ev(
  `(() => { const leaf = [...document.querySelectorAll('*')].find((e) => e.children.length === 0 && e.textContent.trim().includes(${JSON.stringify(NAME)}) && e.offsetParent); if (!leaf) return null; const r = leaf.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`,
);
console.log("  recent-entry:", JSON.stringify(rec));
if (!rec) process.exit(1);
await clickAt(rec.x, rec.y);
let opened = false;
for (let i = 0; i < 30; i++) {
  await sleep(1000);
  if (await ev(`document.body.innerText.includes('写作') && document.body.innerText.includes('文件管理')`)) {
    opened = true;
    break;
  }
}
console.log("  workspace-opened:", opened);
if (!opened) process.exit(1);

console.log("== A3. 记录起始树 ==");
const treeBefore = await ev(
  `(async () => { const api = await import('/src/project-api.ts'); return await api.openContentTree(${JSON.stringify(ROOT)}); })()`,
  60000,
);
writeFileSync(`${OUT}\\tree-before.json`, JSON.stringify(treeBefore, null, 2), "utf8");
console.log("  nodes:", treeBefore && treeBefore.nodes ? Object.keys(treeBefore.nodes).length : "?", " root_children:", treeBefore && treeBefore.root_children ? treeBefore.root_children.length : "?");

console.log("== A4. 切到「文件管理」视图 ==");
let switched = false;
for (let i = 0; i < 12; i++) {
  const hit = await ev(
    `(() => { const q = (sel) => [...document.querySelectorAll(sel)].filter((e) => e.offsetParent && e.textContent.trim() === '文件管理'); let els = q('button, [role=tab]'); if (!els.length) els = q('a, li, span, div'); if (!els.length) return null; const e = els[els.length - 1]; const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, tag: e.tagName, cls: String(e.className).slice(0, 60) }; })()`,
  );
  if (hit) {
    await clickAt(hit.x, hit.y);
    switched = true;
    console.log("  clicked:", JSON.stringify(hit));
    break;
  }
  await sleep(500);
}
if (!switched) {
  console.log("  NAV-NOT-FOUND");
  process.exit(1);
}
await sleep(1500);

console.log("== A5. 确认导入入口可见（不点击） ==");
const entry = await ev(
  `(() => { const b = document.getElementById('fm-import-document'); if (!b) return null; b.scrollIntoView({ block: 'center' }); const r = b.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, text: b.textContent.trim(), disabled: b.disabled }; })()`,
);
console.log("  import-entry:", JSON.stringify(entry));
await shot("acc-00-file-management.png");
console.log("== A-完成：等待用户点【导入文档】并选择文件 ==");
ws.close();
process.exit(0);
