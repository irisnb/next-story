// fix-docx-fidelity-residuals 真机验收：视觉抽查截图（开头/符号段/中段/结尾）
import { writeFileSync } from "node:fs";

const BASE = "http://127.0.0.1:9222";
const OUT = "D:\\Next Story\\本地测试文档\\导入冒烟证据\\保真-20261004";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
async function ev(expression, timeoutMs = 30000) {
  const r = await cdp("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }, timeoutMs);
  if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 600));
  return r.result.value;
}
async function shot(name) {
  const r = await cdp("Page.captureScreenshot", { format: "png" });
  writeFileSync(`${OUT}\\${name}`, Buffer.from(r.data, "base64"));
  console.log(`  [截图] ${name}`);
}

const markers = [
  ["visual-01-top-BEGIN", "BEGIN marker paragraph A01"],
  ["visual-02-sym01", "SYM01 wingdings"],
  ["visual-03-middle", "MIDDLE marker paragraph M00"],
  ["visual-04-end", "END marker paragraph Z02"],
];
for (const [name, text] of markers) {
  const ok = await ev(
    `(() => { const ed = document.querySelector('.ProseMirror'); if (!ed) return false; const w = document.createTreeWalker(ed, NodeFilter.SHOW_TEXT); let n; while ((n = w.nextNode())) { if (n.textContent.includes(${JSON.stringify(text)})) { n.parentElement.closest('p, li, h1, h2, h3').scrollIntoView({ block: 'center' }); return true; } } return false; })()`,
  );
  await sleep(600);
  await shot(name);
  console.log(`  ${name}: scrolled=${ok}`);
}
console.log("C-DONE");
ws.close();
process.exit(0);
