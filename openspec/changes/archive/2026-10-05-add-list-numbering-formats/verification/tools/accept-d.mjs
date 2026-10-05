// add-list-numbering-formats 真机验收 Phase D：三格式导出（注入保存对话框到临时目录，绕过原生框）
// 验收对象＝导出产出内容（Word 前缀按样式 / Markdown 降级＋告知 / PDF 生成），非原生对话框 UI。
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const BASE = "http://127.0.0.1:9222";
const OUT = "D:\\Next Story\\本地测试文档\\导入冒烟证据\\编号-20261005";
const EXPDIR = "C:\\Users\\Administrator\\AppData\\Local\\Temp\\opencode\\编号导出验收";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const js = (s) => JSON.stringify(s);
mkdirSync(EXPDIR, { recursive: true });

const ROOT = readFileSync(`${OUT}\\project-root.txt`, "utf8").trim();
const tree = JSON.parse(readFileSync(`${OUT}\\tree-after.json`, "utf8"));
const docEntry = Object.entries(tree.nodes || {}).find(([, n]) => n.name === "acceptance-complex");
if (!docEntry) {
  console.log("DOC-NODE-NOT-FOUND");
  process.exit(1);
}
const docId = docEntry[0];
console.log("doc-id:", docId);

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
async function ev(expression, timeoutMs = 180000) {
  const r = await cdp("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }, timeoutMs);
  if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 600));
  return r.result.value;
}

const formats = [
  ["word", `${EXPDIR}\\acc-acceptance.docx`],
  ["markdown", `${EXPDIR}\\acc-acceptance.md`],
  ["pdf", `${EXPDIR}\\acc-acceptance.pdf`],
];
const results = {};
for (const [fmt, targetPath] of formats) {
  console.log(`== D: 导出 ${fmt} → ${targetPath} ==`);
  const r = await ev(
    `(async () => { const api = await import('/src/project-api.ts'); const scope = ${js({ type: "document", id: docId })}; try { return await api.exportProject(${js(fmt)}, ${js(ROOT)}, scope, 'acceptance-complex', async () => ${js(targetPath)}); } catch (e) { return { ok: false, path: null, message: String(e) }; } })()`,
    180000,
  );
  console.log("  ", JSON.stringify(r));
  results[fmt] = r;
  await sleep(800);
}
writeFileSync(`${OUT}\\export-results.json`, JSON.stringify(results, null, 2), "utf8");
console.log("D-DONE");
ws.close();
process.exit(0);
