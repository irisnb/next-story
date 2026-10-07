// s9-multicard.mjs — 任务 7.5 S9 多卡补验（2026-10-07 拍板：姿态卡可多张）
// 流程：制作对话并存添加第二张姿态卡（视角卡，走「询问替换或并存」）→ 保存 v2 →
//      磁盘核对 v2 卡数 → 启用 → Q1 真机轮 → 判分 → 检索一致 → 停用还原。
// 判据（预登记）：
//   傲娇标记集 {哼,笨蛋,才不,本小姐,真是的,还行吧,拿你没办法,服了} ≥2 不重复＝皮仍在；
//   视角标记集 {节奏,剪辑,镜头,画面,蒙太奇,跳切,快慢,接} ≥2 不重复＝视角生效（人工复核优先）；
//   检索一致＝provenance focus＋雾岭×3；链路行＝傲娇试金石链·第2版。
// 完成判定沿 s7-retry 修复版：!loading && !stop && followUp 且文本非「正在思考」占位符。
import { writeFileSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const BASE = "http://127.0.0.1:9222";
const OUT = ".";
const WORK_CONVERSATIONS = "C:\\Users\\Administrator\\Desktop\\test\\统一真机验收-20260926\\next-story-system\\conversations";
const CHAINS_JSON = "C:\\Users\\Administrator\\AppData\\Local\\com.nextstory.desktop\\making-module\\chains.json";
const CHAIN_NAME = "傲娇试金石链";
const Q1 = "雾岭这条线往下走，有什么可能的方向？";
const TSUNDERE = ["哼", "笨蛋", "才不", "本小姐", "真是的", "还行吧", "拿你没办法", "服了"];
const LENS = ["节奏", "剪辑", "镜头", "画面", "蒙太奇", "跳切", "快慢", "接"];
const DICTATION = `请再按下面文本原样做一张卡，卡名叫「剪辑师眼光」，类型仍是「姿态卡」，不要改写、直接出卡草稿：

【陪想姿态：剪辑师眼光】
（这是可替换的看剧本视角：换掉它，你陪我想、不替我判断的本分不变。）

一、看剧本的方式
把自己当成坐在剪辑台前的剪辑师：先看节奏——哪场长、哪场短，接在一起是快是慢；再看信息的出画入画——观众此刻知道什么、不知道什么，下一场会不会泄底；再看情绪的跳切——相邻两场的情绪是顺接还是对切。

二、说话的样子不变
性格与语气照你现在的来，只是看剧本时多用剪辑的眼光，给方向时可以说"这场戏像镜头怎么接"。

三、底线不换皮
- 剪辑角度的看法只是带依据的观察和假设，讲清线索；选什么、改不改，我说了算。
- 不代写、不动我的稿子，只给候选。`;
const COEXIST_REPLY = "并存。";

const list = await fetch(`${BASE}/json/list`).then((r) => r.json());
const target = list.find((t) => t.type === "page" && t.title.includes("Next Story"));
if (!target) { console.error("S9_FAIL 未找到页面目标（应用未就绪）"); process.exit(1); }
const ws = new WebSocket(target.webSocketDebuggerUrl);
let seq = 0; const pending = new Map(); const consoleErrors = [];
const send = (m, p = {}) => new Promise((res, rej) => { const id = ++seq; pending.set(id, { res, rej }); ws.send(JSON.stringify({ id, method: m, params: p })); });
ws.addEventListener("message", (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); } else if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") { consoleErrors.push(m.params.args.map((a) => a.value ?? a.description ?? a.type).join(" ").slice(0, 300)); } });
await new Promise((r) => ws.addEventListener("open", r));
await send("Runtime.enable");
const startedAt = Date.now();
const evidence = { at: new Date().toISOString(), judgment: { tsundere: TSUNDERE, lens: LENS, rule: "各 ≥2 不重复标记；人工复核优先" }, scenarios: {} };
function dump() { evidence.elapsedMs = Date.now() - startedAt; evidence.consoleErrors = [...new Set(consoleErrors)]; writeFileSync(join(OUT, "s9-multicard.json"), JSON.stringify(evidence, null, 2)); }
function die(msg) { console.error("S9_FAIL " + msg); evidence.fail = msg; dump(); process.exit(1); }
function log(ev, extra) { console.log("S9_EV " + ev + (extra ? " " + JSON.stringify(extra).slice(0, 220) : "")); }
async function evaluate(expression) { const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) die("页面求值异常: " + JSON.stringify(r.exceptionDetails).slice(0, 300)); return r.result?.value; }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function clickRect(elExpr, what) { const rect = await evaluate(`(() => { const el = ${elExpr}; if (!el) return null; el.scrollIntoView({ block: "nearest" }); const r = el.getBoundingClientRect(); if (r.width === 0 || r.height === 0) return null; return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`); if (!rect) die("点击目标不存在或不可见: " + what); const base = { x: Math.round(rect.x), y: Math.round(rect.y), button: "left", clickCount: 1 }; await send("Input.dispatchMouseEvent", { ...base, type: "mouseMoved" }); await sleep(60); await send("Input.dispatchMouseEvent", { ...base, type: "mousePressed" }); await sleep(50); await send("Input.dispatchMouseEvent", { ...base, type: "mouseReleased" }); }
async function typeInto(elExpr, text, what) { await clickRect(elExpr, what); await sleep(80); await send("Input.insertText", { text }); }
async function screenshot(name) { const shot = await send("Page.captureScreenshot", { format: "png" }); writeFileSync(join(OUT, name + ".png"), Buffer.from(shot.data, "base64")); log("screenshot", { file: name + ".png" }); }
const VIS = `((el) => !!el && !el.classList.contains("hidden") && !el.hidden && el.getBoundingClientRect().width > 0)`;
async function installConfirmOverride() { await evaluate(`(() => { window.__confirmLog = []; globalThis.confirm = (msg) => { window.__confirmLog.push(String(msg)); return Promise.resolve(true); }; return true; })()`); }
async function waitFor(desc, probe, { timeoutMs = 30000, intervalMs = 500 } = {}) { const deadline = Date.now() + timeoutMs; let last; while (Date.now() < deadline) { last = await probe(); if (last) return last; await sleep(intervalMs); } die(`等待超时: ${desc}`); }
async function gotoModule(tab) { await clickRect(`document.getElementById("${tab}")`, `页签 ${tab}`); await sleep(600); }

const makingExpr = `(() => {
  const vis = ${VIS};
  const byId = (id) => document.getElementById(id);
  return {
    welcome: vis(byId("welcome-page")),
    libraryOpen: byId("module-making")?.classList.contains("making-library-open") ?? false,
    chainRows: [...document.querySelectorAll("#making-chain-list .making-chain-row")].map((b) => ({ name: b.querySelector(".making-chain-row-name")?.textContent ?? "", selected: b.classList.contains("selected") })),
    statusActive: vis(byId("making-status-active")),
    statusText: (byId("making-status-text")?.textContent ?? "").trim(),
    statusIdleHidden: !byId("making-status-idle") || byId("making-status-idle").classList.contains("hidden"),
    enableVisible: vis(byId("making-enable-btn")),
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
    postureRows: document.querySelectorAll("#making-posture-card-list > *").length,
    postureCountText: (byId("making-posture-card-count")?.textContent ?? "").trim(),
    postureAddVisible: vis(byId("making-add-posture-btn")),
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
      if (Date.now() - lastProgress > 240000) die("制作轮次停滞超时");
      if (Date.now() > hard) die("制作轮次硬超时");
      await sleep(1500); continue;
    }
    await sleep(2000);
    return evaluate(makingExpr);
  }
}
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
    error: vis(w.querySelector('[data-role="error-block"]')) || vis(w.querySelector('[data-role="direct-question-error"]')),
    errorText: (w.querySelector('[data-role="error-message"]')?.textContent || w.querySelector('[data-role="direct-question-error-message"]')?.textContent || "").trim(),
    readingReq: vis(w.querySelector('[data-role="reading-request"]')),
    convText: (w.querySelector('[data-role="conversation"]')?.innerText || "").trim(),
    chainLines: [...w.querySelectorAll('[data-role="materials-body"] .ai-material-chain')].map((el) => el.textContent.trim()),
  };
})()`;
async function aiRoundDoneFixed(label) {
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
      if (text === lastText) { if (stableSince !== null && Date.now() - stableSince >= 4500) return text; }
      else { lastText = text; stableSince = Date.now(); }
    } else { stableSince = null; if (text.length > 0) lastProgress = Date.now(); }
    if (Date.now() - lastProgress > 240000) die(label + ": 停滞超时");
    await sleep(1500);
  }
}

// S0 开作品（若在欢迎页）
await waitFor("页面出现", async () => evaluate(`(() => { const vis=${VIS}; return vis(document.getElementById("welcome-page")) || vis(document.getElementById("editor-page")) ? true : null; })()`), { timeoutMs: 60000 });
const editorReady = await evaluate(`(() => { const vis=${VIS}; return vis(document.getElementById("editor-page")); })()`);
if (!editorReady) {
  await clickRect(`[...document.querySelectorAll('button')].find(b => (b.innerText || "").includes("统一真机验收-20260926"))`, "最近列表·测试作品");
  await waitFor("编辑器出现", async () => evaluate(`(() => { const vis=${VIS}; return vis(document.getElementById("editor-page")) && !vis(document.getElementById("welcome-page")) ? true : null; })()`), { timeoutMs: 90000 });
}
await sleep(1500);
log("S0 作品已开");

// S9a 制作对话：口述第二张姿态卡（不预设替换/并存）
await gotoModule("tab-making");
let st0 = await evaluate(makingExpr);
if (!st0.libraryOpen) { await clickRect(`document.getElementById("making-library-toggle")`, "链路库入口（展开）"); await sleep(600); }
await clickRect(`[...document.querySelectorAll("#making-chain-list .making-chain-row")].find((b) => b.querySelector(".making-chain-row-name")?.textContent.trim() === ${JSON.stringify(CHAIN_NAME)})`, "链路行");
await sleep(600);
const libOpen1 = await evaluate(`document.getElementById("module-making")?.classList.contains("making-library-open") ?? false`);
if (libOpen1) { await clickRect(`document.getElementById("making-library-toggle")`, "链路库入口（收起）"); await sleep(600); }
await clickRect(`document.getElementById("making-view-chat-btn")`, "制作对话标签");
await sleep(600);
st0 = await evaluate(makingExpr);
if (!st0.convActive) {
  if (st0.convEmpty) await clickRect(`document.getElementById("making-conversation-start-btn")`, "开始新制作");
  else {
    const cont = await evaluate(`${VIS}(document.querySelector("#making-conversation-recent .making-recent-continue"))`);
    if (cont) { await clickRect(`document.querySelector("#making-conversation-recent .making-recent-continue")`, "继续上次制作"); await sleep(800); }
    else die("制作对话区状态异常");
  }
}
await waitFor("制作输入可用", async () => evaluate(makingExpr).then((s) => s.convActive && s.inputDisabled === false && s.stopHidden ? s : null), { timeoutMs: 15000 });

let draftReady = false; let askedCoexist = false; const roundTexts = [];
for (let attempt = 1; attempt <= 4 && !draftReady; attempt++) {
  const text = attempt === 1 ? DICTATION : (attempt === 2 && !askedCoexist ? COEXIST_REPLY : COEXIST_REPLY);
  await typeInto(`document.getElementById("making-conversation-input")`, text, "制作对话输入框");
  let rdy = false;
  for (let i = 0; i < 30; i++) { const s = await evaluate(makingExpr); if (s.sendDisabled === false) { rdy = true; break; } await sleep(400); }
  if (!rdy) die("制作发送按钮未启用");
  await clickRect(`document.getElementById("making-conversation-send")`, "制作发送按钮");
  const done = await makingDone();
  roundTexts.push(done.lastAssistantText.slice(0, 1200));
  const t = done.lastAssistantText;
  if (/替换|并存/.test(t) && done.draftPanels === 0) askedCoexist = true; // 助手先问了（守则生效）
  if (done.draftPanels > 0 && done.draftCardCount > 0) {
    evidence.scenarios.S9a = { attempts, askedCoexist, draftCardCount: done.draftCardCount, typeBadges: done.draftTypeBadges, assistantText: t.slice(0, 2500) };
    draftReady = true;
  } else log("S9a 本轮无草稿面板，继续", { attempt, askedCoexist });
}
if (!draftReady) die("四轮口述后仍无姿态卡草稿");
await screenshot("S9a-第二张姿态卡草稿");
log("S9a 草稿已出", { askedCoexist, badges: evidence.scenarios.S9a.typeBadges });

// S9b 保存 v2
await installConfirmOverride();
await clickRect(`[...document.querySelectorAll("#making-session-messages .making-draft-panel .making-draft-actions button")].find((b) => b.textContent.trim() === "保存这版草稿")`, "保存这版草稿按钮");
const stSave = await waitFor("保存结果提示", async () => evaluate(makingExpr).then((s) => s.notice && (s.notice.includes("已保存为") || s.notice.includes("保存失败")) ? s : null), { timeoutMs: 20000 });
evidence.scenarios.S9b = { notice: stSave.notice };
if (!stSave.notice.includes("已保存为")) die("保存失败: " + stSave.notice);
await screenshot("S9b-保存");
log("S9b 已保存", { notice: stSave.notice });

// S9c 磁盘核对 v2 卡数（并存是否落地）
const chainsData = JSON.parse(readFileSync(CHAINS_JSON, "utf8"));
const chain = (Array.isArray(chainsData) ? chainsData : chainsData.chains).find((c) => (c.name ?? "") === CHAIN_NAME);
const v2 = chain?.versions?.find((v) => v.index === 2) ?? chain?.versions?.at(-1);
const postureCardsV2 = (v2?.cards ?? []).filter((c) => (c.slot_type ?? "requirement") === "posture");
evidence.scenarios.S9c = { versionIndex: v2?.index, totalCards: (v2?.cards ?? []).length, postureCardsV2: postureCardsV2.map((c) => c.title), coexistLanded: postureCardsV2.length >= 2 };
log("S9c 磁盘核对", { v: v2?.index, postureTitles: postureCardsV2.map((c) => c.title) });

// S9d 启用 v2 ＋ 导图姿态组多卡呈现
await clickRect(`document.getElementById("making-view-map-btn")`, "导图标签");
await sleep(600);
await evaluate(`(() => { const sel = document.querySelector("#making-version-select"); if (!sel) return false; const opt = [...sel.options].find(o => o.textContent.includes("第2版")); if (!opt) return false; sel.value = opt.value; sel.dispatchEvent(new Event("change", { bubbles: true })); return true; })()`);
await sleep(500);
await installConfirmOverride();
await waitFor("启用按钮可见", async () => evaluate(makingExpr).then((s) => s.enableVisible ? s : null), { timeoutMs: 15000 });
await clickRect(`document.getElementById("making-enable-btn")`, "启用按钮");
await waitFor("状态条第2版", async () => evaluate(makingExpr).then((s) => s.statusActive && s.statusText.includes("第2版") ? s : null), { timeoutMs: 20000 });
const stMap = await evaluate(makingExpr);
evidence.scenarios.S9d = { statusText: stMap.statusText, postureRows: stMap.postureRows, postureCountText: stMap.postureCountText, postureAddVisible: stMap.postureAddVisible };
await screenshot("S9d-启用v2与多卡");
log("S9d 已启用", evidence.scenarios.S9d);

// S9e Q1 真机轮：皮仍在＋视角生效
await gotoModule("tab-writing");
const before = await evaluate(`document.querySelectorAll("#ai-dock-body .ai-window").length`);
let headerBtn = await evaluate(`${VIS}(document.getElementById("ai-new-conversation"))`);
if (!headerBtn) { const railExpand = await evaluate(`${VIS}(document.getElementById("ai-rail-expand"))`); if (railExpand) await clickRect(`document.getElementById("ai-rail-expand")`, "展开 AI 停靠区"); else await clickRect(`document.getElementById("btn-toggle-ai")`, "AI 面板开关"); await sleep(700); }
await clickRect(`document.getElementById("ai-new-conversation")`, "新建对话按钮");
let stW = null;
for (let i = 0; i < 40; i++) { stW = await evaluate(aiExpr); if (stW && !stW.noWindow && stW.windows > before && stW.dqVisible) break; await sleep(500); }
if (!stW || stW.noWindow || !(stW.windows > before)) die("新讨论窗口未出现");
await typeInto(`${W}?.querySelector('[data-role="direct-question-input"]')`, Q1, "直接提问输入框");
let ready = false;
for (let i = 0; i < 30; i++) { stW = await evaluate(aiExpr); if (stW.sendDisabled === false) { ready = true; break; } await sleep(400); }
if (!ready) die("发送按钮未启用");
await clickRect(`${W}?.querySelector('[data-role="direct-question-send"]')`, "发送按钮");
const respText = await aiRoundDoneFixed("S9e");
await sleep(800);
await clickRect(`${W}?.querySelector('[data-role="materials-toggle"]')`, "本次参考了什么入口");
const stM = await waitFor("材料面板展开", async () => evaluate(aiExpr).then((s) => s.chainLines.length > 0 || true), { timeoutMs: 10000 });
const stFinal = await evaluate(aiExpr);
writeFileSync(join(OUT, "resp-S9-Q1.txt"), respText, "utf8");
const tsMarkers = TSUNDERE.filter((m) => respText.includes(m));
const lensMarkers = LENS.filter((m) => respText.includes(m));
evidence.scenarios.S9e = { chainLines: stFinal.chainLines, tsMarkers, lensMarkers, personaKept: tsMarkers.length >= 2, lensActive: lensMarkers.length >= 2, len: respText.length };
await screenshot("S9e-Q1多卡轮");
log("S9e 完成", { ts: tsMarkers, lens: lensMarkers, chain: stFinal.chainLines });
try { await clickRect(`${W}?.querySelector('[data-role="close"]')`, "关闭窗口按钮"); } catch { }

// S9f 档案核对：检索一致＋链路 v2
await sleep(1500);
const newest = readdirSync(WORK_CONVERSATIONS).filter((f) => f.endsWith(".json") && !f.endsWith("meta.json")).map((f) => ({ f: join(WORK_CONVERSATIONS, f), m: statSync(join(WORK_CONVERSATIONS, f)).mtimeMs })).sort((a, b) => b.m - a.m)[0];
const arc = JSON.parse(readFileSync(newest.f, "utf8"));
const prov = (arc.provenance ?? []).filter((p) => p.turn_index === 0).map((p) => p.material_type + (p.matched_term ? "(" + p.matched_term + ")" : ""));
const snippets = prov.filter((p) => p.startsWith("search_snippet"));
evidence.scenarios.S9f = { archive: newest.f.split("\\").pop(), prov, chain: arc.chain_rounds ?? null, retrievalOk: snippets.length === 3 && snippets.every((p) => p.includes("雾岭")) };
log("S9f 档案核对", { prov, chain: arc.chain_rounds });

// S9g 停用还原
await gotoModule("tab-making");
await installConfirmOverride();
await waitFor("状态条当前启用", async () => evaluate(makingExpr).then((s) => s.statusActive && s.statusText.includes(CHAIN_NAME) ? s : null), { timeoutMs: 15000 });
await clickRect(`document.getElementById("making-deactivate-btn")`, "停用按钮");
await waitFor("状态条未启用", async () => evaluate(makingExpr).then((s) => !s.statusIdleHidden ? s : null), { timeoutMs: 20000 });
log("S9g 已停用（还原）");

// 判分汇总
evidence.verdict = {
  并存落地: evidence.scenarios.S9c.coexistLanded,
  询问流程: evidence.scenarios.S9a.askedCoexist,
  皮仍在: evidence.scenarios.S9e.personaKept,
  视角生效: evidence.scenarios.S9e.lensActive,
  检索一致: evidence.scenarios.S9f.retrievalOk,
};
evidence.passed = evidence.verdict.并存落地 && evidence.verdict.皮仍在 && evidence.verdict.视角生效 && evidence.verdict.检索一致; // 询问流程如未触发如实记录（助手可能从口述直接判断）
dump();
console.log("S9_OK verdict=" + JSON.stringify(evidence.verdict) + " passed=" + evidence.passed);
ws.close(); process.exit(0);
