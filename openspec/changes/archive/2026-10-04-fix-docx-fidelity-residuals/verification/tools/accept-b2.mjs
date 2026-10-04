// fix-docx-fidelity-residuals 真机验收 Phase B2：保存后重开复验（重载 → 重开作品 → 重开文档 → 比对块序列）
import { readFileSync, writeFileSync } from "node:fs";

const BASE = "http://127.0.0.1:9222";
const OUT = "D:\\Next Story\\本地测试文档\\导入冒烟证据\\保真-20261004";
const NAME = "保真复验-20261004";
const DOC = "acceptance-complex";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const js = (s) => JSON.stringify(s);

const targets = await (await fetch(`${BASE}/json/list`)).json();
const page = targets.find(
  (t) =>
    t.type === "page" &&
    !t.url.includes("devtools") &&
    (t.url.startsWith("http://localhost:1420") || t.url.startsWith("http://tauri.localhost")),
);
if (!page) {
  console.log("NO-PAGE");
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
const EXTRACT = `(() => { const ed = document.querySelector('.ProseMirror'); if (!ed) return { err: 'no-editor' };
  const clean = (s) => s.split(String.fromCharCode(160)).join(' ');
  const blocks = [...ed.children].map((el) => { const tag = el.tagName.toLowerCase();
    if (tag === 'ol' || tag === 'ul') { const start = el.hasAttribute('start') ? Number(el.getAttribute('start')) : 1;
      const children = [...el.children].map((li) => ({ tag: 'li', children: [...li.children].filter((c) => c.tagName === 'P').map((p) => ({ tag: 'p', text: clean(p.textContent) })) }));
      return { tag, start, children }; }
    return { tag, text: clean(el.textContent) }; });
  return { blockCount: blocks.length, blocks }; })()`;

console.log("== B2-1. 重载应用页 → 从最近列表重开作品 ==");
await cdp("Page.reload", {});
await sleep(4000);
const rec = await ev(
  `(() => { const leaf = [...document.querySelectorAll('*')].find((e) => e.children.length === 0 && e.textContent.trim().includes(${js(NAME)}) && e.offsetParent); if (!leaf) return null; const r = leaf.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`,
);
console.log("  recent-entry:", JSON.stringify(rec));
if (!rec) {
  console.log("RECENT-NOT-FOUND");
  process.exit(1);
}
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
if (!opened) process.exit(2);

console.log("== B2-2. 切「写作」→ 下拉重开导入文档 ==");
const tab = await ev(
  `(() => { const q = (sel) => [...document.querySelectorAll(sel)].filter((e) => e.offsetParent && e.textContent.trim() === '写作'); let els = q('button, [role=tab]'); if (!els.length) els = q('a, li, span, div'); if (!els.length) return null; const e = els[els.length - 1]; const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`,
);
if (tab) {
  await clickAt(tab.x, tab.y);
}
await sleep(1200);
const toggle = await ev(
  `(() => { const e = document.getElementById('current-doc-toggle'); if (!e) return null; e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`,
);
if (!toggle) {
  console.log("TOGGLE-NOT-FOUND");
  process.exit(3);
}
await clickAt(toggle.x, toggle.y);
await sleep(900);
const item = await ev(
  `(() => { const els = [...document.querySelectorAll('*')].filter((e) => e.offsetParent && e.children.length === 0 && e.textContent.trim() === ${js(DOC)}); if (!els.length) return null; const e = els[0]; e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`,
);
console.log("  dropdown-item:", JSON.stringify(item));
if (!item) {
  console.log("DROPDOWN-ITEM-NOT-FOUND");
  process.exit(4);
}
await clickAt(item.x, item.y);
let edOk = false;
for (let i = 0; i < 40; i++) {
  if (await ev(`(() => { const ed = document.querySelector('.ProseMirror'); return !!ed && ed.textContent.includes('BEGIN marker paragraph A01'); })()`)) {
    edOk = true;
    break;
  }
  await sleep(1000);
}
console.log("  editor-loaded:", edOk);
if (!edOk) process.exit(5);

console.log("== B2-3. 重开提取与比对 ==");
const ext = await ev(EXTRACT, 60000);
writeFileSync(`${OUT}\\extraction-reopened-ui.json`, JSON.stringify(ext, null, 2), "utf8");
const first = JSON.parse(readFileSync(`${OUT}\\extraction-after-ui.json`, "utf8"));
const same = JSON.stringify(first.blocks) === JSON.stringify(ext.blocks);
console.log("  reopened-equal:", same, " blockCount:", ext.blockCount);
await shot("acc-03-reopened.png");
console.log("B2-DONE");
ws.close();
process.exit(same ? 0 : 6);
