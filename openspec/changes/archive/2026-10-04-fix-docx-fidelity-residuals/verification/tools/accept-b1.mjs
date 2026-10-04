// fix-docx-fidelity-residuals 真机验收 Phase B1：
// 预检核对（应 1,141 字 / 符号丢弃 2 处 / 编号降级 5 处 / 无样式损耗）
// → 点【确认导入】→ 记录导入后树（既有条目应不变）→ 下拉打开文档
// → 提取块序列（textContent 保留双空格）→ 样式探针 → Ctrl+S 保存
import { readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";

const BASE = "http://127.0.0.1:9222";
const OUT = "D:\\Next Story\\本地测试文档\\导入冒烟证据\\保真-20261004";
const ROOT = "C:\\Users\\Administrator\\Desktop\\test\\保真复验-20261004";
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
async function clickDom(id) {
  const r = await ev(
    `(() => { const e = document.getElementById(${js(id)}); e.scrollIntoView({ block: 'center' }); const b = e.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; })()`,
  );
  await clickAt(r.x, r.y);
}
const EXTRACT = `(() => { const ed = document.querySelector('.ProseMirror'); if (!ed) return { err: 'no-editor' };
  const clean = (s) => s.split(String.fromCharCode(160)).join(' ');
  const blocks = [...ed.children].map((el) => { const tag = el.tagName.toLowerCase();
    if (tag === 'ol' || tag === 'ul') { const start = el.hasAttribute('start') ? Number(el.getAttribute('start')) : 1;
      const children = [...el.children].map((li) => ({ tag: 'li', children: [...li.children].filter((c) => c.tagName === 'P').map((p) => ({ tag: 'p', text: clean(p.textContent) })) }));
      return { tag, start, children }; }
    return { tag, text: clean(el.textContent) }; });
  return { blockCount: blocks.length, blocks }; })()`;

console.log("== B1-1. 等预检对话框（用户已选文件） ==");
let open = false;
for (let i = 0; i < 240; i++) {
  const r = await ev(`(() => { const d = document.getElementById('document-import-dialog'); return d ? !!d.open : null; })()`);
  if (r === true) {
    open = true;
    break;
  }
  await sleep(500);
}
if (!open) {
  console.log("PRECHECK-NOT-OPEN（预检未出现：用户是否已完成选择？）");
  process.exit(2);
}

console.log("== B1-2. 预检核对与留证 ==");
const state = await ev(`(() => { const g = (id) => document.getElementById(id); return {
  open: g('document-import-dialog').open,
  conclusion: g('document-import-conclusion').textContent,
  structure: g('document-import-structure').textContent,
  lossItems: [...g('document-import-loss-list').children].map((li) => li.textContent),
  lossesHidden: g('document-import-losses').classList.contains('hidden'),
  splitHidden: g('document-import-split-field').classList.contains('hidden'),
  splitMarkerLabel: g('document-import-split-marker-label').textContent,
  splitWholeChecked: g('document-import-split-whole').checked,
  targetValue: g('document-import-target').value,
  mdNoteHidden: g('document-import-note').classList.contains('hidden'),
}; })()`);
writeFileSync(`${OUT}\\precheck-after.json`, JSON.stringify(state, null, 2), "utf8");
console.log(JSON.stringify(state, null, 1));
await shot("acc-01-precheck.png");
const checks = {
  charCount1141: state.conclusion.includes("1,141"),
  symbolDropped2: state.lossItems.some((t) => t.includes("符号字符丢弃：2 处")),
  noStyleLoss: !state.lossItems.some((t) => t.includes("样式")),
  numbering5: state.lossItems.some((t) => t.includes("编号降级为普通段落：5 处")),
};
console.log("  checks:", JSON.stringify(checks));
if (!(checks.charCount1141 && checks.symbolDropped2 && checks.noStyleLoss && checks.numbering5)) {
  console.log("PRECHECK-MISMATCH：停止，不点确认");
  ws.close();
  process.exit(3);
}

console.log("== B1-3. 点【确认导入】（生产按钮） ==");
await clickDom("btn-document-import-confirm");
let closed = false;
for (let i = 0; i < 240; i++) {
  const r = await ev(`(() => { const d = document.getElementById('document-import-dialog'); return d ? !!d.open : false; })()`);
  if (r === false) {
    closed = true;
    break;
  }
  await sleep(500);
}
console.log("  dialog-closed:", closed);
try {
  execSync('powershell -NoProfile -Command "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait(\'{ENTER}\')"', { stdio: "pipe" });
} catch {}
await sleep(1500);

console.log("== B1-4. 导入后树（既有条目应不变） ==");
const treeAfter = await ev(
  `(async () => { const api = await import('/src/project-api.ts'); return await api.openContentTree(${js(ROOT)}); })()`,
  90000,
);
writeFileSync(`${OUT}\\tree-after.json`, JSON.stringify(treeAfter, null, 2), "utf8");
const before = JSON.parse(readFileSync(`${OUT}\\tree-before.json`, "utf8"));
const beforeIds = Object.keys(before.nodes || {});
const stable = beforeIds.every((id) => treeAfter.nodes && treeAfter.nodes[id] && treeAfter.nodes[id].name === before.nodes[id].name);
const newIds = Object.keys(treeAfter.nodes || {}).filter((id) => !beforeIds.includes(id));
console.log(
  "  before-stable:",
  stable,
  " new-nodes:",
  JSON.stringify(newIds.map((id) => ({ id, name: treeAfter.nodes[id].name, kind: treeAfter.nodes[id].node_type || treeAfter.nodes[id].kind || treeAfter.nodes[id].type }))),
);

console.log("== B1-5. 切「写作」→ 下拉打开导入文档 ==");
const tab = await ev(
  `(() => { const q = (sel) => [...document.querySelectorAll(sel)].filter((e) => e.offsetParent && e.textContent.trim() === '写作'); let els = q('button, [role=tab]'); if (!els.length) els = q('a, li, span, div'); if (!els.length) return null; const e = els[els.length - 1]; const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`,
);
if (tab) {
  await clickAt(tab.x, tab.y);
}
await sleep(1200);
await clickDom("current-doc-toggle");
await sleep(900);
const item = await ev(
  `(() => { const els = [...document.querySelectorAll('*')].filter((e) => e.offsetParent && e.children.length === 0 && e.textContent.trim() === ${js(DOC)}); if (!els.length) return null; const e = els[0]; e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`,
);
console.log("  dropdown-item:", JSON.stringify(item));
if (!item) {
  console.log("DROPDOWN-ITEM-NOT-FOUND");
  ws.close();
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
if (!edOk) {
  ws.close();
  process.exit(5);
}

console.log("== B1-6. 提取块序列 ==");
const ext = await ev(EXTRACT, 60000);
writeFileSync(`${OUT}\\extraction-after-ui.json`, JSON.stringify(ext, null, 2), "utf8");
console.log("  blockCount:", ext.blockCount);
await shot("acc-02-editor-after-import.png");

console.log("== B1-7. 样式探针 ==");
const probe = await ev(`(() => { const ed = document.querySelector('.ProseMirror'); if (!ed) return { err: 'no-editor' };
  const findByText = (txt) => { const w = document.createTreeWalker(ed, NodeFilter.SHOW_TEXT); let n; while ((n = w.nextNode())) { if (n.textContent.includes(txt)) return n.parentElement; } return null; };
  const cs = (el) => (el ? getComputedStyle(el) : null);
  const para = (el) => (el ? el.closest('p') : null);
  const latin = findByText('A03 AcceptanceBase');
  const cjk = findByText('中文运行保持原样');
  const p1 = para(findByText('BEGIN marker paragraph A01'));
  const p3 = para(findByText('A03 AcceptanceBase'));
  return {
    latin: latin ? { fontFamily: cs(latin).fontFamily, fontSize: cs(latin).fontSize } : null,
    cjk: cjk ? { fontFamily: cs(cjk).fontFamily } : null,
    p1: p1 ? { lineHeight: cs(p1).lineHeight, fontSize: cs(p1).fontSize } : null,
    p3: p3 ? { lineHeight: cs(p3).lineHeight, fontSize: cs(p3).fontSize } : null,
  }; })()`);
writeFileSync(`${OUT}\\ui-style-probe.json`, JSON.stringify(probe, null, 2), "utf8");
console.log("  probe:", JSON.stringify(probe));

console.log("== B1-8. Ctrl+S 保存 ==");
await cdp("Input.dispatchKeyEvent", { type: "keyDown", modifiers: 2, key: "s", code: "KeyS", windowsVirtualKeyCode: 83, nativeVirtualKeyCode: 83 });
await cdp("Input.dispatchKeyEvent", { type: "keyUp", modifiers: 2, key: "s", code: "KeyS", windowsVirtualKeyCode: 83, nativeVirtualKeyCode: 83 });
await sleep(1500);
console.log("B1-DONE");
ws.close();
process.exit(0);
