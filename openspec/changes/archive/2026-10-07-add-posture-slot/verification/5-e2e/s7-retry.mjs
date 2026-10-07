// s7-retry.mjs — S7 长对话保持·技术性失败重跑（预登记验收计划「技术性失败」条款）
// 首跑仪器缺陷：aiRoundDone 的完成判定 `followUp || (!loading && !stop)` 在追问轮
// 「正在思考」阶段被 followUp 表单可见性短路，4.5s 占位符稳定即误判完成，随后关窗
// 停掉了在途轮次（档案证据：turn2 assistant 为空、chain_rounds 仅 turn 0）。
// 本脚本修复：完成必须 !loading && !stop && followUp 且文本非「正在思考」占位符。
import { writeFileSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const BASE = "http://127.0.0.1:9222";
const OUT = ".";
const WORK_CONVERSATIONS = "C:\\Users\\Administrator\\Desktop\\test\\统一真机验收-20260926\\next-story-system\\conversations";
const CHAIN_NAME = "傲娇试金石链";
const Q1 = "雾岭这条线往下走，有什么可能的方向？";
const FU = "你给的第二个方向里，钟和灯怎么勾在一起？";
const MARKERS = ["哼", "笨蛋", "才不", "本小姐", "真是的", "还行吧", "拿你没办法", "服了"];

const list = await fetch(`${BASE}/json/list`).then((r) => r.json());
const target = list.find((t) => t.type === "page" && t.title.includes("Next Story"));
if (!target) { console.error("S7_FAIL 未找到页面目标"); process.exit(1); }
const ws = new WebSocket(target.webSocketDebuggerUrl);
let seq = 0; const pending = new Map(); const consoleErrors = [];
const send = (m, p = {}) => new Promise((res, rej) => { const id = ++seq; pending.set(id, { res, rej }); ws.send(JSON.stringify({ id, method: m, params: p })); });
ws.addEventListener("message", (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); } else if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") { consoleErrors.push(m.params.args.map((a) => a.value ?? a.description ?? a.type).join(" ").slice(0, 300)); } });
await new Promise((r) => ws.addEventListener("open", r));
await send("Runtime.enable");
const startedAt = Date.now();
const evidence = { at: new Date().toISOString(), retryReason: "仪器缺陷：首跑 aiRoundDone 在追问思考阶段误判完成并关窗停止在途轮（档案：空 assistant 轮＋chain_rounds 仅 turn0）；本次为技术性失败重跑，非模型行为失败取样替换", scenarios: {} };
function dump() { evidence.elapsedMs = Date.now() - startedAt; evidence.consoleErrors = [...new Set(consoleErrors)]; writeFileSync(join(OUT, "s7-retry.json"), JSON.stringify(evidence, null, 2)); }
function die(msg) { console.error("S7_FAIL " + msg); evidence.fail = msg; dump(); process.exit(1); }
function log(ev, extra) { console.log("S7_EV " + ev + (extra ? " " + JSON.stringify(extra).slice(0, 180) : "")); }
async function evaluate(expression) { const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) die("页面求值异常: " + JSON.stringify(r.exceptionDetails).slice(0, 300)); return r.result?.value; }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function clickRect(elExpr, what) { const rect = await evaluate(`(() => { const el = ${elExpr}; if (!el) return null; el.scrollIntoView({ block: "nearest" }); const r = el.getBoundingClientRect(); if (r.width === 0 || r.height === 0) return null; return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`); if (!rect) die("点击目标不存在或不可见: " + what); const base = { x: Math.round(rect.x), y: Math.round(rect.y), button: "left", clickCount: 1 }; await send("Input.dispatchMouseEvent", { ...base, type: "mouseMoved" }); await sleep(60); await send("Input.dispatchMouseEvent", { ...base, type: "mousePressed" }); await sleep(50); await send("Input.dispatchMouseEvent", { ...base, type: "mouseReleased" }); }
async function typeInto(elExpr, text, what) { await clickRect(elExpr, what); await sleep(80); await send("Input.insertText", { text }); }
async function screenshot(name) { const shot = await send("Page.captureScreenshot", { format: "png" }); writeFileSync(join(OUT, name + ".png"), Buffer.from(shot.data, "base64")); log("screenshot", { file: name + ".png" }); }
const VIS = `((el) => !!el && !el.classList.contains("hidden") && !el.hidden && el.getBoundingClientRect().width > 0)`;
async function installConfirmOverride() { await evaluate(`(() => { window.__confirmLog = []; globalThis.confirm = (msg) => { window.__confirmLog.push(String(msg)); return Promise.resolve(true); }; return true; })()`); }
async function waitFor(desc, probe, { timeoutMs = 30000, intervalMs = 500 } = {}) { const deadline = Date.now() + timeoutMs; let last; while (Date.now() < deadline) { last = await probe(); if (last) return last; await sleep(intervalMs); } die(`等待超时: ${desc}`); }
async function gotoModule(tab) { await clickRect(`document.getElementById("${tab}")`, `页签 ${tab}`); await sleep(600); }

const W = `[...document.querySelectorAll('#ai-dock-body .ai-window')].at(-1)`;
const aiExpr = `(() => {
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
    followUpSendDisabled: w.querySelector('[data-role="follow-up-send"]')?.disabled ?? null,
    error: vis(w.querySelector('[data-role="error-block"]')) || vis(w.querySelector('[data-role="follow-up-error"]')) || vis(w.querySelector('[data-role="direct-question-error"]')),
    errorText: (w.querySelector('[data-role="error-message"]')?.textContent || w.querySelector('[data-role="follow-up-error-message"]')?.textContent || w.querySelector('[data-role="direct-question-error-message"]')?.textContent || "").trim(),
    readingReq: vis(w.querySelector('[data-role="reading-request"]')),
    convText: (w.querySelector('[data-role="conversation"]')?.innerText || "").trim(),
    chainLines: [...w.querySelectorAll('[data-role="materials-body"] .ai-material-chain')].map((el) => el.textContent.trim()),
  };
})()`;
async function roundDoneFixed(label) {
  // 修复版完成判定：!loading && !stop && followUp 且文本非「正在思考」占位符
  let lastText = ""; let stableSince = null; let lastProgress = Date.now(); let allowClicked = false;
  const hard = Date.now() + 420000;
  for (;;) {
    const st = await evaluate(aiExpr);
    if (st.noWindow) die(label + ": 讨论窗口消失");
    if (st.error) die(label + ": 轮内出错 " + (st.errorText || "").slice(0, 200));
    if (Date.now() > hard) die(label + ": 硬超时");
    if (st.readingReq && !allowClicked) { log("reading-allow clicked"); await clickRect(`${W}?.querySelector('[data-role="reading-allow"]')`, "按需补读·允许"); allowClicked = true; lastProgress = Date.now(); await sleep(1000); continue; }
    const text = st.convText || "";
    const placeholder = text.replaceAll(" ", "").startsWith("正在思考");
    const complete = !st.loading && !st.stop && st.followUp && !placeholder && text.length > 0;
    if (complete) {
      if (text === lastText) { if (stableSince !== null && Date.now() - stableSince >= 4500) { evidence.readingRequested = allowClicked; return { st, text }; } }
      else { lastText = text; stableSince = Date.now(); }
    } else { stableSince = null; if (text.length > 0) lastProgress = Date.now(); }
    if (Date.now() - lastProgress > 240000) die(label + ": 停滞超时");
    await sleep(1500);
  }
}

// 1. 重新启用链路（S8 已停用）——幂等：已启用则跳过（首跑在崩溃前可能已启用）
await gotoModule("tab-making");
const statusNow = await evaluate(`(() => { const vis = ${VIS}; const el = document.getElementById("making-status-text"); return vis(document.getElementById("making-status-active")) && (el?.textContent ?? "").includes(${JSON.stringify(CHAIN_NAME)}) ? "already" : null; })()`);
if (statusNow === "already") {
  log("链路已处于启用状态（幂等跳过启用）");
} else {
const libOpen0 = await evaluate(`document.getElementById("module-making")?.classList.contains("making-library-open") ?? false`);
if (!libOpen0) { await clickRect(`document.getElementById("making-library-toggle")`, "链路库入口（展开）"); await sleep(600); }
await clickRect(`[...document.querySelectorAll("#making-chain-list .making-chain-row")].find((b) => b.querySelector(".making-chain-row-name")?.textContent.trim() === ${JSON.stringify(CHAIN_NAME)})`, "链路行");
await sleep(600);
const libOpen1 = await evaluate(`document.getElementById("module-making")?.classList.contains("making-library-open") ?? false`);
if (libOpen1) { await clickRect(`document.getElementById("making-library-toggle")`, "链路库入口（收起）"); await sleep(600); }
await clickRect(`document.getElementById("making-view-map-btn")`, "导图标签");
await sleep(600);
await evaluate(`(() => { const sel = document.querySelector("#making-version-select"); if (!sel) return false; const opt = [...sel.options].find(o => o.textContent.includes("第1版")); if (!opt) return false; sel.value = opt.value; sel.dispatchEvent(new Event("change", { bubbles: true })); return true; })()`);
await sleep(400);
await installConfirmOverride();
await waitFor("启用按钮可见", async () => evaluate(`(() => { const el = document.getElementById("making-enable-btn"); if (!el) return null; const v = !el.classList.contains("hidden") && !el.hidden && el.getBoundingClientRect().width > 0; return v && el.textContent.includes("启用") ? 1 : null; })()`), { timeoutMs: 15000 });
await clickRect(`document.getElementById("making-enable-btn")`, "启用按钮");
await waitFor("状态条已启用", async () => evaluate(`(() => { const el = document.getElementById("making-status-text"); return el && (el.textContent ?? "").includes(${JSON.stringify(CHAIN_NAME)}) ? 1 : null; })()`), { timeoutMs: 20000 });
log("链路已重新启用");
}

// 2. 新讨论 Q1 首轮（② e2e 惯例：已有空窗口〔提问表单可见且无轮次文本〕则复用，不新建）
await gotoModule("tab-writing");
let stW = await evaluate(aiExpr);
const reusable = stW && !stW.noWindow && stW.dqVisible && (stW.convText || "").length === 0 && !stW.error;
if (reusable) {
  log("复用既有空讨论窗口");
} else {
  const before = stW?.windows ?? 0;
  let headerBtn = await evaluate(`${VIS}(document.getElementById("ai-new-conversation"))`);
  if (!headerBtn) { const railExpand = await evaluate(`${VIS}(document.getElementById("ai-rail-expand"))`); if (railExpand) await clickRect(`document.getElementById("ai-rail-expand")`, "展开 AI 停靠区"); else await clickRect(`document.getElementById("btn-toggle-ai")`, "AI 面板开关"); await sleep(700); }
  await clickRect(`document.getElementById("ai-new-conversation")`, "新建对话按钮");
  for (let i = 0; i < 40; i++) { stW = await evaluate(aiExpr); if (stW && !stW.noWindow && stW.windows > before && stW.dqVisible) break; await sleep(500); }
  if (!stW || stW.noWindow || !(stW.windows > before)) die("新讨论窗口未出现");
}
await typeInto(`${W}?.querySelector('[data-role="direct-question-input"]')`, Q1, "直接提问输入框");
let ready = false;
for (let i = 0; i < 30; i++) { stW = await evaluate(aiExpr); if (stW.sendDisabled === false) { ready = true; break; } await sleep(400); }
if (!ready) die("发送按钮未启用");
await clickRect(`${W}?.querySelector('[data-role="direct-question-send"]')`, "发送按钮");
const r1 = await roundDoneFixed("首轮");
await screenshot("S7retry-Q1");
const m1 = MARKERS.filter((m) => r1.text.includes(m));
log("首轮完成", { markers: m1, len: r1.text.length });

// 3. 追问轮（本次的主角）
let stF = await evaluate(aiExpr);
if (!stF.followUp) die("追问表单不可见");
for (let attempt = 0; attempt < 3; attempt++) {
  await typeInto(`${W}?.querySelector('[data-role="follow-up-input"]')`, FU, "追问输入框");
  await sleep(400);
  const typed = await evaluate(`((${W}?.querySelector('[data-role="follow-up-input"]')?.value ?? "").length > 0)`);
  if (typed) break;
}
let fready = false;
for (let i = 0; i < 30; i++) { stF = await evaluate(aiExpr); if (stF.followUpSendDisabled === false) { fready = true; break; } await sleep(400); }
if (!fready) die("追问发送按钮未启用");
await clickRect(`${W}?.querySelector('[data-role="follow-up-send"]')`, "追问发送按钮");
const r2 = await roundDoneFixed("追问");
await screenshot("S7retry-追问");
writeFileSync(join(OUT, "resp-S7-retry.txt"), r2.text, "utf8");
const m2 = MARKERS.filter((m) => r2.text.includes(m));
log("追问完成", { markers: m2, len: r2.text.length });
try { await clickRect(`${W}?.querySelector('[data-role="close"]')`, "关闭窗口按钮"); } catch { }

// 4. 档案核对：3 轮次（a,u,a）＋ chain_rounds 含 turn0 与 turn1
await sleep(1500);
const newest = readdirSync(WORK_CONVERSATIONS).filter((f) => f.endsWith(".json") && !f.endsWith("meta.json")).map((f) => ({ f: join(WORK_CONVERSATIONS, f), m: statSync(join(WORK_CONVERSATIONS, f)).mtimeMs })).sort((a, b) => b.m - a.m)[0];
const arc = JSON.parse(readFileSync(newest.f, "utf8"));
const turns = (arc.turns ?? []).map((t) => ({ role: t.role, len: (t.text ?? "").length }));
const chainTurns = (arc.chain_rounds ?? []).map((c) => ({ t: c.turn_index, name: c.chain_name, v: c.version_index }));
const fuResp = (arc.turns ?? []).filter((t) => t.role === "assistant").pop();
const mArc = MARKERS.filter((m) => (fuResp?.text ?? "").includes(m));
evidence.scenarios.S7retry = { archive: newest.f.split("\\").pop(), turns, chainTurns, liveMarkers: m2, archiveMarkers: mArc, verdict: (m2.length >= 2 && mArc.length >= 2) ? "换皮保持" : (m2.length >= 2 || mArc.length >= 2 ? "部分" : "未保持") };
log("档案核对", evidence.scenarios.S7retry);

// 5. 停用还原（回到 S8 后的状态）
await gotoModule("tab-making");
await installConfirmOverride();
await waitFor("状态条当前启用", async () => evaluate(`(() => { const el = document.getElementById("making-status-text"); return el && (el.textContent ?? "").includes(${JSON.stringify(CHAIN_NAME)}) ? 1 : null; })()`), { timeoutMs: 15000 });
await clickRect(`document.getElementById("making-deactivate-btn")`, "停用按钮");
await waitFor("状态条未启用", async () => evaluate(`(() => { const el = document.getElementById("making-status-idle"); return el && !el.classList.contains("hidden") ? 1 : null; })()`), { timeoutMs: 20000 });
log("链路已停用（还原）");

dump();
console.log("S7_RETRY_OK verdict=" + evidence.scenarios.S7retry.verdict);
ws.close(); process.exit(0);
