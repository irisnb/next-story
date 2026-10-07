// d-verify.mjs — 姿态卡真实装配验证（D 条件）：卡经 chain_cards 协议字段装配、用户消息干净
// 目的：①验证检索不受卡文本污染（对比 Q1-A 裸问的 3×雾岭 命中）；②皮骨行为与手工模拟对比
// 方法沿 e2e-driver.mjs（②归档）：真实鼠标＋insertText，DOM 只读，confirm 改道 devtools（如实记录）
import { writeFileSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const BASE = "http://127.0.0.1:9222";
const OUT = ".";
const CHAIN_NAME = "傲娇搭档验证链";
const Q1 = "雾岭这条线往下走，有什么可能的方向？";
const CARD_DICTATION = `请按下面文本原样做一张要求卡，卡名叫「傲娇搭档」，不要改写内容、不用再澄清，直接出卡草稿：\n\n【陪想姿态：傲娇搭档】\n（这是可替换的说话姿态：换掉它，你陪我想、不替我判断的本分不变。）\n\n一、说话的样子\n嘴硬心软：开口爱嫌弃我"笨蛋""这也要问"，实际每次都认真陪我想到最后。\n可以毒舌、得意、别扭地夸人（"哼……还行吧"）；但傲娇是语气不是本事——毒舌之后必须跟实打实的想法。\n\n二、看剧本\n用你全部本来的眼光看剧本：不降智、不装傻、不聊这个世界观之外的设定，也别自称别的名字。\n\n三、底线不换皮\n- 说我的故事"不行"只能是带依据的观察或假设，讲清线索；选什么、改不改，我说了算。\n- 我让你"直接写进正文"时规矩照旧：只给候选，我的稿子一个字不许动，并提醒我自己动手。`;
const CLARIFY_REPLY = "不用再澄清了。就按我上一条给的文本原样出卡草稿，一个字都不要改。";
const WORK_CONVERSATIONS = "C:\\Users\\Administrator\\Desktop\\test\\统一真机验收-20260926\\next-story-system\\conversations";
const MAKING_DIR = "C:\\Users\\Administrator\\AppData\\Local\\com.nextstory.desktop\\making-module";

const list = await fetch(`${BASE}/json/list`).then((r) => r.json());
const target = list.find((t) => t.type === "page" && t.title.includes("Next Story"));
if (!target) { console.error("D_FAIL 未找到页面目标"); process.exit(1); }
const ws = new WebSocket(target.webSocketDebuggerUrl);
let seq = 0; const pending = new Map();
const send = (method, params = {}) => new Promise((res, rej) => { const id = ++seq; pending.set(id, { res, rej }); ws.send(JSON.stringify({ id, method, params })); });
ws.addEventListener("message", (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); } });
await new Promise((res) => ws.addEventListener("open", res));
await send("Runtime.enable");
const startedAt = Date.now();
const evidence = { at: new Date().toISOString(), events: [], captured: {}, assertions: {} };
function dump() { evidence.elapsedMs = Date.now() - startedAt; writeFileSync(join(OUT, "D-verify.json"), JSON.stringify(evidence, null, 2)); }
function die(msg) { evidence.events.push({ t: Date.now() - startedAt, fail: msg }); dump(); console.error("D_FAIL " + msg); ws.close(); process.exit(1); }
function log(ev, extra) { evidence.events.push({ t: Date.now() - startedAt, ev, ...(extra ?? {}) }); console.log("D_EV " + ev + (extra ? " " + JSON.stringify(extra).slice(0, 200) : "")); }
async function evaluate(expression) { const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) die("页面求值异常: " + JSON.stringify(r.exceptionDetails).slice(0, 300)); return r.result?.value; }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function clickRect(elExpr, what) { const rect = await evaluate(`(() => { const el = ${elExpr}; if (!el) return null; el.scrollIntoView({ block: "nearest" }); const r = el.getBoundingClientRect(); if (r.width === 0 || r.height === 0) return null; return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`); if (!rect) die("点击目标不存在或不可见: " + what); const base = { x: Math.round(rect.x), y: Math.round(rect.y), button: "left", clickCount: 1 }; await send("Input.dispatchMouseEvent", { ...base, type: "mouseMoved" }); await sleep(60); await send("Input.dispatchMouseEvent", { ...base, type: "mousePressed" }); await sleep(50); await send("Input.dispatchMouseEvent", { ...base, type: "mouseReleased" }); }
async function typeInto(elExpr, text, what) { await clickRect(elExpr, what); await sleep(80); await send("Input.insertText", { text }); }
async function screenshot(name) { const shot = await send("Page.captureScreenshot", { format: "png" }); writeFileSync(join(OUT, name + ".png"), Buffer.from(shot.data, "base64")); log("screenshot", { file: name + ".png" }); }
const VIS = `((el) => !!el && !el.classList.contains("hidden") && !el.hidden && el.getBoundingClientRect().width > 0)`;
async function installConfirmOverride() { await evaluate(`(() => { window.__confirmLog = []; globalThis.confirm = (msg) => { window.__confirmLog.push(String(msg)); return Promise.resolve(true); }; return true; })()`); }
async function waitFor(desc, probe, { timeoutMs = 30000, intervalMs = 500 } = {}) { const deadline = Date.now() + timeoutMs; let last; while (Date.now() < deadline) { last = await probe(); if (last) return last; await sleep(intervalMs); } die(`等待超时(${timeoutMs}ms): ${desc}，最后=${JSON.stringify(last ?? null).slice(0, 300)}`); }

const makingStateExpr = `(() => {
  const vis = ${VIS};
  const byId = (id) => document.getElementById(id);
  return {
    makingVisible: vis(byId("module-making")),
    statusActive: vis(byId("making-status-active")),
    statusText: (byId("making-status-text")?.textContent ?? "").trim(),
    statusIdleText: (byId("making-status-idle")?.textContent ?? "").trim(),
    deactivateVisible: vis(byId("making-deactivate-btn")),
    libraryOpen: byId("module-making")?.classList.contains("making-library-open") ?? false,
    newChainBtnVisible: vis(byId("making-new-chain-btn")),
    chainRows: [...document.querySelectorAll("#making-chain-list .making-chain-row")].map((b) => ({ name: b.querySelector(".making-chain-row-name")?.textContent ?? "", selected: b.classList.contains("selected") })),
    inspectorTitle: (byId("making-inspector-title")?.textContent ?? "").trim(),
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
    notice: vis(byId("making-session-notice")) ? (byId("making-session-notice")?.textContent ?? "").trim() : null,
  };
})()`;
async function makingDone() {
  let lastText = ""; let lastProgress = Date.now();
  const hardDeadline = Date.now() + 420000;
  for (;;) {
    const st = await evaluate(makingStateExpr);
    if (st.errorStatus) die("制作轮次失败: " + st.errorStatus.slice(0, 300));
    if (!st.stopHidden || st.sendDisabled || st.pendingStatus) {
      if (st.lastAssistantText !== lastText) { lastText = st.lastAssistantText; lastProgress = Date.now(); }
      if (Date.now() - lastProgress > 200000) die("制作轮次等待停滞超时");
      if (Date.now() > hardDeadline) die("制作轮次等待硬超时");
      await sleep(1500); continue;
    }
    await sleep(2000);
    return await evaluate(makingStateExpr);
  }
}
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
    errorText: (w.querySelector('[data-role="error-message"]')?.textContent || w.querySelector('[data-role="follow-up-error-message"]')?.textContent || w.querySelector('[data-role="direct-question-error-message"]')?.textContent || "").trim(),
    readingReq: vis(w.querySelector('[data-role="reading-request"]')),
    convText: (w.querySelector('[data-role="conversation"]')?.innerText || "").trim(),
    materialsVisible: vis(w.querySelector('[data-role="materials-panel"]')),
    chainLines: [...w.querySelectorAll('[data-role="materials-body"] .ai-material-chain')].map((el) => el.textContent.trim()),
    materialsBody: (w.querySelector('[data-role="materials-body"]')?.innerText || "").trim(),
    dockCount: (document.querySelector("#ai-dock-count")?.textContent || "").trim()
  };
})()`;
async function aiRoundDone() {
  let lastText = ""; let stableSince = null; let lastProgress = Date.now(); let allowClicked = false;
  const hardDeadline = Date.now() + 420000;
  for (;;) {
    const st = await evaluate(aiStateExpr);
    if (st.noWindow) die("讨论窗口消失");
    if (st.error) die("轮内出错: " + (st.errorText || "").slice(0, 250));
    if (Date.now() > hardDeadline) die("轮次等待硬超时");
    if (st.readingReq && !allowClicked) { log("reading-allow clicked", { reason: st.errorText }); await clickRect(`${W}?.querySelector('[data-role="reading-allow"]')`, "按需补读·允许"); allowClicked = true; lastProgress = Date.now(); await sleep(1000); continue; }
    const text = st.convText || "";
    const completeSignals = st.followUp || (!st.loading && !st.stop);
    if (text.length > 0 && completeSignals) {
      if (text === lastText) { if (stableSince !== null && Date.now() - stableSince >= 4500) { evidence.captured.readingRequested = allowClicked; return await evaluate(aiStateExpr); } }
      else { lastText = text; stableSince = Date.now(); lastProgress = Date.now(); }
    } else { stableSince = null; if (text.length > 0) lastProgress = Date.now(); }
    if (Date.now() - lastProgress > 200000) die("轮次等待停滞超时");
    await sleep(1500);
  }
}
async function gotoModule(tab) { await clickRect(`document.getElementById("${tab}")`, `页签 ${tab}`); await sleep(600); }
async function newConversation() {
  let headerBtn = await evaluate(`${VIS}(document.getElementById("ai-new-conversation"))`);
  if (!headerBtn) {
    const railExpand = await evaluate(`${VIS}(document.getElementById("ai-rail-expand"))`);
    if (railExpand) await clickRect(`document.getElementById("ai-rail-expand")`, "展开 AI 停靠区");
    else await clickRect(`document.getElementById("btn-toggle-ai")`, "AI 面板开关");
    await sleep(700);
    headerBtn = await evaluate(`${VIS}(document.getElementById("ai-new-conversation"))`);
    if (!headerBtn) {
      const railNew = await evaluate(`${VIS}(document.getElementById("ai-rail-new"))`);
      if (railNew) return clickRect(`document.getElementById("ai-rail-new")`, "窄条·新建对话");
      die("找不到「新建对话」入口");
    }
  }
  await clickRect(`document.getElementById("ai-new-conversation")`, "新建对话按钮");
}

// ===== P1 新建链路 =====
await gotoModule("tab-making");
await waitFor("制作页可见", async () => evaluate(makingStateExpr).then((s) => s.makingVisible));
let st0 = await evaluate(makingStateExpr);
if (st0.chainRows.some((r) => r.name === CHAIN_NAME && r.selected)) {
  log("P1 链路已存在且选中（幂等重跑）");
} else if (st0.chainRows.some((r) => r.name === CHAIN_NAME)) {
  await clickRect(`[...document.querySelectorAll("#making-chain-list .making-chain-row")].find((b) => b.querySelector(".making-chain-row-name")?.textContent.trim() === ${JSON.stringify(CHAIN_NAME)})`, "既有链路行");
  await sleep(600);
  log("P1 选中既有链路（幂等重跑）");
} else {
  if (!st0.newChainBtnVisible) { await clickRect(`document.getElementById("making-library-toggle")`, "链路库入口"); await sleep(500); }
  await clickRect(`document.getElementById("making-new-chain-btn")`, "新建链路按钮");
  await waitFor("新建链路表单", async () => evaluate(`${VIS}(document.getElementById("making-new-chain-form"))`), { timeoutMs: 8000 });
  await typeInto(`document.getElementById("making-new-chain-name")`, CHAIN_NAME, "链路名称输入框");
  await clickRect(`document.getElementById("making-new-chain-confirm")`, "创建按钮");
  await waitFor("链路选中", async () => evaluate(makingStateExpr).then((s) => s.chainRows.some((r) => r.name === CHAIN_NAME && r.selected) ? s : null), { timeoutMs: 15000 });
}
await screenshot("D1-新链路");
log("P1 链路已建");

// ===== P1.5 收起链路库（窄窗抽屉会遮挡对话区），切到「制作对话」标签 =====
const libOpen = await evaluate(`document.getElementById("module-making")?.classList.contains("making-library-open") ?? false`);
if (libOpen) { await clickRect(`document.getElementById("making-library-toggle")`, "链路库入口（收起）"); await sleep(600); }
await clickRect(`document.getElementById("making-view-chat-btn")`, "制作对话标签");
await sleep(600);

// ===== P2 制作对话：口述出卡 =====
st0 = await evaluate(makingStateExpr);
if (!st0.convActive) {
  if (st0.convEmpty) await clickRect(`document.getElementById("making-conversation-start-btn")`, "开始新制作");
  else die("制作对话区状态异常");
}
await waitFor("制作输入可用", async () => evaluate(makingStateExpr).then((s) => s.convActive && s.inputDisabled === false && s.stopHidden ? s : null), { timeoutMs: 15000 });
let draftReady = false;
for (let attempt = 1; attempt <= 3 && !draftReady; attempt++) {
  const text = attempt === 1 ? CARD_DICTATION : CLARIFY_REPLY;
  await typeInto(`document.getElementById("making-conversation-input")`, text, "制作对话输入框");
  let ready = false;
  for (let i = 0; i < 30; i++) { const s = await evaluate(makingStateExpr); if (s.sendDisabled === false) { ready = true; break; } await sleep(400); }
  if (!ready) die("制作发送按钮未启用");
  await clickRect(`document.getElementById("making-conversation-send")`, "制作发送按钮");
  log("P2 制作消息已发", { attempt });
  const done = await makingDone();
  evidence.captured["assistantText" + attempt] = done.lastAssistantText.slice(0, 2000);
  if (done.draftPanels > 0 && done.draftCardCount > 0) { draftReady = true; evidence.captured.draftCardCount = done.draftCardCount; }
  else log("P2 本轮无草稿面板（可能仅澄清），继续", { attempt });
}
if (!draftReady) die("三轮口述后仍无卡草稿面板");
await screenshot("D2-卡草稿");
log("P2 草稿面板已出");

// ===== P3 保存草稿 =====
await installConfirmOverride();
await clickRect(`[...document.querySelectorAll("#making-session-messages .making-draft-panel .making-draft-actions button")].find((b) => b.textContent.trim() === "保存这版草稿")`, "保存这版草稿按钮");
const stSave = await waitFor("保存结果提示", async () => evaluate(makingStateExpr).then((s) => s.notice && (s.notice.includes("已保存为") || s.notice.includes("保存失败")) ? s : null), { timeoutMs: 20000 });
evidence.captured.confirmLogSave = await evaluate(`window.__confirmLog ?? []`);
evidence.captured.saveNotice = stSave.notice;
if (!stSave.notice.includes("已保存为")) die("草稿保存失败: " + stSave.notice);
await screenshot("D3-保存");
log("P3 草稿已保存", { notice: stSave.notice });

// ===== P4 读取落盘卡文本（保真核对） =====
try {
  const chainFiles = readdirSync(MAKING_DIR).filter((f) => f.endsWith(".json"));
  let found = null;
  for (const f of chainFiles) { const j = JSON.parse(readFileSync(join(MAKING_DIR, f), "utf8")); if ((j.name ?? j.title ?? "") === CHAIN_NAME) { found = j; break; } }
  if (found) { evidence.captured.savedChain = JSON.parse(JSON.stringify(found)).versions ? { name: found.name, versionCount: found.versions.length, latestCards: (found.versions.at(-1).cards ?? []).map((c) => ({ name: c.name ?? c.title ?? "", trigger: (c.trigger ?? c.trigger_description ?? "").slice(0, 200), bodyLen: (c.body ?? c.content ?? "").length, bodyHead: (c.body ?? c.content ?? "").slice(0, 300) })) } : { raw: JSON.stringify(found).slice(0, 2000) }; }
  else log("P4 未在 making-module 目录找到链路文件（如实记录）");
} catch (e) { log("P4 读取链路文件失败", { err: String(e).slice(0, 200) }); }

// ===== P5 启用（③流程：导图视图→版本选择器选第1版→启用按钮） =====
await clickRect(`document.getElementById("making-view-map-btn")`, "导图标签");
await sleep(600);
await evaluate(`(() => { const sel = document.querySelector("#making-version-select"); if (!sel) return false; const opt = [...sel.options].find(o => o.textContent.includes("第1版")); if (!opt) return false; sel.value = opt.value; sel.dispatchEvent(new Event("change", { bubbles: true })); return true; })()`);
await sleep(400);
const stE = await waitFor("启用按钮可见", async () => evaluate(makingStateExpr).then((s) => s.enableVisible && s.enableText.includes("启用") ? s : null), { timeoutMs: 15000 });
evidence.captured.enableText = stE.enableText;
await installConfirmOverride();
await clickRect(`document.getElementById("making-enable-btn")`, "启用按钮");
const stA = await waitFor("状态条已启用", async () => evaluate(makingStateExpr).then((s) => s.statusActive && s.statusText.includes(CHAIN_NAME) ? s : null), { timeoutMs: 20000 });
evidence.captured.confirmLogEnable = await evaluate(`window.__confirmLog ?? []`);
evidence.captured.statusText = stA.statusText;
await screenshot("D4-启用");
log("P5 已启用", { status: stA.statusText });

// ===== P6 真实装配提问（D-Q1） =====
await gotoModule("tab-writing");
const before = await evaluate(`document.querySelectorAll("#ai-dock-body .ai-window").length`);
await newConversation();
let stW = null;
for (let i = 0; i < 40; i++) { stW = await evaluate(aiStateExpr); if (stW && !stW.noWindow && stW.windows > before && stW.dqVisible) break; await sleep(500); }
if (!stW || stW.noWindow || !(stW.windows > before)) die("新讨论窗口未出现");
await typeInto(`${W}?.querySelector('[data-role="direct-question-input"]')`, Q1, "直接提问输入框");
let sendReady = false;
for (let i = 0; i < 30; i++) { stW = await evaluate(aiStateExpr); if (stW.sendDisabled === false) { sendReady = true; break; } await sleep(400); }
if (!sendReady) die("发送按钮未启用");
await clickRect(`${W}?.querySelector('[data-role="direct-question-send"]')`, "发送按钮");
log("P6 问题已发（干净消息，卡走协议字段）");
const doneQ = await aiRoundDone();
await sleep(800);
await clickRect(`${W}?.querySelector('[data-role="materials-toggle"]')`, "本次参考了什么入口");
const stM = await waitFor("材料面板展开", async () => evaluate(aiStateExpr).then((s) => s.materialsVisible ? s : null), { timeoutMs: 10000 });
evidence.captured.dq1 = { question: Q1, convText: doneQ.convText, chainLines: stM.chainLines, materialsBody: stM.materialsBody.slice(0, 1500), dockCount: stM.dockCount };
await screenshot("D5-装配提问");
const expectLine = `本轮链路：${CHAIN_NAME}`;
evidence.assertions.chainLinePresent = stM.chainLines.some((l) => l.includes(expectLine) || l.includes("第1版"));
log("P6 完成", { chainLines: stM.chainLines, convLen: doneQ.convText.length });
try { await clickRect(`${W}?.querySelector('[data-role="close"]')`, "关闭窗口"); } catch { /* 证据已落盘 */ }

// ===== P7 档案核对：检索命中 + 链路记录 =====
const files = readdirSync(WORK_CONVERSATIONS).filter((f) => f.endsWith(".json") && !f.endsWith("meta.json")).map((f) => ({ f: join(WORK_CONVERSATIONS, f), m: statSync(join(WORK_CONVERSATIONS, f)).mtimeMs })).sort((a, b) => b.m - a.m);
const newest = JSON.parse(readFileSync(files[0].f, "utf8"));
evidence.captured.archive = {
  file: files[0].f.split("\\").pop(),
  question: (newest.first_round_material ?? {}).question ?? "",
  focus: newest.focus_document_title,
  provenance: (newest.provenance ?? []).filter((p) => p.turn_index === 0).map((p) => ({ type: p.material_type, term: p.matched_term ?? null, entered: p.entered_model_context, confirmed: p.sent_confirmed })),
  chain_rounds: newest.chain_rounds ?? null,
};
log("P7 档案核对", { file: evidence.captured.archive.file, prov: evidence.captured.archive.provenance.map((p) => p.type + (p.term ? "(" + p.term + ")" : "")).join("+"), chain: newest.chain_rounds ?? [] });

// ===== P8 停用 =====
await gotoModule("tab-making");
await installConfirmOverride();
await waitFor("状态条当前启用", async () => evaluate(makingStateExpr).then((s) => s.statusActive && s.statusText.includes(CHAIN_NAME) ? s : null), { timeoutMs: 15000 });
await clickRect(`document.getElementById("making-deactivate-btn")`, "停用按钮");
await waitFor("状态条未启用", async () => evaluate(makingStateExpr).then((s) => s.statusIdleText.includes("当前未启用链路") ? s : null), { timeoutMs: 20000 });
evidence.captured.confirmLogDeactivate = await evaluate(`window.__confirmLog ?? []`);
await screenshot("D6-停用");
log("P8 已停用");

evidence.assertions.passed = true;
dump();
console.log("D_OK elapsed=" + (Date.now() - startedAt) + "ms chainLine=" + evidence.assertions.chainLinePresent);
ws.close(); process.exit(0);
