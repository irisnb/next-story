// add-list-numbering-formats 真机复核（修复工具栏截断后）：
// 打开作品与文档 → 量测有序列表按钮/触发器（应 66/66、标签完整）→ 截图工具栏行
// → 子菜单打开截图 → 关闭 → 滚动到 C07/C08 截图（补视觉缺口）
import { writeFileSync } from "node:fs";

const BASE = "http://127.0.0.1:9222";
const OUT = "D:\\Next Story\\本地测试文档\\导入冒烟证据\\编号-20261005";
const NAME = "编号复验-20261005";
const DOC = "acceptance-complex";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const js = (s) => JSON.stringify(s);

const targets = await (await fetch(`${BASE}/json/list`)).json();
const page = targets.find(
  (t) =>
    t.type === "page" &&
    !t.url.includes("devtools") &&
    !t.url.includes("print") &&
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
async function shot(name, clip) {
  const r = await cdp("Page.captureScreenshot", clip ? { format: "png", clip } : { format: "png" });
  writeFileSync(`${OUT}\\${name}`, Buffer.from(r.data, "base64"));
  console.log(`  [截图] ${name}`, clip ? JSON.stringify(clip) : "");
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

console.log("== R1. 打开作品与文档 ==");
await cdp("Page.reload", {});
await sleep(4000);
const rec = await ev(
  `(() => { const leaf = [...document.querySelectorAll('*')].find((e) => e.children.length === 0 && e.textContent.trim().includes(${js(NAME)}) && e.offsetParent); if (!leaf) return null; const r = leaf.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`,
);
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
const tab = await ev(
  `(() => { const q = (sel) => [...document.querySelectorAll(sel)].filter((e) => e.offsetParent && e.textContent.trim() === '写作'); let els = q('button, [role=tab]'); if (!els.length) els = q('a, li, span, div'); if (!els.length) return null; const e = els[els.length - 1]; const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`,
);
if (tab) {
  await clickAt(tab.x, tab.y);
}
await sleep(1000);
await clickDom("current-doc-toggle");
await sleep(900);
const item = await ev(
  `(() => { const els = [...document.querySelectorAll('*')].filter((e) => e.offsetParent && e.children.length === 0 && e.textContent.trim() === ${js(DOC)}); if (!els.length) return null; const e = els[0]; e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`,
);
if (!item) {
  console.log("DROP-DOWN-ITEM-NOT-FOUND");
  process.exit(3);
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
if (!edOk) process.exit(4);

console.log("== R2. 量测（修复后应 70/66/66，标签完整） ==");
const info = await ev(`(() => {
  const pick = (sel) => { const e = document.querySelector(sel); if (!e) return null; const r = e.getBoundingClientRect(); return { sel, text: (e.textContent || '').trim(), x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height), clientW: e.clientWidth, scrollW: e.scrollWidth }; };
  return { orderedBtn: pick('#btn-ordered-list'), trigger: pick('#btn-ordered-list-style'), row: pick('.ol-style-row'), toolbar: pick('#format-toolbar') };
})()`);
console.log(JSON.stringify(info, null, 2));
writeFileSync(`${OUT}\\toolbar-measure-after.json`, JSON.stringify(info, null, 2), "utf8");
const ro = info.orderedBtn;
console.log("  label-full:", ro ? ro.clientW >= ro.scrollW && ro.text === "1. 列表" : false);
const clipRow = { x: 0, y: Math.max(0, (info.orderedBtn?.y ?? 430) - 46), width: 200, height: 150, scale: 2 };
await shot("acc-06-toolbar-fixed.png", clipRow);

console.log("== R3. 子菜单（修复后） ==");
const target = await ev(
  `(() => { const w = document.createTreeWalker(document.querySelector('.ProseMirror'), NodeFilter.SHOW_TEXT); let n; while ((n = w.nextNode())) { if (n.textContent.includes('C02 first alpha interleave item')) { const r = n.parentElement.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; } } return null; })()`,
);
if (target) {
  await doubleClickAt(target.x, target.y);
  await sleep(500);
  const st = await ev(`(() => { const b = document.getElementById('btn-ordered-list-style'); return { disabled: b.disabled, current: document.getElementById('ordered-list-style-current').textContent }; })()`);
  console.log("  trigger:", JSON.stringify(st));
  await clickDom("btn-ordered-list-style");
  await sleep(600);
  const open = await ev(`!document.getElementById('ordered-list-style-menu').classList.contains("hidden")`);
  console.log("  menu-open:", open);
  await shot("acc-07-submenu-fixed.png", { x: 0, y: Math.max(0, (info.orderedBtn?.y ?? 430) - 8), width: 420, height: 260, scale: 2 });
  await cdp("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 });
  await cdp("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 });
  await sleep(400);
}

console.log("== R4. C07/C08 区域（补视觉缺口） ==");
const scrolled = await ev(
  `(() => { const ed = document.querySelector('.ProseMirror'); const w = document.createTreeWalker(ed, NodeFilter.SHOW_TEXT); let n; while ((n = w.nextNode())) { if (n.textContent.includes('C08 alpha resumes after interruption')) { n.parentElement.closest('p').scrollIntoView({ block: 'center' }); return true; } } return false; })()`,
);
await sleep(600);
const rect = await ev(`(() => { const ed = document.querySelector('.ProseMirror'); const w = document.createTreeWalker(ed, NodeFilter.SHOW_TEXT); let n; while ((n = w.nextNode())) { if (n.textContent.includes('C05 third decimal item')) { const r = n.parentElement.closest('p').getBoundingClientRect(); return { x: Math.round(r.left), y: Math.round(r.top) }; } } return null; })()`);
console.log("  scrolled:", scrolled, " c05-rect:", JSON.stringify(rect));
const clipList = { x: 80, y: Math.max(0, (rect?.y ?? 300) - 20), width: 920, height: 320, scale: 1.5 };
await shot("acc-08-c07c08.png", clipList);
console.log("R-DONE");
ws.close();
process.exit(0);
