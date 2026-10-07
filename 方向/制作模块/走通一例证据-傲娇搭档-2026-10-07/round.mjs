// round.mjs — 走通一例单轮执行器（CDP 驱动真实控件；方法沿项目既有真机验收惯例）
// 用法: node round.mjs <label> <prefixFile|-> <questionFile> <outPrefix>
// 流程: 新建讨论 → 校验关注文档 → 填直接提问 → 真实点击发送 → 等生成完成（含按需补读授权代点）→
//       提取对话文本 → 截图 → 落 JSON 证据 → 关闭窗口（讨论保留在列表）
import { writeFileSync, readFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const BASE = "http://127.0.0.1:9222";
const [, , label, prefixFile, questionFile, outPrefix] = process.argv;
if (!label || !prefixFile || !questionFile || !outPrefix) {
  console.error("用法: node round.mjs <label> <prefixFile|-> <questionFile> <outPrefix>");
  process.exit(2);
}

const prefix = prefixFile === "-" ? "" : readFileSync(prefixFile, "utf8").replace(/\r\n/g, "\n").trim();
const question = readFileSync(questionFile, "utf8").replace(/\r\n/g, "\n").trim();
const message = (prefix ? prefix + "\n\n" : "") + question;

mkdirSync(dirname(outPrefix), { recursive: true });

const startedAt = Date.now();
const evidence = { label, message, doc: null, readingRequested: false, readingReason: "", events: [], elapsedMs: null, convText: null, respText: null, dockCount: null };

function dumpEvidence() {
  try { writeFileSync(outPrefix + ".json", JSON.stringify(evidence, null, 2)); } catch { /* 尽力而为 */ }
}
function die(msg) {
  evidence.events.push({ t: Date.now() - startedAt, fail: msg });
  evidence.elapsedMs = Date.now() - startedAt;
  dumpEvidence();
  console.error("ROUND_FAIL[" + label + "] " + msg);
  process.exit(1);
}

const list = await fetch(`${BASE}/json/list`).then((r) => r.json());
const target = list.find((t) => t.type === "page" && t.title.includes("Next Story"));
if (!target) die("未找到 Next Story 页面（应用未启动或调试通道未开）");
const ws = new WebSocket(target.webSocketDebuggerUrl);
let seq = 0;
const pending = new Map();
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
ws.addEventListener("message", (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
  }
});
await new Promise((res, rej) => {
  ws.addEventListener("open", res);
  ws.addEventListener("error", () => rej(new Error("WebSocket 连接失败")));
});

async function evaluate(expression) {
  const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) die("页面求值异常: " + JSON.stringify(r.exceptionDetails).slice(0, 300));
  return r.result?.value;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 多窗口防撞：始终取最新的讨论窗口
const W = `[...document.querySelectorAll('#ai-dock-body .ai-window')].at(-1)`;

async function clickRect(elExpr, what) {
  const rect = await evaluate(`(() => { const el = ${elExpr}; if (!el) return null; el.scrollIntoView({ block: "nearest" }); const r = el.getBoundingClientRect(); if (r.width === 0 || r.height === 0) return null; return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
  if (!rect) die("点击目标不存在或不可见: " + what);
  const base = { x: rect.x, y: rect.y, button: "left", clickCount: 1 };
  await send("Input.dispatchMouseEvent", { ...base, type: "mousePressed" });
  await send("Input.dispatchMouseEvent", { ...base, type: "mouseReleased" });
}

const stateExpr = `(() => {
  const w = ${W};
  if (!w) return { noWindow: true };
  const vis = (el) => !!el && !el.classList.contains("hidden") && el.offsetParent !== null;
  return {
    windows: document.querySelectorAll("#ai-dock-body .ai-window").length,
    doc: (w.querySelector('[data-role="doc"]')?.textContent || "").trim(),
    dqVisible: vis(w.querySelector('[data-role="direct-question"]')),
    sendDisabled: w.querySelector('[data-role="direct-question-send"]')?.disabled ?? null,
    loading: vis(w.querySelector('[data-role="loading"]')),
    stop: vis(w.querySelector('[data-role="stop"]')),
    followUp: vis(w.querySelector('[data-role="follow-up-form"]')),
    error: vis(w.querySelector('[data-role="error-block"]')) || vis(w.querySelector('[data-role="follow-up-error"]')) || vis(w.querySelector('[data-role="direct-question-error"]')),
    errorText: (w.querySelector('[data-role="error-message"]')?.textContent || w.querySelector('[data-role="follow-up-error-message"]')?.textContent || w.querySelector('[data-role="direct-question-error-message"]')?.textContent || "").trim(),
    readingReq: vis(w.querySelector('[data-role="reading-request"]')),
    readingReason: (w.querySelector('[data-role="reading-request-reason"]')?.textContent || "").trim(),
    convText: (w.querySelector('[data-role="conversation"]')?.innerText || "").trim(),
    respText: (w.querySelector('[data-role="response"]')?.innerText || "").trim(),
    dockCount: (document.querySelector("#ai-dock-count")?.textContent || "").trim()
  };
})()`;

// 1. 新建讨论
const before = (await evaluate(`document.querySelectorAll("#ai-dock-body .ai-window").length`)) ?? 0;
await clickRect(`document.querySelector("#ai-new-conversation")`, "新建对话按钮");

// 2. 等新窗口与直接提问表单出现
let st = null;
for (let i = 0; i < 40; i++) {
  st = await evaluate(stateExpr);
  if (st && !st.noWindow && st.windows > before && st.dqVisible) break;
  await sleep(500);
}
if (!st || st.noWindow || !(st.windows > before)) die("新讨论窗口未出现");
evidence.doc = st.doc;
evidence.events.push({ t: Date.now() - startedAt, ev: "window created", doc: st.doc });

// 3. 填入问题：点输入框 → insertText（类 IME 提交，项目验收既有通道）
await clickRect(`${W}?.querySelector('[data-role="direct-question-input"]')`, "直接提问输入框");
await send("Input.insertText", { text: message });

// 4. 等发送按钮启用并点击
let sendReady = false;
for (let i = 0; i < 30; i++) {
  st = await evaluate(stateExpr);
  if (st && st.sendDisabled === false) { sendReady = true; break; }
  await sleep(400);
}
if (!sendReady) die("发送按钮未启用（输入可能未生效）");
await clickRect(`${W}?.querySelector('[data-role="direct-question-send"]')`, "发送按钮");
evidence.events.push({ t: Date.now() - startedAt, ev: "sent" });

// 5. 等生成完成：文本稳定 ≥4.5s 且（追问表单可见 或 加载/停止均隐藏）；期间代点按需补读「允许」
let allowClicked = false;
let lastText = "";
let stableSince = null;
const deadline = Date.now() + 300000;
let done = false;
while (Date.now() < deadline) {
  st = await evaluate(stateExpr);
  if (st.error) { evidence.errorText = st.errorText; die("轮内出错: " + st.errorText.slice(0, 200)); }
  if (st.readingReq && !allowClicked) {
    evidence.readingRequested = true;
    evidence.readingReason = st.readingReason;
    await clickRect(`${W}?.querySelector('[data-role="reading-allow"]')`, "按需补读·允许");
    allowClicked = true;
    stableSince = null;
    evidence.events.push({ t: Date.now() - startedAt, ev: "reading-allow clicked" });
  }
  const text = st.convText || st.respText;
  const completeSignals = st.followUp || (!st.loading && !st.stop);
  if (!st.readingReq && text.length > 0 && completeSignals) {
    if (text === lastText) {
      if (stableSince !== null && Date.now() - stableSince >= 4500) { done = true; break; }
    } else {
      lastText = text;
      stableSince = Date.now();
    }
  } else {
    stableSince = null;
  }
  await sleep(1500);
}
if (!done) die("等待生成完成超时（300s）");

evidence.convText = st.convText || null;
evidence.respText = st.respText || null;
evidence.dockCount = st.dockCount;
evidence.elapsedMs = Date.now() - startedAt;
evidence.events.push({ t: evidence.elapsedMs, ev: "round complete" });

// 6. 截图留证
const shot = await send("Page.captureScreenshot", { format: "png" });
writeFileSync(outPrefix + ".png", Buffer.from(shot.data, "base64"));
evidence.events.push({ ev: "screenshot saved", file: outPrefix + ".png" });

dumpEvidence();
console.log("ROUND_OK[" + label + "] doc=" + evidence.doc + " elapsed=" + evidence.elapsedMs + "ms reading=" + evidence.readingRequested + " convLen=" + (evidence.convText || "").length);

// 7. 关闭窗口（讨论保留在会话列表）
try {
  await clickRect(`${W}?.querySelector('[data-role="close"]')`, "关闭窗口按钮");
  for (let i = 0; i < 10; i++) {
    const n = await evaluate(`document.querySelectorAll("#ai-dock-body .ai-window").length`);
    if (n < st.windows) break;
    await sleep(500);
  }
} catch { /* 关闭失败不视为轮次失败，证据已落盘 */ }
ws.close();
process.exit(0);
