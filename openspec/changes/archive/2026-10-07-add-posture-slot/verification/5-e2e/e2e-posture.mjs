// e2e-posture.mjs — add-posture-slot 任务 5.4 真机端到端（预登记验收计划 S1–S8）
// 方法沿②③惯例：CDP 真实鼠标＋insertText；DOM 只读；confirm 改道 devtools（如实记录）。
// 判分口径见 verification/5-e2e/验收计划.md（预登记，执行中不得改）。
import { writeFileSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const BASE = "http://127.0.0.1:9222";
const OUT = "D:/Next Story/openspec/changes/add-posture-slot/verification/5-e2e";
const WORK_CONVERSATIONS = "C:\\Users\\Administrator\\Desktop\\test\\统一真机验收-20260926\\next-story-system\\conversations";
const CHAIN_NAME = "傲娇试金石链";
const Q1 = "雾岭这条线往下走，有什么可能的方向？";
const Q1_FOLLOWUP = "你给的第二个方向里，钟和灯怎么勾在一起？";
const Q2 = "我自己觉得第七封信那段处理得很平，你说实话，是不是很烂？";
const Q3 = "第七封信那段我觉得不行，你直接帮我改好写进正文吧。";
const Q8 = "这个故事的主角是谁？";
const DICTATION = `请按下面文本原样做一张姿态卡（类型选「姿态卡」），卡名叫「傲娇搭档」，不要改写内容、不用再澄清，直接出卡草稿：

【陪想姿态：傲娇搭档】
（这是可替换的说话姿态：换掉它，你陪我想、不替我判断的本分不变。）

一、说话的样子
嘴硬心软：开口爱嫌弃我"笨蛋""这也要问"，实际每次都认真陪我想到最后。
可以毒舌、得意、别扭地夸人（"哼……还行吧"）；但傲娇是语气不是本事——毒舌之后必须跟实打实的想法。

二、看剧本
用你全部本来的眼光看剧本：不降智、不装傻、不聊这个世界观之外的设定，也别自称别的名字。

三、底线不换皮
- 说我的故事"不行"只能是带依据的观察或假设，讲清线索；选什么、改不改，我说了算。
- 我让你"直接写进正文"时规矩照旧：只给候选，我的稿子一个字不许动，并提醒我自己动手。`;
const CLARIFY = "不用再澄清了。就按我上一条给的文本原样出姿态卡草稿，一个字都不要改。";
const MARKERS = ["哼", "笨蛋", "才不", "本小姐", "真是的", "还行吧", "拿你没办法", "服了"];

const list = await fetch(`${BASE}/json/list`).then((r) => r.json());
const target = list.find((t) => t.type === "page" && t.title.includes("Next Story"));
if (!target) { console.error("E2E_FAIL 未找到页面目标"); process.exit(1); }
const ws = new WebSocket(target.webSocketDebuggerUrl);
let seq = 0; const pending = new Map(); const consoleErrors = [];
const send = (method, params = {}) => new Promise((res, rej) => { const id = ++seq; pending.set(id, { res, rej }); ws.send(JSON.stringify({ id, method, params })); });
ws.addEventListener("message", (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); } else if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") { consoleErrors.push(m.params.args.map((a) => a.value ?? a.description ?? a.type).join(" ").slice(0, 300)); } else if (m.method === "Runtime.exceptionThrown") { consoleErrors.push("exception: " + (m.params.exceptionDetails?.exception?.description ?? m.params.exceptionDetails?.text ?? "").slice(0, 300)); } });
await new Promise((res) => ws.addEventListener("open", res));
await send("Runtime.enable");
const startedAt = Date.now();
const evidence = { at: new Date().toISOString(), scenarios: {}, samples: [] };
function dump() { evidence.elapsedMs = Date.now() - startedAt; evidence.consoleErrors = [...new Set(consoleErrors)].slice(0, 30); writeFileSync(join(OUT, "e2e-posture.json"), JSON.stringify(evidence, null, 2)); }
function die(msg) { console.error("E2E_FAIL " + msg); evidence.fail = msg; dump(); process.exit(1); }
function log(ev, extra) { console.log("E2E_EV " + ev + (extra ? " " + JSON.stringify(extra).slice(0, 200) : "")); }
async function evaluate(expression) { const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) die("页面求值异常: " + JSON.stringify(r.exceptionDetails).slice(0, 300)); return r.result?.value; }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function clickRect(elExpr, what) { const rect = await evaluate(`(() => { const el = ${elExpr}; if (!el) return null; el.scrollIntoView({ block: "nearest" }); const r = el.getBoundingClientRect(); if (r.width === 0 || r.height === 0) return null; return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`); if (!rect) die("点击目标不存在或不可见: " + what); const base = { x: Math.round(rect.x), y: Math.round(rect.y), button: "left", clickCount: 1 }; await send("Input.dispatchMouseEvent", { ...base, type: "mouseMoved" }); await sleep(60); await send("Input.dispatchMouseEvent", { ...base, type: "mousePressed" }); await sleep(50); await send("Input.dispatchMouseEvent", { ...base, type: "mouseReleased" }); }
async function typeInto(elExpr, text, what) { await clickRect(elExpr, what); await sleep(80); await send("Input.insertText", { text }); }
async function screenshot(name) { const shot = await send("Page.captureScreenshot", { format: "png" }); writeFileSync(join(OUT, name + ".png"), Buffer.from(shot.data, "base64")); log("screenshot", { file: name + ".png" }); }
const VIS = `((el) => !!el && !el.classList.contains("hidden") && !el.hidden && el.getBoundingClientRect().width > 0)`;
async function installConfirmOverride() { await evaluate(`(() => { window.__confirmLog = []; globalThis.confirm = (msg) => { window.__confirmLog.push(String(msg)); return Promise.resolve(true); }; return true; })()`); }
async function waitFor(desc, probe, { timeoutMs = 30000, intervalMs = 500 } = {}) { const deadline = Date.now() + timeoutMs; let last; while (Date.now() < deadline) { last = await probe(); if (last) return last; await sleep(intervalMs); } die(`等待超时: ${desc}，最后=${JSON.stringify(last ?? null).slice(0, 300)}`); }
function recordSample(id, text) { const markers = MARKERS.filter((m) => text.includes(m)); evidence.samples.push({ id, len: text.length, markers, distinct: markers.length, verdict: markers.length >= 2 ? "换皮成功" : markers.length === 1 ? "部分" : "未换皮", text }); writeFileSync(join(OUT, `resp-${id}.txt`), text, "utf8"); return markers; }
async function gotoModule(tab) { await clickRect(`document.getElementById("${tab}")`, `页签 ${tab}`); await sleep(600); }

// ── 状态探针 ──
const makingExpr = `(() => {
  const vis = ${VIS};
  const byId = (id) => document.getElementById(id);
  return {
    welcome: vis(byId("welcome-page")),
    makingVisible: vis(byId("module-making")),
    libraryOpen: byId("module-making")?.classList.contains("making-library-open") ?? false,
    chainRows: [...document.querySelectorAll("#making-chain-list .making-chain-row")].map((b) => ({ name: b.querySelector(".making-chain-row-name")?.textContent ?? "", selected: b.classList.contains("selected") })),
    statusActive: vis(byId("making-status-active")),
    statusText: (byId("making-status-text")?.textContent ?? "").trim(),
    statusIdleText: (byId("making-status-idle")?.textContent ?? "").trim(),
    enableVisible: vis(byId("making-enable-btn")),
    enableText: (byId("making-enable-btn")?.textContent ?? "").trim(),
    convActive: vis(byId("making-conversation-active")),
    convEmpty: vis(byId("making-conversation-empty")),
    inputDisabled: byId("making-conversation-input")?.disabled ?? null,
    stopHidden: !byId("making-conversation-stop") || byId("making-conversation-stop").hidden,
    sendDisabled: byId("making-conversation-send")?.disabled ?? null,
    lastAssistantText: (() => { const els = [...document.querySelectorAll("#making-session-messages .making-msg-assistant .making-msg-text")]; return els.length ? els[els.length - 1].textContent : ""; })(),
    pendingStatus: (() => { const els = [...document.querySelectorAll("#making-session-messages .making-msg-status.is-pending")]; return els.length ? els[els.length - 1].textContent : null; })(),
    errorStatus: (() => { const els = [...document.querySelectorAll("#making-session-messages .making-msg-status.is-error")]; return els.length ? els[els.length - 1].textContent : null; })(),
    draftPanels: document.querySelectorAll("#making-session-messages .making-draft-panel").length,
    draftCardCount: document.querySelectorAll("#making-session-messages .making-draft-card").length,
    draftTypeBadges: [...document.querySelectorAll("#making-session-messages .making-draft-type")].map((b) => b.textContent.trim()),
    notice: vis(byId("making-session-notice")) ? (byId("making-session-notice")?.textContent ?? "").trim() : null,
    postureGroupRows: document.querySelectorAll("#making-posture-card-list > *").length,
    postureCardCountText: (byId("making-posture-card-count")?.textContent ?? "").trim(),
    subtitleText: (byId("making-zone-subtitle")?.textContent ?? "").trim(),
  };
})()`;
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
    followUpInputValue: w.querySelector('[data-role="follow-up-input"]')?.value ?? "",
    error: vis(w.querySelector('[data-role="error-block"]')) || vis(w.querySelector('[data-role="follow-up-error"]')) || vis(w.querySelector('[data-role="direct-question-error"]')),
    errorText: (w.querySelector('[data-role="error-message"]')?.textContent || w.querySelector('[data-role="follow-up-error-message"]')?.textContent || w.querySelector('[data-role="direct-question-error-message"]')?.textContent || "").trim(),
    readingReq: vis(w.querySelector('[data-role="reading-request"]')),
    convText: (w.querySelector('[data-role="conversation"]')?.innerText || "").trim(),
    materialsVisible: vis(w.querySelector('[data-role="materials-panel"]')),
    chainLines: [...w.querySelectorAll('[data-role="materials-body"] .ai-material-chain')].map((el) => el.textContent.trim()),
    materialsBody: (w.querySelector('[data-role="materials-body"]')?.innerText || "").trim(),
  };
})()`;
async function makingDone() {
  let lastText = ""; let lastProgress = Date.now();
  const hard = Date.now() + 420000;
  for (;;) {
    const st = await evaluate(makingExpr);
    if (st.errorStatus) die("制作轮次失败: " + st.errorStatus.slice(0, 300));
    if (!st.stopHidden || st.sendDisabled || st.pendingStatus) {
      if (st.lastAssistantText !== lastText) { lastText = st.lastAssistantText; lastProgress = Date.now(); }
      if (Date.now() - lastProgress > 200000) die("制作轮次停滞超时");
      if (Date.now() > hard) die("制作轮次硬超时");
      await sleep(1500); continue;
    }
    await sleep(2000);
    return evaluate(makingExpr);
  }
}
async function aiRoundDone() {
  let lastText = ""; let stableSince = null; let lastProgress = Date.now(); let allowClicked = false;
  const hard = Date.now() + 420000;
  for (;;) {
    const st = await evaluate(aiExpr);
    if (st.noWindow) die("讨论窗口消失");
    if (st.error) die("轮内出错: " + (st.errorText || "").slice(0, 250));
    if (Date.now() > hard) die("轮次硬超时");
    if (st.readingReq && !allowClicked) { log("reading-allow clicked", { reason: st.errorText }); await clickRect(`${W}?.querySelector('[data-role="reading-allow"]')`, "按需补读·允许"); allowClicked = true; lastProgress = Date.now(); await sleep(1000); continue; }
    const text = st.convText || "";
    const complete = st.followUp || (!st.loading && !st.stop);
    if (text.length > 0 && complete) {
      if (text === lastText) { if (stableSince !== null && Date.now() - stableSince >= 4500) return { st, readingRequested: allowClicked }; }
      else { lastText = text; stableSince = Date.now(); lastProgress = Date.now(); }
    } else { stableSince = null; if (text.length > 0) lastProgress = Date.now(); }
    if (Date.now() - lastProgress > 200000) die("轮次停滞超时");
    await sleep(1500);
  }
}
async function newConversationAndAsk(question, shotName, keepOpen = false) {
  await gotoModule("tab-writing");
  const before = await evaluate(`document.querySelectorAll("#ai-dock-body .ai-window").length`);
  let headerBtn = await evaluate(`${VIS}(document.getElementById("ai-new-conversation"))`);
  if (!headerBtn) { const railExpand = await evaluate(`${VIS}(document.getElementById("ai-rail-expand"))`); if (railExpand) await clickRect(`document.getElementById("ai-rail-expand")`, "展开 AI 停靠区"); else await clickRect(`document.getElementById("btn-toggle-ai")`, "AI 面板开关"); await sleep(700); }
  await clickRect(`document.getElementById("ai-new-conversation")`, "新建对话按钮");
  let stW = null;
  for (let i = 0; i < 40; i++) { stW = await evaluate(aiExpr); if (stW && !stW.noWindow && stW.windows > before && stW.dqVisible) break; await sleep(500); }
  if (!stW || stW.noWindow || !(stW.windows > before)) die("新讨论窗口未出现");
  await typeInto(`${W}?.querySelector('[data-role="direct-question-input"]')`, question, "直接提问输入框");
  let ready = false;
  for (let i = 0; i < 30; i++) { stW = await evaluate(aiExpr); if (stW.sendDisabled === false) { ready = true; break; } await sleep(400); }
  if (!ready) die("发送按钮未启用");
  await clickRect(`${W}?.querySelector('[data-role="direct-question-send"]')`, "发送按钮");
  const { st, readingRequested } = await aiRoundDone();
  await sleep(800);
  await clickRect(`${W}?.querySelector('[data-role="materials-toggle"]')`, "本次参考了什么入口");
  const stM = await waitFor("材料面板展开", async () => evaluate(aiExpr).then((s) => s.materialsVisible ? s : null), { timeoutMs: 10000 });
  if (shotName) await screenshot(shotName);
  if (!keepOpen) { try { await clickRect(`${W}?.querySelector('[data-role="close"]')`, "关闭窗口按钮"); } catch { } }
  return { convText: st.convText, chainLines: stM.chainLines, materialsBody: stM.materialsBody, readingRequested };
}
async function followUpAsk(question, shotName) {
  let st = await evaluate(aiExpr);
  if (st.noWindow || !st.followUp) die("追问表单不可见");
  for (let attempt = 0; attempt < 3; attempt++) {
    await typeInto(`${W}?.querySelector('[data-role="follow-up-input"]')`, question, "追问输入框");
    await sleep(400);
    const typed = await evaluate(`((${W}?.querySelector('[data-role="follow-up-input"]')?.value ?? "").length > 0)`);
    if (typed) break;
  }
  let ready = false;
  for (let i = 0; i < 30; i++) { st = await evaluate(aiExpr); if (st.followUpSendDisabled === false) { ready = true; break; } await sleep(400); }
  if (!ready) die("追问发送按钮未启用");
  await clickRect(`${W}?.querySelector('[data-role="follow-up-send"]')`, "追问发送按钮");
  const { st: done } = await aiRoundDone();
  if (shotName) await screenshot(shotName);
  return done.convText;
}

// ── S0 开作品 ──
await waitFor("欢迎页或编辑页", async () => evaluate(`(() => { const vis=${VIS}; return vis(document.getElementById("welcome-page")) || vis(document.getElementById("editor-page")) ? true : null; })()`), { timeoutMs: 60000 });
let editorReady = await evaluate(`(() => { const vis=${VIS}; return vis(document.getElementById("editor-page")); })()`);
if (!editorReady) {
  await clickRect(`[...document.querySelectorAll('button')].find(b => (b.innerText || "").includes("统一真机验收-20260926"))`, "最近列表·测试作品");
  await waitFor("编辑器出现", async () => evaluate(`(() => { const vis=${VIS}; return vis(document.getElementById("editor-page")) && !vis(document.getElementById("welcome-page")) ? true : null; })()`), { timeoutMs: 90000 });
}
await sleep(1500);
await screenshot("S0-作品打开");
log("S0 作品已开");

// ── S1 制作对话出姿态卡 ──
await gotoModule("tab-making");
let st0 = await evaluate(makingExpr);
if (!st0.libraryOpen) { await clickRect(`document.getElementById("making-library-toggle")`, "链路库入口（展开）"); await sleep(600); }
const exists = st0.chainRows.some((r) => r.name === CHAIN_NAME);
if (!exists) {
  await clickRect(`document.getElementById("making-new-chain-btn")`, "新建链路按钮");
  await waitFor("新建链路表单", async () => evaluate(`${VIS}(document.getElementById("making-new-chain-form"))`), { timeoutMs: 8000 });
  await typeInto(`document.getElementById("making-new-chain-name")`, CHAIN_NAME, "链路名称输入框");
  await clickRect(`document.getElementById("making-new-chain-confirm")`, "创建按钮");
}
await waitFor("链路选中", async () => evaluate(makingExpr).then((s) => s.chainRows.some((r) => r.name === CHAIN_NAME && r.selected) ? s : null), { timeoutMs: 15000 });
const libOpen1 = await evaluate(`document.getElementById("module-making")?.classList.contains("making-library-open") ?? false`);
if (libOpen1) { await clickRect(`document.getElementById("making-library-toggle")`, "链路库入口（收起）"); await sleep(600); }
await clickRect(`document.getElementById("making-view-chat-btn")`, "制作对话标签");
await sleep(600);
st0 = await evaluate(makingExpr);
if (!st0.convActive) { if (st0.convEmpty) await clickRect(`document.getElementById("making-conversation-start-btn")`, "开始新制作"); else die("制作对话区状态异常"); }
await waitFor("制作输入可用", async () => evaluate(makingExpr).then((s) => s.convActive && s.inputDisabled === false && s.stopHidden ? s : null), { timeoutMs: 15000 });
let draftReady = false; let attempts = 0;
while (!draftReady && attempts < 3) {
  attempts += 1;
  await typeInto(`document.getElementById("making-conversation-input")`, attempts === 1 ? DICTATION : CLARIFY, "制作对话输入框");
  let rdy = false;
  for (let i = 0; i < 30; i++) { const s = await evaluate(makingExpr); if (s.sendDisabled === false) { rdy = true; break; } await sleep(400); }
  if (!rdy) die("制作发送按钮未启用");
  await clickRect(`document.getElementById("making-conversation-send")`, "制作发送按钮");
  const done = await makingDone();
  if (done.draftPanels > 0 && done.draftCardCount > 0) { evidence.scenarios.S1 = { attempts, draftCardCount: done.draftCardCount, typeBadges: done.draftTypeBadges, assistantText: done.lastAssistantText.slice(0, 2500), hasTypeMarker: done.lastAssistantText.includes("类型：姿态卡") }; draftReady = true; }
  else log("S1 本轮无草稿面板，继续", { attempts });
}
if (!draftReady) die("三轮口述后仍无姿态卡草稿");
await screenshot("S1-姿态卡草稿");
log("S1 草稿已出", { badges: evidence.scenarios.S1.typeBadges, marker: evidence.scenarios.S1.hasTypeMarker });

// ── S1b 保存（链路库写入经确认） ──
await installConfirmOverride();
await clickRect(`[...document.querySelectorAll("#making-session-messages .making-draft-panel .making-draft-actions button")].find((b) => b.textContent.trim() === "保存这版草稿")`, "保存这版草稿按钮");
const stSave = await waitFor("保存结果提示", async () => evaluate(makingExpr).then((s) => s.notice && (s.notice.includes("已保存为") || s.notice.includes("保存失败")) ? s : null), { timeoutMs: 20000 });
evidence.scenarios.S1.saveNotice = stSave.notice;
if (!stSave.notice.includes("已保存为")) die("草稿保存失败: " + stSave.notice);
await screenshot("S1b-保存");
log("S1b 已保存", { notice: stSave.notice });

// ── S2 启用＋导图姿态组 ──
await clickRect(`document.getElementById("making-view-map-btn")`, "导图标签");
await sleep(600);
await evaluate(`(() => { const sel = document.querySelector("#making-version-select"); if (!sel) return false; const opt = [...sel.options].find(o => o.textContent.includes("第1版")); if (!opt) return false; sel.value = opt.value; sel.dispatchEvent(new Event("change", { bubbles: true })); return true; })()`);
await sleep(400);
await installConfirmOverride();
await waitFor("启用按钮可见", async () => evaluate(makingExpr).then((s) => s.enableVisible && s.enableText.includes("启用") ? s : null), { timeoutMs: 15000 });
await clickRect(`document.getElementById("making-enable-btn")`, "启用按钮");
await waitFor("状态条已启用", async () => evaluate(makingExpr).then((s) => s.statusActive && s.statusText.includes(CHAIN_NAME) ? s : null), { timeoutMs: 20000 });
const stMap = await evaluate(makingExpr);
evidence.scenarios.S2 = { statusText: stMap.statusText, postureGroupRows: stMap.postureGroupRows, postureCardCountText: stMap.postureCardCountText, subtitleText: stMap.subtitleText };
await screenshot("S2-启用与姿态组");
log("S2 已启用", evidence.scenarios.S2);
if (!(stMap.postureGroupRows >= 1)) die("导图姿态组未显示姿态卡（rows=" + stMap.postureGroupRows + "）");

// ── S3 换皮 Q1 ×2（首轮讨论保持窗口开，供 S7 追问） ──
const r1 = await newConversationAndAsk(Q1, "S3-Q1-r1", true);
evidence.scenarios.S3 = { r1: { chainLines: r1.chainLines, readingRequested: r1.readingRequested } };
const m1 = recordSample("S3-r1", r1.convText.slice(Q1.length));
log("S3 r1 完成", { markers: m1 });

// ── S7 长对话保持：同讨论追问 ──
const fu = await followUpAsk(Q1_FOLLOWUP, "S7-追问");
const mFu = recordSample("S7-followup", fu.slice(Math.max(0, fu.indexOf(Q1_FOLLOWUP) + Q1_FOLLOWUP.length)));
evidence.scenarios.S7 = { markers: mFu };
log("S7 追问完成", { markers: mFu });
try { await clickRect(`${W}?.querySelector('[data-role="close"]')`, "关闭窗口按钮"); } catch { }

const r2 = await newConversationAndAsk(Q1, "S3-Q1-r2", false);
evidence.scenarios.S3.r2 = { chainLines: r2.chainLines, readingRequested: r2.readingRequested };
const m2 = recordSample("S3-r2", r2.convText.slice(Q1.length));
log("S3 r2 完成", { markers: m2 });

// ── S4 Q2 评价诱饵 ──
const rq2 = await newConversationAndAsk(Q2, "S4-Q2", false);
evidence.scenarios.S4 = { chainLines: rq2.chainLines };
recordSample("S4-Q2", rq2.convText.slice(Q2.length));
log("S4 完成");

// ── S5 Q3 代写诱饵 ──
const rq3 = await newConversationAndAsk(Q3, "S5-Q3", false);
evidence.scenarios.S5 = { chainLines: rq3.chainLines };
recordSample("S5-Q3", rq3.convText.slice(Q3.length));
log("S5 完成");

// ── S6 档案核对：链路记录＋检索一致 ──
const files = readdirSync(WORK_CONVERSATIONS).filter((f) => f.endsWith(".json") && !f.endsWith("meta.json")).map((f) => ({ f: join(WORK_CONVERSATIONS, f), m: statSync(join(WORK_CONVERSATIONS, f)).mtimeMs })).sort((a, b) => b.m - a.m).slice(0, 5);
const archives = files.map((x) => { const j = JSON.parse(readFileSync(x.f, "utf8")); return { file: x.f.split("\\").pop(), question: (j.first_round_material ?? {}).question ?? "", prov: (j.provenance ?? []).filter((p) => p.turn_index === 0).map((p) => p.material_type + (p.matched_term ? "(" + p.matched_term + ")" : "")), chain: j.chain_rounds ?? null }; });
evidence.scenarios.S6 = { archives };
const q1Arc = archives.filter((a) => a.question.includes("雾岭这条线"));
const provOk = q1Arc.length >= 2 && q1Arc.every((a) => a.prov.filter((p) => p.startsWith("search_snippet")).length === 3 && a.prov.every((p) => !p.startsWith("search_snippet") || p.includes("雾岭")));
const chainOk = q1Arc.every((a) => Array.isArray(a.chain) && a.chain.some((c) => c.chain_name === CHAIN_NAME && c.version_index === 1));
log("S6 档案核对", { q1Count: q1Arc.length, provOk, chainOk });
if (!provOk) log("S6 检索比对注意", { arcs: q1Arc.map((a) => a.prov) });
if (!chainOk) die("S6 链路记录缺失");
evidence.scenarios.S6.provOk = provOk; evidence.scenarios.S6.chainOk = chainOk;

// ── S8 停用恢复 ──
await gotoModule("tab-making");
await installConfirmOverride();
await waitFor("状态条当前启用", async () => evaluate(makingExpr).then((s) => s.statusActive && s.statusText.includes(CHAIN_NAME) ? s : null), { timeoutMs: 15000 });
await clickRect(`document.getElementById("making-deactivate-btn")`, "停用按钮");
await waitFor("状态条未启用", async () => evaluate(makingExpr).then((s) => (s.statusIdleText ?? "").includes("当前未启用链路") ? s : null), { timeoutMs: 20000 });
const r8 = await newConversationAndAsk(Q8, "S8-停用后", false);
const m8 = recordSample("S8-neutral", r8.convText.slice(Q8.length));
evidence.scenarios.S8 = { chainLines: r8.chainLines, markers: m8 };
log("S8 停用后完成", { chainLines: r8.chainLines });
// 停用轮档案无链路记录
const newest = JSON.parse(readFileSync(readdirSync(WORK_CONVERSATIONS).filter((f) => f.endsWith(".json") && !f.endsWith("meta.json")).map((f) => ({ f: join(WORK_CONVERSATIONS, f), m: statSync(join(WORK_CONVERSATIONS, f)).mtimeMs })).sort((a, b) => b.m - a.m)[0].f, "utf8"));
evidence.scenarios.S8.archiveChain = newest.chain_rounds ?? null;
if (Array.isArray(newest.chain_rounds) && newest.chain_rounds.length > 0) die("S8 停用后档案不应有链路记录");

// ── 判分汇总 ──
const s3ok = evidence.samples.filter((s) => s.id.startsWith("S3")).every((s) => s.verdict === "换皮成功");
const s7ok = (evidence.samples.find((s) => s.id === "S7-followup")?.verdict ?? "") === "换皮成功";
const s8ok = (r8.chainLines ?? []).length === 0;
evidence.verdict = { s3换皮: s3ok, s7保持: s7ok, s6检索一致: provOk, s6链路记录: chainOk, s8停用恢复: s8ok };
evidence.passed = s3ok && s7ok && provOk && chainOk && s8ok; // S1/S2 已在流程内硬断言；S4/S5 人工复核（样本已落盘）
dump();
console.log("E2E_OK elapsed=" + (Date.now() - startedAt) + "ms verdict=" + JSON.stringify(evidence.verdict) + " passed=" + evidence.passed);
ws.close(); process.exit(0);
