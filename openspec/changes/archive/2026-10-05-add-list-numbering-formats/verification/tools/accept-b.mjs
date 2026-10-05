// add-list-numbering-formats 真机验收 Phase B：
// 预检核对（1,141 字 / 符号丢弃 2 / 编号降级 5 / 无编号样式降级）→ 确认导入
// → 树对比 → 打开文档 → 提取（含列表样式）→ 字母列表断言 → 全序列比对
// → 样式探针 → 子菜单冒烟（嵌套/切换/撤销）→ Ctrl+S
import { readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";

const BASE = "http://127.0.0.1:9222";
const OUT = "D:\\Next Story\\本地测试文档\\导入冒烟证据\\编号-20261005";
const ROOT = "C:\\Users\\Administrator\\Desktop\\test\\编号复验-20261005";
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
async function doubleClickAt(x, y) {
  await clickAt(x, y);
  await cdp("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 2 });
  await cdp("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 2 });
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
      const type = tag === 'ol' ? (el.getAttribute('type') || '1') : undefined;
      const children = [...el.children].map((li) => ({ tag: 'li', children: [...li.children].filter((c) => c.tagName === 'P').map((p) => ({ tag: 'p', text: clean(p.textContent) })) }));
      return { tag, start, type, children }; }
    return { tag, text: clean(el.textContent) }; });
  return { blockCount: blocks.length, blocks }; })()`;

console.log("== B1. 等预检对话框（用户已选文件） ==");
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

console.log("== B2. 预检核对与留证 ==");
const state = await ev(`(() => { const g = (id) => document.getElementById(id); return {
  open: g('document-import-dialog').open,
  conclusion: g('document-import-conclusion').textContent,
  structure: g('document-import-structure').textContent,
  lossItems: [...g('document-import-loss-list').children].map((li) => li.textContent),
  lossesHidden: g('document-import-losses').classList.contains('hidden'),
  splitHidden: g('document-import-split-field').classList.contains('hidden'),
  splitWholeChecked: g('document-import-split-whole').checked,
  targetValue: g('document-import-target').value,
  mdNoteHidden: g('document-import-note').classList.contains('hidden'),
}; })()`);
writeFileSync(`${OUT}\\precheck-after.json`, JSON.stringify(state, null, 2), "utf8");
console.log(JSON.stringify(state, null, 1));
await shot("acc-01-precheck.png");
const joined = state.lossItems.join("\n");
const checks = {
  charCount1141: state.conclusion.includes("1,141"),
  symbolDropped2: joined.includes("符号字符丢弃：2 处"),
  numbering5: joined.includes("编号降级为普通段落：5 处"),
  noStyleLoss: !joined.includes("样式"),
  noFormatDegraded: !joined.includes("编号格式降级"),
};
console.log("  checks:", JSON.stringify(checks));
if (!(checks.charCount1141 && checks.symbolDropped2 && checks.numbering5 && checks.noStyleLoss && checks.noFormatDegraded)) {
  console.log("PRECHECK-MISMATCH：停止，不点确认");
  ws.close();
  process.exit(3);
}

console.log("== B3. 点【确认导入】（生产按钮） ==");
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

console.log("== B4. 导入后树 ==");
const treeAfter = await ev(
  `(async () => { const api = await import('/src/project-api.ts'); return await api.openContentTree(${js(ROOT)}); })()`,
  90000,
);
writeFileSync(`${OUT}\\tree-after.json`, JSON.stringify(treeAfter, null, 2), "utf8");
const before = JSON.parse(readFileSync(`${OUT}\\tree-before.json`, "utf8"));
const beforeIds = Object.keys(before.nodes || {});
const stable = beforeIds.every((id) => treeAfter.nodes && treeAfter.nodes[id] && treeAfter.nodes[id].name === before.nodes[id].name);
const newIds = Object.keys(treeAfter.nodes || {}).filter((id) => !beforeIds.includes(id));
console.log("  before-stable:", stable, " new-nodes:", JSON.stringify(newIds.map((id) => ({ id, name: treeAfter.nodes[id].name }))));
const docEntry = Object.entries(treeAfter.nodes || {}).find(([, n]) => n.name === DOC && (n.node_type === "Document" || n.kind === "Document" || n.type === "Document"));
console.log("  doc-entry:", docEntry ? docEntry[0] : "NOT-FOUND");

console.log("== B5. 切「写作」→ 下拉打开导入文档 ==");
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

console.log("== B6. 提取 + 字母列表断言 ==");
const ext = await ev(EXTRACT, 60000);
writeFileSync(`${OUT}\\extraction-after-ui.json`, JSON.stringify(ext, null, 2), "utf8");
console.log("  blockCount:", ext.blockCount);
const listInv = ext.blocks
  .filter((b) => b.tag === "ol")
  .map((b, i) => ({ i, start: b.start, type: b.type || "1", first: b.children?.[0]?.children?.[0]?.text ?? "" }));
console.log("  ordered-lists:", JSON.stringify(listInv));
const alpha = listInv.filter((l) => l.type === "A");
console.log("  alpha-lists:", JSON.stringify(alpha));
const alphaOk = alpha.length >= 3 && alpha.some((l) => l.start === 1) && alpha.some((l) => l.start === 2) && alpha.some((l) => l.start === 3);
console.log("  alpha-starts(1/2/3):", alphaOk);

// 全序列与归档比对（预期仅 SYM01 段一处差异）
const oldExtract = JSON.parse(readFileSync("D:\\Next Story\\openspec\\changes\\archive\\2026-10-03-verify-import-fidelity-ui\\verification\\evidence-docx\\first-extraction.json", "utf8"));
const oldTexts = oldExtract.docStruct.blocks.map((b) =>
  b.text !== undefined ? b.text : (b.children ?? []).map((li) => (li.children ?? []).map((p) => p.text ?? "").join("")).join("\n"),
);
const newTexts = ext.blocks.map((b) =>
  b.tag === "ol" || b.tag === "ul" ? (b.children ?? []).map((li) => (li.children ?? []).map((p) => p.text ?? "").join("")).join("\n") : b.text ?? "",
);
const diffs = [];
for (let i = 0; i < Math.max(oldTexts.length, newTexts.length); i++) {
  if (oldTexts[i] !== newTexts[i]) diffs.push(i);
}
console.log("  seq: old", oldTexts.length, "new", newTexts.length, "diff-indexes:", JSON.stringify(diffs));
await shot("acc-02-editor-after-import.png");

console.log("== B7. 样式探针 ==");
const probe = await ev(`(() => { const ed = document.querySelector('.ProseMirror'); if (!ed) return { err: 'no-editor' };
  const findByText = (txt) => { const w = document.createTreeWalker(ed, NodeFilter.SHOW_TEXT); let n; while ((n = w.nextNode())) { if (n.textContent.includes(txt)) return n.parentElement; } return null; };
  const cs = (el) => (el ? getComputedStyle(el) : null); const para = (el) => (el ? el.closest('p') : null);
  const latin = findByText('A03 AcceptanceBase'); const cjk = findByText('中文运行保持原样');
  const p1 = para(findByText('BEGIN marker paragraph A01')); const p3 = para(findByText('A03 AcceptanceBase'));
  return { latin: latin ? { fontFamily: cs(latin).fontFamily } : null, cjk: cjk ? { fontFamily: cs(cjk).fontFamily } : null,
    p1: p1 ? { lineHeight: cs(p1).lineHeight } : null, p3: p3 ? { lineHeight: cs(p3).lineHeight } : null }; })()`);
writeFileSync(`${OUT}\\ui-style-probe.json`, JSON.stringify(probe, null, 2), "utf8");
console.log("  probe:", JSON.stringify(probe));

console.log("== B8. 子菜单冒烟（选中字母列表项 → 切换 I → 撤销） ==");
const target = await ev(
  `(() => { const w = document.createTreeWalker(document.querySelector('.ProseMirror'), NodeFilter.SHOW_TEXT); let n; while ((n = w.nextNode())) { if (n.textContent.includes('C02 first alpha interleave item')) { const r = n.parentElement.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; } } return null; })()`,
);
console.log("  target:", JSON.stringify(target));
if (!target) {
  console.log("SMOKE-TARGET-NOT-FOUND");
  ws.close();
  process.exit(6);
}
await doubleClickAt(target.x, target.y);
await sleep(700);
const trig1 = await ev(`(() => { const b = document.getElementById('btn-ordered-list-style'); return { disabled: b.disabled, current: document.getElementById('ordered-list-style-current').textContent }; })()`);
console.log("  trigger-after-select:", JSON.stringify(trig1));
await clickDom("btn-ordered-list-style");
await sleep(600);
const menuOpen = await ev(`!document.getElementById('ordered-list-style-menu').classList.contains("hidden")`);
console.log("  menu-open:", menuOpen);
await shot("acc-03-submenu-open.png");
const typeBefore = await ev(
  `(() => { const ed = document.querySelector('.ProseMirror'); const w = document.createTreeWalker(ed, NodeFilter.SHOW_TEXT); let n; while ((n = w.nextNode())) { if (n.textContent.includes('C02 first alpha interleave item')) { const ol = n.parentElement.closest('ol'); return ol ? (ol.getAttribute('type') || '1') : null; } } return null; })()`,
);
console.log("  type-before:", typeBefore);
await clickDom("btn-ol-style-I");
await sleep(700);
const typeAfter = await ev(
  `(() => { const ed = document.querySelector('.ProseMirror'); const w = document.createTreeWalker(ed, NodeFilter.SHOW_TEXT); let n; while ((n = w.nextNode())) { if (n.textContent.includes('C02 first alpha interleave item')) { const ol = n.parentElement.closest('ol'); return ol ? (ol.getAttribute('type') || '1') : null; } } return null; })()`,
);
console.log("  type-after-set-I:", typeAfter);
await cdp("Input.dispatchKeyEvent", { type: "keyDown", modifiers: 2, key: "z", code: "KeyZ", windowsVirtualKeyCode: 90, nativeVirtualKeyCode: 90 });
await cdp("Input.dispatchKeyEvent", { type: "keyUp", modifiers: 2, key: "z", code: "KeyZ", windowsVirtualKeyCode: 90, nativeVirtualKeyCode: 90 });
await sleep(700);
const typeUndo = await ev(
  `(() => { const ed = document.querySelector('.ProseMirror'); const w = document.createTreeWalker(ed, NodeFilter.SHOW_TEXT); let n; while ((n = w.nextNode())) { if (n.textContent.includes('C02 first alpha interleave item')) { const ol = n.parentElement.closest('ol'); return ol ? (ol.getAttribute('type') || '1') : null; } } return null; })()`,
);
console.log("  type-after-undo:", typeUndo);

console.log("== B9. Ctrl+S 保存 ==");
await cdp("Input.dispatchKeyEvent", { type: "keyDown", modifiers: 2, key: "s", code: "KeyS", windowsVirtualKeyCode: 83, nativeVirtualKeyCode: 83 });
await cdp("Input.dispatchKeyEvent", { type: "keyUp", modifiers: 2, key: "s", code: "KeyS", windowsVirtualKeyCode: 83, nativeVirtualKeyCode: 83 });
await sleep(1500);
console.log("B-DONE");
ws.close();
process.exit(0);
