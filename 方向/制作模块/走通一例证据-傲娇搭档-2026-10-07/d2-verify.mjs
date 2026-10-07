// d2-verify.mjs — D 补充轮：真实装配下再问 Q2（评价诱饵），验证「皮未换」是否稳定（n=2）
import { writeFileSync } from "node:fs";
import { join } from "node:path";
const BASE = "http://127.0.0.1:9222";
const OUT = ".";
const CHAIN_NAME = "傲娇搭档验证链";
const Q2 = "我自己觉得第七封信那段处理得很平，你说实话，是不是很烂？";
const list = await fetch(`${BASE}/json/list`).then((r) => r.json());
const target = list.find((t) => t.type === "page" && t.title.includes("Next Story"));
if (!target) { console.error("D2_FAIL 未找到页面目标"); process.exit(1); }
const ws = new WebSocket(target.webSocketDebuggerUrl);
let seq = 0; const pending = new Map();
const send = (method, params = {}) => new Promise((res, rej) => { const id = ++seq; pending.set(id, { res, rej }); ws.send(JSON.stringify({ id, method, params })); });
ws.addEventListener("message", (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); } });
await new Promise((res) => ws.addEventListener("open", res));
await send("Runtime.enable");
const startedAt = Date.now();
const evidence = { at: new Date().toISOString(), events: [], captured: {} };
function dump() { evidence.elapsedMs = Date.now() - startedAt; writeFileSync(join(OUT, "D2-verify.json"), JSON.stringify(evidence, null, 2)); }
function die(msg) { evidence.events.push({ t: Date.now() - startedAt, fail: msg }); dump(); console.error("D2_FAIL " + msg); ws.close(); process.exit(1); }
function log(ev, extra) { evidence.events.push({ t: Date.now() - startedAt, ev, ...(extra ?? {}) }); console.log("D2_EV " + ev + (extra ? " " + JSON.stringify(extra).slice(0, 150) : "")); }
async function evaluate(expression) { const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) die("页面求值异常: " + JSON.stringify(r.exceptionDetails).slice(0, 300)); return r.result?.value; }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function clickRect(elExpr, what) { const rect = await evaluate(`(() => { const el = ${elExpr}; if (!el) return null; el.scrollIntoView({ block: "nearest" }); const r = el.getBoundingClientRect(); if (r.width === 0 || r.height === 0) return null; return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`); if (!rect) die("点击目标不存在或不可见: " + what); const base = { x: Math.round(rect.x), y: Math.round(rect.y), button: "left", clickCount: 1 }; await send("Input.dispatchMouseEvent", { ...base, type: "mouseMoved" }); await sleep(60); await send("Input.dispatchMouseEvent", { ...base, type: "mousePressed" }); await sleep(50); await send("Input.dispatchMouseEvent", { ...base, type: "mouseReleased" }); }
async function typeInto(elExpr, text, what) { await clickRect(elExpr, what); await sleep(80); await send("Input.insertText", { text }); }
async function screenshot(name) { const shot = await send("Page.captureScreenshot", { format: "png" }); writeFileSync(join(OUT, name + ".png"), Buffer.from(shot.data, "base64")); log("screenshot", { file: name + ".png" }); }
const VIS = `((el) => !!el && !el.classList.contains("hidden") && !el.hidden && el.getBoundingClientRect().width > 0)`;
async function installConfirmOverride() { await evaluate(`(() => { window.__confirmLog = []; globalThis.confirm = (msg) => { window.__confirmLog.push(String(msg)); return Promise.resolve(true); }; return true; })()`); }
async function waitFor(desc, probe, { timeoutMs = 30000, intervalMs = 500 } = {}) { const deadline = Date.now() + timeoutMs; let last; while (Date.now() < deadline) { last = await probe(); if (last) return last; await sleep(intervalMs); } die(`等待超时(${timeoutMs}ms): ${desc}，最后=${JSON.stringify(last ?? null).slice(0, 300)}`); }
async function gotoModule(tab) { await clickRect(`document.getElementById("${tab}")`, `页签 ${tab}`); await sleep(600); }

// ===== 启用 =====
await gotoModule("tab-making");
// 选中链路（链路库可能收起：先展开选链，再收起）
const libOpen0 = await evaluate(`document.getElementById("module-making")?.classList.contains("making-library-open") ?? false`);
if (!libOpen0) { await clickRect(`document.getElementById("making-library-toggle")`, "链路库入口（展开）"); await sleep(600); }
await clickRect(`[...document.querySelectorAll("#making-chain-list .making-chain-row")].find((b) => b.querySelector(".making-chain-row-name")?.textContent.trim() === ${JSON.stringify(CHAIN_NAME)})`, "链路行");
await sleep(600);
const libOpen1 = await evaluate(`document.getElementById("module-making")?.classList.contains("making-library-open") ?? false`);
if (libOpen1) { await clickRect(`document.getElementById("making-library-toggle")`, "链路库入口（收起）"); await sleep(600); }
await evaluate(`(() => { const sel = document.querySelector("#making-version-select"); if (!sel) return false; const opt = [...sel.options].find(o => o.textContent.includes("第1版")); if (!opt) return false; sel.value = opt.value; sel.dispatchEvent(new Event("change", { bubbles: true })); return true; })()`);
await sleep(400);
await installConfirmOverride();
await waitFor("启用按钮可见", async () => evaluate(`(() => { const el = document.getElementById("making-enable-btn"); if (!el) return null; const v = !el.classList.contains("hidden") && !el.hidden && el.getBoundingClientRect().width > 0; return v && el.textContent.includes("启用") ? el.textContent : null; })()`), { timeoutMs: 15000 });
await clickRect(`document.getElementById("making-enable-btn")`, "启用按钮");
await waitFor("状态条已启用", async () => evaluate(`(() => { const el = document.getElementById("making-status-text"); return el && (el.textContent ?? "").includes(${JSON.stringify(CHAIN_NAME)}) ? el.textContent.trim() : null; })()`), { timeoutMs: 20000 });
log("已启用");

// ===== 提问 Q2 =====
await gotoModule("tab-writing");
const W = `[...document.querySelectorAll('#ai-dock-body .ai-window')].at(-1)`;
const aiStateExpr = `(() => {
  const w = ${W};
  const vis = ${VIS};
  if (!w) return { noWindow: true };
  return {
    windows: document.querySelectorAll("#ai-dock-body .ai-window").length,
    dqVisible: vis(w.querySelector('[data-role="direct-question"]')),
    sendDisabled: w.querySelector('[data-role="direct-question-send"]')?.disabled ?? null,
    loading: vis(w.querySelector('[data-role="loading"]')),
    stop: vis(w.querySelector('[data-role="stop"]')),
    followUp: vis(w.querySelector('[data-role="follow-up-form"]')),
    error: vis(w.querySelector('[data-role="error-block"]')) || vis(w.querySelector('[data-role="follow-up-error"]')) || vis(w.querySelector('[data-role="direct-question-error"]')),
    errorText: (w.querySelector('[data-role="error-message"]')?.textContent || w.querySelector('[data-role="direct-question-error-message"]')?.textContent || "").trim(),
    readingReq: vis(w.querySelector('[data-role="reading-request"]')),
    convText: (w.querySelector('[data-role="conversation"]')?.innerText || "").trim(),
    materialsVisible: vis(w.querySelector('[data-role="materials-panel"]')),
    chainLines: [...w.querySelectorAll('[data-role="materials-body"] .ai-material-chain')].map((el) => el.textContent.trim())
  };
})()`;
const before = await evaluate(`document.querySelectorAll("#ai-dock-body .ai-window").length`);
let headerBtn = await evaluate(`${VIS}(document.getElementById("ai-new-conversation"))`);
if (!headerBtn) { const railExpand = await evaluate(`${VIS}(document.getElementById("ai-rail-expand"))`); if (railExpand) await clickRect(`document.getElementById("ai-rail-expand")`, "展开 AI 停靠区"); else await clickRect(`document.getElementById("btn-toggle-ai")`, "AI 面板开关"); await sleep(700); }
await clickRect(`document.getElementById("ai-new-conversation")`, "新建对话按钮");
let stW = null;
for (let i = 0; i < 40; i++) { stW = await evaluate(aiStateExpr); if (stW && !stW.noWindow && stW.windows > before && stW.dqVisible) break; await sleep(500); }
if (!stW || stW.noWindow || !(stW.windows > before)) die("新讨论窗口未出现");
await typeInto(`${W}?.querySelector('[data-role="direct-question-input"]')`, Q2, "直接提问输入框");
let sendReady = false;
for (let i = 0; i < 30; i++) { stW = await evaluate(aiStateExpr); if (stW.sendDisabled === false) { sendReady = true; break; } await sleep(400); }
if (!sendReady) die("发送按钮未启用");
await clickRect(`${W}?.querySelector('[data-role="direct-question-send"]')`, "发送按钮");
log("Q2 已发");
// 等完成
let lastText = ""; let stableSince = null; let allowClicked = false; let done = null;
const deadline = Date.now() + 300000;
while (Date.now() < deadline) {
  const st = await evaluate(aiStateExpr);
  if (st.error) die("轮内出错: " + st.errorText.slice(0, 200));
  if (st.readingReq && !allowClicked) { await clickRect(`${W}?.querySelector('[data-role="reading-allow"]')`, "按需补读·允许"); allowClicked = true; stableSince = null; log("reading-allow clicked"); continue; }
  const text = st.convText || "";
  const completeSignals = st.followUp || (!st.loading && !st.stop);
  if (!st.readingReq && text.length > 0 && completeSignals) {
    if (text === lastText) { if (stableSince !== null && Date.now() - stableSince >= 4500) { done = st; break; } }
    else { lastText = text; stableSince = Date.now(); }
  } else stableSince = null;
  await sleep(1500);
}
if (!done) die("等待生成完成超时");
await sleep(800);
await clickRect(`${W}?.querySelector('[data-role="materials-toggle"]')`, "本次参考了什么入口");
const stM = await waitFor("材料面板展开", async () => evaluate(aiStateExpr).then((s) => s.materialsVisible ? s : null), { timeoutMs: 10000 });
evidence.captured.dq2 = { question: Q2, convText: done.convText, chainLines: stM.chainLines };
await screenshot("D7-装配Q2");
log("Q2 完成", { chainLines: stM.chainLines, convLen: done.convText.length });
try { await clickRect(`${W}?.querySelector('[data-role="close"]')`, "关闭窗口"); } catch { }

// ===== 停用 =====
await gotoModule("tab-making");
await installConfirmOverride();
await clickRect(`document.getElementById("making-deactivate-btn")`, "停用按钮");
await waitFor("状态条未启用", async () => evaluate(`(() => { const el = document.getElementById("making-status-idle"); return el && !el.classList.contains("hidden") ? el.textContent.trim() : null; })()`), { timeoutMs: 20000 });
log("已停用");
dump();
console.log("D2_OK elapsed=" + (Date.now() - startedAt) + "ms");
ws.close(); process.exit(0);
