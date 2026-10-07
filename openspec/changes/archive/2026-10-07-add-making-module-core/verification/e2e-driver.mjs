// e2e-driver.mjs — add-making-module-core 任务 8.2（真实模型端到端）＋8.3（真机冒烟）CDP 驱动器
//
// 方法（项目既定惯例，沿走通一例 round.mjs 与 app-real-chain-validation）：
// - 应用以 `npm run tauri:dev` + WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9223 启动；
// - 本脚本经 CDP WebSocket 连 Next Story 页面目标；
// - 点击＝真实鼠标事件（Input.dispatchMouseEvent：moved→pressed→released）；
// - 文本＝Input.insertText（IME 类提交，项目验收既有通道）；
// - DOM 查询只走 Runtime.evaluate 只读（确认对话框改道除外，见下）；
// - 视觉证据＝Page.captureScreenshot 存 PNG；每步另存 JSON 断言证据；
// - 原生确认对话框（Tauri 插件原生弹窗，合成输入无法驱动）按 2026-09-22
//   app-real-chain-validation C4 先例改道 devtools 通道：覆写 globalThis.confirm，
//   捕获确认文案全文并返回 true（确认文案本身入证据，如实记录改道）。
//
// 用法：node e2e-driver.mjs <step>（步骤见 STEPS 说明；问题文本内嵌常量，避免命令行编码问题）

import { writeFileSync, readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const BASE = "http://127.0.0.1:9223";
const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "8.2-e2e");

const WORK_CONVERSATIONS = "C:\\Users\\Administrator\\Desktop\\test\\统一真机验收-20260926\\next-story-system\\conversations";
const APP_DATA = "C:\\Users\\Administrator\\AppData\\Local\\com.nextstory.desktop";
const MAKING_DIR = join(APP_DATA, "making-module");
const CHAIN_NAME = "装配验证链";

// 问题与口述（走通一例同款）
const Q1 = "雾岭这条线往下走，有什么可能的方向？";
const Q2 = "林晚把第七封信放在最上面这个动作，情绪上怎么处理？";
const Q3 = "这个故事结尾有什么可能？";
const REQUIREMENT = "希望情节讨论多探索反差与反转，但别把台词情绪问题都往反转拽。";
const REQUIREMENT_FOLLOWUP =
  "没有要补充的前提。就按我上一条说的直接出第一版卡草稿：情节讨论多探索反差与反转，但别把台词情绪问题都往反转拽。";
const Q7_KILL = "第七封信之外，其他几封信各自承担什么功能？";
const Q7_RECOVER = "把信的功能和雾岭这条线放在一起看，还有什么可挖的？";

// ========== CDP 连接与基础设施（沿 round.mjs 惯例） ==========

const step = process.argv[2] ?? "";
if (!step) {
  console.error("用法: node e2e-driver.mjs <step>");
  process.exit(2);
}

const list = await fetch(`${BASE}/json/list`).then((r) => r.json());
const target = list.find((t) => t.type === "page" && t.title.includes("Next Story"));
if (!target) {
  console.error("STEP_FAIL 未找到 Next Story 页面目标（应用未启动或 9223 调试通道未开）");
  process.exit(1);
}
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
    return;
  }
  // 控制台错误采集（证据：全程控制台零错误目标）
  if (msg.method === "Runtime.consoleAPICalled" && msg.params.type === "error") {
    consoleErrors.push(
      msg.params.args.map((a) => a.value ?? a.description ?? a.type).join(" ").slice(0, 400),
    );
  }
  if (msg.method === "Runtime.exceptionThrown") {
    const d = msg.params.exceptionDetails;
    consoleErrors.push(`exception: ${(d.exception?.description ?? d.text ?? "").slice(0, 400)}`);
  }
});
await new Promise((res, rej) => {
  ws.addEventListener("open", res);
  ws.addEventListener("error", () => rej(new Error("WebSocket 连接失败")));
});
await send("Runtime.enable");

const consoleErrors = [];
const startedAt = Date.now();
const evidence = { step, at: new Date().toISOString(), events: [], assertions: {}, captured: {} };

function dumpEvidence() {
  evidence.elapsedMs = Date.now() - startedAt;
  evidence.consoleErrors = [...new Set(consoleErrors)].slice(0, 50);
  writeFileSync(join(OUT, `${evidence.name ?? step}.json`), JSON.stringify(evidence, null, 2));
}
function die(msg, code = 1) {
  evidence.events.push({ t: Date.now() - startedAt, fail: msg });
  evidence.assertions.passed = false;
  dumpEvidence();
  console.error(`STEP_FAIL[${step}] ${msg}`);
  ws.close();
  process.exit(code);
}
function ok(extra = {}) {
  evidence.events.push({ t: Date.now() - startedAt, ev: "complete" });
  evidence.assertions.passed = true;
  Object.assign(evidence.captured, extra);
  dumpEvidence();
  console.log(`STEP_OK[${step}] ${JSON.stringify(extra).slice(0, 400)}`);
  ws.close();
  process.exit(0);
}

async function evaluate(expression) {
  const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) die("页面求值异常: " + JSON.stringify(r.exceptionDetails).slice(0, 300));
  return r.result?.value;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function clickRect(elExpr, what) {
  const rect = await evaluate(`(() => { const el = ${elExpr}; if (!el) return null; el.scrollIntoView({ block: "nearest" }); const r = el.getBoundingClientRect(); if (r.width === 0 || r.height === 0) return null; return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
  if (!rect) die("点击目标不存在或不可见: " + what);
  const base = { x: Math.round(rect.x), y: Math.round(rect.y), button: "left", clickCount: 1 };
  await send("Input.dispatchMouseEvent", { ...base, type: "mouseMoved" });
  await sleep(60);
  await send("Input.dispatchMouseEvent", { ...base, type: "mousePressed" });
  await sleep(50);
  await send("Input.dispatchMouseEvent", { ...base, type: "mouseReleased" });
}

async function typeInto(elExpr, text, what) {
  await clickRect(elExpr, what);
  await sleep(80);
  await send("Input.insertText", { text });
}

async function screenshot(name) {
  const shot = await send("Page.captureScreenshot", { format: "png" });
  const file = join(OUT, `${name}.png`);
  writeFileSync(file, Buffer.from(shot.data, "base64"));
  evidence.events.push({ ev: "screenshot", file: `${name}.png` });
}

// 可见性（.hidden 类／hidden 属性／零尺寸）
const VIS = `((el) => !!el && !el.classList.contains("hidden") && !el.hidden && el.getBoundingClientRect().width > 0)`;

// 原生确认改道（app-real-chain-validation C4 先例）：捕获文案全文，自动确认
async function installConfirmOverride() {
  await evaluate(`(() => { window.__confirmLog = []; globalThis.confirm = (msg) => { window.__confirmLog.push(String(msg)); return Promise.resolve(true); }; return true; })()`);
}
async function readConfirmLog() {
  return (await evaluate(`window.__confirmLog ?? []`)) ?? [];
}

// ========== 等待器 ==========

async function waitFor(desc, probe, { timeoutMs = 30000, intervalMs = 500 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let last = undefined;
  while (Date.now() < deadline) {
    last = await probe();
    if (last) return last;
    await sleep(intervalMs);
  }
  die(`等待超时(${timeoutMs}ms): ${desc}，最后状态=${JSON.stringify(last ?? null).slice(0, 300)}`);
}

// ========== 页面状态探针（全部只读） ==========

const W = `[...document.querySelectorAll('#ai-dock-body .ai-window')].at(-1)`;

const aiWindowStateExpr = `(() => {
  const w = ${W};
  const vis = ${VIS};
  if (!w) return { noWindow: true, windows: 0 };
  return {
    windows: document.querySelectorAll("#ai-dock-body .ai-window").length,
    doc: (w.querySelector('[data-role="doc"]')?.textContent || "").trim(),
    dqVisible: vis(w.querySelector('[data-role="direct-question"]')),
    sendDisabled: w.querySelector('[data-role="direct-question-send"]')?.disabled ?? null,
    loading: vis(w.querySelector('[data-role="loading"]')),
    stop: vis(w.querySelector('[data-role="stop"]')),
    followUp: vis(w.querySelector('[data-role="follow-up-form"]')),
    followUpSendDisabled: w.querySelector('[data-role="follow-up-send"]')?.disabled ?? null,
    error: vis(w.querySelector('[data-role="error-block"]')) || vis(w.querySelector('[data-role="follow-up-error"]')) || vis(w.querySelector('[data-role="direct-question-error"]')),
    errorText: (w.querySelector('[data-role="error-message"]')?.textContent || w.querySelector('[data-role="follow-up-error-message"]')?.textContent || w.querySelector('[data-role="direct-question-error-message"]')?.textContent || "").trim(),
    readingReq: vis(w.querySelector('[data-role="reading-request"]')),
    readingReason: (w.querySelector('[data-role="reading-request-reason"]')?.textContent || "").trim(),
    convText: (w.querySelector('[data-role="conversation"]')?.innerText || "").trim(),
    materialsVisible: vis(w.querySelector('[data-role="materials-panel"]')),
    chainLines: [...w.querySelectorAll('[data-role="materials-body"] .ai-material-chain')].map((el) => el.textContent.trim()),
    materialsBody: (w.querySelector('[data-role="materials-body"]')?.innerText || "").trim(),
  };
})()`;

const makingStateExpr = `(() => {
  const vis = ${VIS};
  const byId = (id) => document.getElementById(id);
  const rows = [...document.querySelectorAll("#making-chain-list .making-chain-row")].map((b) => ({
    name: b.querySelector(".making-chain-row-name")?.textContent ?? "",
    status: b.querySelector(".making-chain-row-status")?.textContent ?? "",
    selected: b.classList.contains("selected"),
  }));
  return {
    makingVisible: vis(byId("module-making")),
    statusActive: vis(byId("making-status-active")),
    statusText: (byId("making-status-text")?.textContent ?? "").trim(),
    statusIdle: vis(byId("making-status-idle")),
    statusIdleText: (byId("making-status-idle")?.textContent ?? "").trim(),
    deactivateVisible: vis(byId("making-deactivate-btn")),
    libraryOpen: byId("module-making")?.classList.contains("making-library-open") ?? false,
    newChainBtnVisible: vis(byId("making-new-chain-btn")),
    chainRows: rows,
    inspectorTitle: (byId("making-inspector-title")?.textContent ?? "").trim(),
    inspectorState: (byId("making-inspector-state")?.textContent ?? "").trim(),
    enableVisible: vis(byId("making-enable-btn")),
    enableText: (byId("making-enable-btn")?.textContent ?? "").trim(),
    convActive: vis(byId("making-conversation-active")),
    convEmpty: vis(byId("making-conversation-empty")),
    makingObject: (byId("making-conversation-object")?.textContent ?? "").trim(),
    sessionTitle: (byId("making-session-title")?.textContent ?? "").trim(),
    notice: vis(byId("making-session-notice")) ? (byId("making-session-notice")?.textContent ?? "").trim() : null,
    inputDisabled: byId("making-conversation-input")?.disabled ?? null,
    stopHidden: !byId("making-conversation-stop") || byId("making-conversation-stop").hidden,
    sendDisabled: byId("making-conversation-send")?.disabled ?? null,
    lastAssistantText: (() => { const els = [...document.querySelectorAll("#making-session-messages .making-msg-assistant .making-msg-text")]; return els.length ? els[els.length - 1].textContent : ""; })(),
    pendingStatus: (() => { const els = [...document.querySelectorAll("#making-session-messages .making-msg-status.is-pending")]; return els.length ? els[els.length - 1].textContent : null; })(),
    errorStatus: (() => { const els = [...document.querySelectorAll("#making-session-messages .making-msg-status.is-error")]; return els.length ? els[els.length - 1].textContent : null; })(),
    draftPanels: document.querySelectorAll("#making-session-messages .making-draft-panel").length,
    draftCardCount: document.querySelectorAll("#making-session-messages .making-draft-card").length,
    trialPanel: vis(byId("making-trial-panel")),
    trialForm: vis(byId("making-trial-form")),
    trialGuard: vis(byId("making-trial-guard")) ? (byId("making-trial-guard")?.textContent ?? "").trim() : null,
    trialMeta: (byId("making-trial-meta")?.textContent ?? "").trim(),
    trialRunVisible: vis(byId("making-trial-run")),
    trialRunMeta: (byId("making-trial-run-meta")?.textContent ?? "").trim(),
    trialBlocks: [...document.querySelectorAll("#making-trial-runs .making-trial-block")].map((b) => ({
      trialId: b.dataset.trialId ?? "",
      kind: b.querySelector(".making-trial-block-kind")?.textContent ?? "",
      status: b.querySelector(".making-trial-block-status")?.textContent ?? "",
      question: b.querySelector(".making-trial-q")?.textContent ?? "",
      reply: b.querySelector(".making-trial-reply")?.textContent ?? "",
      hasAuth: !!b.querySelector(".making-trial-auth"),
      hasCompare: !!b.querySelector(".making-trial-block-actions .making-mini-btn"),
    })),
    cardPanelVisible: vis(byId("making-card-panel")),
    trialRecordRows: document.querySelectorAll("#making-card-panel .making-trial-record-row").length,
    trialRecordTexts: [...document.querySelectorAll("#making-card-panel .making-trial-record-row")].map((b) => b.textContent.trim()),
    trialRecordsSummary: (document.querySelector("#making-card-panel .making-trial-records-mount .making-card-panel-body")?.textContent ?? "").trim(),
  };
})()`;

async function makingDone(deadlineNoProgressMs = 200000, hardCapMs = 420000) {
  // 制作会话轮次完成判定：停止隐藏＋发送启用＋无 pending 状态；失败即抛
  let lastText = "";
  let lastProgress = Date.now();
  const hardDeadline = Date.now() + hardCapMs;
  for (;;) {
    const st = await evaluate(makingStateExpr);
    if (st.errorStatus) die("制作轮次失败: " + st.errorStatus.slice(0, 300));
    if (!st.stopHidden || st.sendDisabled || st.pendingStatus) {
      if (st.lastAssistantText !== lastText) { lastText = st.lastAssistantText; lastProgress = Date.now(); }
      if (Date.now() - lastProgress > deadlineNoProgressMs) die("制作轮次等待停滞超时");
      if (Date.now() > hardDeadline) die("制作轮次等待硬超时");
      await sleep(1500);
      continue;
    }
    await sleep(2000); // 终态原子更新后的保存与重绘余量
    return await evaluate(makingStateExpr);
  }
}

async function aiRoundDone(deadlineNoProgressMs = 200000, hardCapMs = 420000) {
  // 日常讨论轮次完成判定（沿 round.mjs）：文本稳定＋完成信号；期间代点按需补读「允许」
  let lastText = "";
  let stableSince = null;
  let lastProgress = Date.now();
  let allowClicked = false;
  const hardDeadline = Date.now() + hardCapMs;
  for (;;) {
    const st = await evaluate(aiWindowStateExpr);
    if (st.noWindow) die("讨论窗口消失");
    if (st.error) die("轮内出错: " + (st.errorText || "").slice(0, 250));
    if (Date.now() > hardDeadline) die("轮次等待硬超时");
    if (st.readingReq && !allowClicked) {
      evidence.events.push({ t: Date.now() - startedAt, ev: "reading-allow clicked", reason: st.readingReason.slice(0, 200) });
      await clickRect(`${W}?.querySelector('[data-role="reading-allow"]')`, "按需补读·允许");
      allowClicked = true;
      lastProgress = Date.now();
      await sleep(1000);
      continue;
    }
    const text = st.convText || "";
    const completeSignals = st.followUp || (!st.loading && !st.stop);
    if (text.length > 0 && completeSignals) {
      if (text === lastText) {
        if (stableSince !== null && Date.now() - stableSince >= 4500) {
          evidence.captured.readingRequested = allowClicked;
          return await evaluate(aiWindowStateExpr);
        }
      } else {
        lastText = text;
        stableSince = Date.now();
        lastProgress = Date.now();
      }
    } else {
      stableSince = null;
      if (text.length > 0) lastProgress = Date.now();
    }
    if (Date.now() - lastProgress > deadlineNoProgressMs) die("轮次等待停滞超时（200s 无进展）");
    await sleep(1500);
  }
}

// ========== 组合动作 ==========

async function gotoModule(tab) {
  await clickRect(`document.getElementById("${tab}")`, `页签 ${tab}`);
  await sleep(600);
}

async function newConversation() {
  // 展开停靠区（可能在窄条状态）后点「新建对话」
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
      die("找不到「新建对话」入口（停靠区展开失败）");
    }
  }
  await clickRect(`document.getElementById("ai-new-conversation")`, "新建对话按钮");
}

async function ensureFocusDoc(docName) {
  let st = await evaluate(aiWindowStateExpr);
  if (st.doc.includes(docName)) return st.doc;
  await clickRect(`${W}?.querySelector('[data-role="focus-switch"]')`, "切换关注文档入口");
  // 菜单为 document.body 下的 .ai-menu，按文字找目标项
  await waitFor("关注文档菜单出现", async () => evaluate(`!!document.querySelector("body > .ai-menu")`), { timeoutMs: 8000 });
  await clickRect(
    `[...document.querySelectorAll("body > .ai-menu button")].find((b) => (b.textContent || "").trim().startsWith("${docName}"))`,
    `菜单项 ${docName}`,
  );
  const after = await waitFor("关注文档切换生效", async () => {
    const s = await evaluate(aiWindowStateExpr);
    return s.doc.includes(docName) ? s.doc : null;
  }, { timeoutMs: 15000 });
  evidence.events.push({ ev: "focus doc switched", from: st.doc, to: after });
  return after;
}

async function askDirect(question, shotName) {
  const existing = await evaluate(aiWindowStateExpr);
  // 已有全新空窗口（直接提问表单可见且无任何轮次文本）时直接复用，不再新建
  const reusable = !existing.noWindow && existing.dqVisible && (existing.convText || "").length === 0 && !existing.error;
  const before = existing.windows ?? 0;
  if (!reusable) await newConversation();
  let st = null;
  for (let i = 0; i < 40; i++) {
    st = await evaluate(aiWindowStateExpr);
    if (st && !st.noWindow && (reusable || st.windows > before) && st.dqVisible) break;
    await sleep(500);
  }
  if (!st || st.noWindow || !(reusable || st.windows > before)) die("新讨论窗口未出现");
  // 全新讨论在首轮发起前无关注文档绑定（发起时才按当前编辑文档绑定）：
  // 已有绑定但不是目标文档时才显式切换；无绑定时直接发送，完成后核对绑定结果。
  if (st.doc && st.doc.length > 0 && !st.doc.includes("主角篇")) {
    await ensureFocusDoc("主角篇");
  }
  await typeInto(`${W}?.querySelector('[data-role="direct-question-input"]')`, question, "直接提问输入框");
  let sendReady = false;
  for (let i = 0; i < 30; i++) {
    st = await evaluate(aiWindowStateExpr);
    if (st.sendDisabled === false) { sendReady = true; break; }
    await sleep(400);
  }
  if (!sendReady) die("发送按钮未启用（输入可能未生效）");
  await clickRect(`${W}?.querySelector('[data-role="direct-question-send"]')`, "发送按钮");
  evidence.events.push({ t: Date.now() - startedAt, ev: "direct question sent", question });
  const done = await aiRoundDone();
  await sleep(800);
  // 打开「本次参考了什么」
  await clickRect(`${W}?.querySelector('[data-role="materials-toggle"]')`, "本次参考了什么入口");
  const final = await waitFor("材料面板展开", async () => {
    const s = await evaluate(aiWindowStateExpr);
    return s.materialsVisible ? s : null;
  }, { timeoutMs: 10000 });
  if (!final.doc.includes("主角篇")) die(`首轮完成后关注文档不是主角篇：doc=${final.doc}`);
  if (shotName) await screenshot(shotName);
  return final;
}

async function followUp(question, shotName) {
  let st = await evaluate(aiWindowStateExpr);
  if (st.noWindow || !st.followUp) die("追问表单不可见（上一轮未完成或窗口已关）");
  // 等追问输入启用（失败轮待重试态会禁输入）；点击＋insertText 后核验落值，未落则重打
  await waitFor("追问输入可用", async () => evaluate(`${W}?.querySelector('[data-role="follow-up-input"]')?.disabled === false`), { timeoutMs: 20000 });
  let typed = false;
  for (let attempt = 0; attempt < 3 && !typed; attempt++) {
    await typeInto(`${W}?.querySelector('[data-role="follow-up-input"]')`, question, "追问输入框");
    await sleep(400);
    typed = await evaluate(`((${W}?.querySelector('[data-role="follow-up-input"]')?.value ?? "").length > 0)`);
    if (!typed) evidence.events.push({ ev: "追问输入未落值，重试键入", attempt });
  }
  if (!typed) die("追问文本未落入输入框（三次键入后仍为空）");
  let ready = false;
  for (let i = 0; i < 30; i++) {
    st = await evaluate(aiWindowStateExpr);
    if (st.followUpSendDisabled === false) { ready = true; break; }
    await sleep(400);
  }
  if (!ready) die("追问发送按钮未启用");
  await clickRect(`${W}?.querySelector('[data-role="follow-up-send"]')`, "追问发送按钮");
  evidence.events.push({ t: Date.now() - startedAt, ev: "follow-up sent", question });
  const done = await aiRoundDone();
  // 材料面板若已展开则直接读；未展开则展开
  let st2 = await evaluate(aiWindowStateExpr);
  if (!st2.materialsVisible) {
    await clickRect(`${W}?.querySelector('[data-role="materials-toggle"]')`, "本次参考了什么入口");
    await waitFor("材料面板展开", async () => (await evaluate(aiWindowStateExpr)).materialsVisible, { timeoutMs: 10000 });
  }
  const final = await evaluate(aiWindowStateExpr);
  if (shotName) await screenshot(shotName);
  return final;
}

async function closeLastWindow() {
  try {
    const before = await evaluate(`document.querySelectorAll("#ai-dock-body .ai-window").length`);
    await clickRect(`${W}?.querySelector('[data-role="close"]')`, "关闭窗口按钮");
    for (let i = 0; i < 20; i++) {
      const n = await evaluate(`document.querySelectorAll("#ai-dock-body .ai-window").length`);
      if (n < before) return;
      await sleep(400);
    }
  } catch { /* 关闭失败不视为步骤失败，证据已落盘 */ }
}

async function selectByKeyboard(selectExpr, targetLabel, what) {
  // 原生 <select> 键盘驱动：点击聚焦（会弹下拉）→ Escape 关闭 → Home 回首项 → ArrowDown 逐项
  // 直到选中目标（change 事件由可信键盘输入原生触发）。失败降级 DOM 赋值＋change 事件（如实记录）。
  const info = await evaluate(`(() => { const s = ${selectExpr}; return { value: s.value, options: [...s.options].map((o) => ({ value: o.value, label: o.label })) }; })()`);
  const target = info.options.find((o) => o.label.includes(targetLabel));
  if (!target) die(`${what} 找不到选项「${targetLabel}」，现有：` + info.options.map((o) => o.label).join("/"));
  const targetIndex = info.options.findIndex((o) => o.value === target.value);
  const key = async (k, code, vk) => {
    await send("Input.dispatchKeyEvent", { type: "keyDown", key: k, code, windowsVirtualKeyCode: vk });
    await send("Input.dispatchKeyEvent", { type: "keyUp", key: k, code, windowsVirtualKeyCode: vk });
    await sleep(150);
  };
  await clickRect(selectExpr, what);
  await key("Escape", "Escape", 27);
  await key("Home", "Home", 36);
  for (let i = 0; i < targetIndex; i++) {
    await key("ArrowDown", "ArrowDown", 40);
    const v = await evaluate(`(${selectExpr}).value`);
    if (v === target.value) break;
  }
  const value = await evaluate(`(${selectExpr}).value`);
  if (value === target.value) {
    evidence.events.push({ ev: "select via keyboard", what, label: target.label });
    return target;
  }
  // 降级：DOM 赋值＋派发 change（如实记录）
  await evaluate(`(() => { const s = ${selectExpr}; s.value = ${JSON.stringify(target.value)}; s.dispatchEvent(new Event("change", { bubbles: true })); return true; })()`);
  evidence.events.push({ ev: "select via DOM fallback", what, label: target.label, note: "键盘驱动未生效，降级 DOM 赋值＋change 事件" });
  return target;
}

// ========== 磁盘证据检查 ==========

function newestFiles(dir, sinceMinutes) {
  const cutoff = Date.now() - sinceMinutes * 60 * 1000;
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json") && !f.endsWith(".meta.json"))
    .map((f) => ({ file: join(dir, f), mtime: statSync(join(dir, f)).mtimeMs }))
    .filter((e) => e.mtime >= cutoff)
    .sort((a, b) => b.mtime - a.mtime);
}

// ========== 步骤实现 ==========

switch (step) {
  case "probe": {
    const st = await evaluate(`(() => ({
      welcome: ${VIS}(document.getElementById("welcome-page")),
      editor: ${VIS}(document.getElementById("editor-page")),
      writing: ${VIS}(document.getElementById("module-writing")),
      making: ${VIS}(document.getElementById("module-making")),
      project: (document.getElementById("current-project-name")?.textContent ?? "").trim(),
      currentDoc: (document.getElementById("current-document-name")?.textContent ?? "").trim(),
      dockWindows: document.querySelectorAll("#ai-dock-body .ai-window").length,
      dockCount: (document.getElementById("ai-dock-count")?.textContent ?? "").trim(),
    }))()`);
    ok(st);
    break;
  }

  case "open-work": {
    evidence.name = "S0-打开作品";
    await waitFor("欢迎页可见", async () => evaluate(`${VIS}(document.getElementById("welcome-page"))`), { timeoutMs: 30000 });
    const entries = await evaluate(`document.querySelectorAll("#recent-works-list .recent-work-item").length`);
    if (!entries) die("最近作品列表为空");
    const firstName = await evaluate(`(document.querySelector("#recent-works-list .recent-work-item .recent-work-name")?.textContent ?? "").trim()`);
    await screenshot("S0-欢迎页");
    await clickRect(`document.querySelector("#recent-works-list .recent-work-item")`, "最近作品第一条");
    const proj = await waitFor("作品打开（编辑页出现）", async () => {
      const p = await evaluate(`(() => (${VIS}(document.getElementById("editor-page")) && !${VIS}(document.getElementById("welcome-page"))) ? (document.getElementById("current-project-name")?.textContent ?? "").trim() : null)()`);
      return p && p.length > 0 ? p : null;
    }, { timeoutMs: 90000 });
    await sleep(1500);
    const doc = await evaluate(`(document.getElementById("current-document-name")?.textContent ?? "").trim()`);
    await screenshot("S0-打开作品");
    ok({ workName: proj, firstName, currentDoc: doc });
    break;
  }

  case "check-config": {
    evidence.name = "S0-设置配置";
    await gotoModule("tab-settings");
    await waitFor("设置页可见", async () => evaluate(`${VIS}(document.getElementById("module-settings"))`), { timeoutMs: 15000 });
    const cfg = await evaluate(`(() => ({
      baseUrl: document.getElementById("api-base-url")?.value ?? "",
      model: document.getElementById("model-name")?.value ?? "",
      maxTokens: document.getElementById("max-tokens")?.value ?? "",
      keyField: document.getElementById("api-key")?.value ?? "",
      saveStatus: (document.getElementById("llm-save-status")?.textContent ?? "").trim(),
    }))()`);
    evidence.captured.config = cfg;
    await screenshot("S0-设置配置");
    await gotoModule("tab-writing");
    if (!cfg.baseUrl || !cfg.model) die(`设置页无已保存配置（baseUrl/model 为空）——按任务要求停下如实报告: ${JSON.stringify(cfg)}`);
    ok(cfg);
    break;
  }

  case "s1-new-chain": {
    evidence.name = "S1-新链路";
    await gotoModule("tab-making");
    await waitFor("制作页可见", async () => evaluate(makingStateExpr).then((s) => s.makingVisible), { timeoutMs: 15000 });
    const st0 = await evaluate(makingStateExpr);
    evidence.captured.initialStatus = { active: st0.statusActive, text: st0.statusText, idleText: st0.statusIdleText };
    if (!st0.newChainBtnVisible) {
      await clickRect(`document.getElementById("making-library-toggle")`, "链路库入口（中等宽度收拢）");
      await sleep(500);
    }
    await clickRect(`document.getElementById("making-new-chain-btn")`, "新建链路按钮");
    await waitFor("新建链路表单出现", async () => evaluate(`${VIS}(document.getElementById("making-new-chain-form"))`), { timeoutMs: 8000 });
    await typeInto(`document.getElementById("making-new-chain-name")`, CHAIN_NAME, "链路名称输入框");
    await clickRect(`document.getElementById("making-new-chain-confirm")`, "创建按钮");
    const st = await waitFor("链路出现在列表并选中", async () => {
      const s = await evaluate(makingStateExpr);
      return s.chainRows.some((r) => r.name === CHAIN_NAME && r.selected) ? s : null;
    }, { timeoutMs: 15000 });
    evidence.captured.chainRows = st.chainRows;
    evidence.captured.inspectorTitle = st.inspectorTitle;
    await screenshot("S1-新链路");
    ok({ chainRows: st.chainRows, inspectorTitle: st.inspectorTitle });
    break;
  }

  case "s1-ask-first":
  case "s1-ask-followup": {
    evidence.name = step === "s1-ask-first" ? "S1-口述首轮" : "S1-澄清补答";
    await gotoModule("tab-making");
    const st0 = await evaluate(makingStateExpr);
    if (!st0.convActive) {
      // 会话可能因刷新回到空态：继续上次会话或开始新制作
      if (st0.convEmpty) {
        await clickRect(`document.getElementById("making-conversation-start-btn")`, "开始新制作");
      } else {
        die("制作对话区状态异常（既无会话也无空态）");
      }
    }
    await waitFor("制作会话输入可用", async () => {
      const s = await evaluate(makingStateExpr);
      return s.convActive && s.inputDisabled === false && s.stopHidden ? s : null;
    }, { timeoutMs: 15000 });
    const text = step === "s1-ask-first" ? REQUIREMENT : REQUIREMENT_FOLLOWUP;
    await typeInto(`document.getElementById("making-conversation-input")`, text, "制作对话输入框");
    let ready = false;
    for (let i = 0; i < 30; i++) {
      const s = await evaluate(makingStateExpr);
      if (s.sendDisabled === false) { ready = true; break; }
      await sleep(400);
    }
    if (!ready) die("制作发送按钮未启用");
    await clickRect(`document.getElementById("making-conversation-send")`, "制作发送按钮");
    evidence.events.push({ t: Date.now() - startedAt, ev: "making message sent", text });
    const done = await makingDone();
    evidence.captured.assistantText = done.lastAssistantText;
    evidence.captured.draftPanels = done.draftPanels;
    evidence.captured.draftCardCount = done.draftCardCount;
    evidence.captured.sessionTitle = done.sessionTitle;
    const hasMarkers = done.lastAssistantText.includes("【卡草稿开始】") && done.lastAssistantText.includes("【卡草稿结束】");
    evidence.assertions.draftMarkersInText = hasMarkers;
    evidence.assertions.draftPanelShown = done.draftPanels > 0 && done.draftCardCount > 0;
    await screenshot(evidence.name);
    if (step === "s1-ask-first" && !evidence.assertions.draftPanelShown) {
      // 助手仅澄清：如实记录并退出码 2（上层再跑澄清补答）
      evidence.assertions.passed = true;
      evidence.events.push({ ev: "助手首轮未出草稿（可能仅澄清），需补答" });
      dumpEvidence();
      console.log(`STEP_OK[${step}] 首轮无草稿，需澄清补答；助手回复开头：` + done.lastAssistantText.slice(0, 200));
      ws.close();
      process.exit(2);
    }
    if (!evidence.assertions.draftPanelShown) die("澄清补答后仍无卡草稿面板（模型未按标记块输出——如实记录为发现）");
    await screenshot("S1-草稿");
    ok({ draftCardCount: done.draftCardCount, assistantPreview: done.lastAssistantText.slice(0, 300) });
    break;
  }

  case "s1-save-draft": {
    evidence.name = "S1-保存草稿";
    await gotoModule("tab-making");
    await waitFor("草稿面板存在", async () => {
      const s = await evaluate(makingStateExpr);
      return s.draftPanels > 0 ? s : null;
    }, { timeoutMs: 10000 });
    await installConfirmOverride();
    await clickRect(
      `[...document.querySelectorAll("#making-session-messages .making-draft-panel .making-draft-actions button")].find((b) => b.textContent.trim() === "保存这版草稿")`,
      "保存这版草稿按钮",
    );
    const st = await waitFor("保存结果提示出现", async () => {
      const s = await evaluate(makingStateExpr);
      return s.notice && (s.notice.includes("已保存为") || s.notice.includes("保存失败")) ? s : null;
    }, { timeoutMs: 20000 });
    evidence.captured.confirmLog = await readConfirmLog();
    evidence.captured.notice = st.notice;
    evidence.captured.chainRows = st.chainRows;
    evidence.captured.inspectorTitle = st.inspectorTitle;
    evidence.captured.inspectorState = st.inspectorState;
    await screenshot("S1-保存草稿");
    if (!st.notice.includes("已保存为")) die("草稿保存失败: " + st.notice);
    ok({ notice: st.notice, confirmText: evidence.captured.confirmLog[0] ?? null });
    break;
  }

  case "s2-enable": {
    evidence.name = "S2-启用";
    await gotoModule("tab-making");
    const st0 = await waitFor("启用按钮可见（检视最新版本）", async () => {
      const s = await evaluate(makingStateExpr);
      return s.enableVisible && s.enableText.includes("启用") ? s : null;
    }, { timeoutMs: 15000 });
    evidence.captured.enableText = st0.enableText;
    evidence.captured.inspectorTitle = st0.inspectorTitle;
    await installConfirmOverride();
    await clickRect(`document.getElementById("making-enable-btn")`, "启用按钮");
    const st = await waitFor("状态条切换为已启用", async () => {
      const s = await evaluate(makingStateExpr);
      return s.statusActive && s.statusText.includes(CHAIN_NAME) ? s : null;
    }, { timeoutMs: 20000 });
    evidence.captured.confirmLog = await readConfirmLog();
    evidence.captured.statusText = st.statusText;
    evidence.captured.deactivateVisible = st.deactivateVisible;
    evidence.captured.inspectorState = st.inspectorState;
    await screenshot("S2-启用");
    if (!st.statusText.includes("第1版")) die("状态条未显示第1版: " + st.statusText);
    ok({ statusText: st.statusText, confirmText: evidence.captured.confirmLog[0] ?? null });
    break;
  }

  case "s3-direct": {
    evidence.name = "S3-装配生效";
    await gotoModule("tab-writing");
    const st = await askDirect(Q1, "S3-提问");
    evidence.captured.doc = st.doc;
    evidence.captured.question = Q1;
    evidence.captured.replyText = st.convText;
    evidence.captured.chainLines = st.chainLines;
    evidence.captured.materialsBody = st.materialsBody;
    evidence.captured.readingRequested = st.readingRequested ?? evidence.captured.readingRequested ?? false;
    await screenshot("S3-链路行");
    const expect = `本轮链路：${CHAIN_NAME}·第1版`;
    if (!st.chainLines.some((l) => l.includes(expect))) {
      die(`材料面板未出现「${expect}」行；chainLines=${JSON.stringify(st.chainLines)}`);
    }
    ok({ chainLines: st.chainLines, replyLength: st.convText.length });
    break;
  }

  case "s4-followup": {
    evidence.name = "S4-适用判别";
    const st = await followUp(Q2, "S4-追问");
    evidence.captured.question = Q2;
    evidence.captured.replyText = st.convText;
    evidence.captured.chainLines = st.chainLines;
    ok({ chainLines: st.chainLines, replyLength: st.convText.length, replyPreview: st.convText.slice(-800) });
    break;
  }

  case "s7-send": {
    evidence.name = "S7-强杀前";
    let st = await evaluate(aiWindowStateExpr);
    if (st.noWindow || !st.followUp) die("S3 讨论窗口不在追问态");
    await typeInto(`${W}?.querySelector('[data-role="follow-up-input"]')`, Q7_KILL, "追问输入框");
    let ready = false;
    for (let i = 0; i < 30; i++) {
      st = await evaluate(aiWindowStateExpr);
      if (st.followUpSendDisabled === false) { ready = true; break; }
      await sleep(400);
    }
    if (!ready) die("追问发送按钮未启用");
    await clickRect(`${W}?.querySelector('[data-role="follow-up-send"]')`, "追问发送按钮");
    evidence.events.push({ t: Date.now() - startedAt, ev: "s7 question sent", question: Q7_KILL });
    // 等流式开始（回复文本出现）即视为在途
    await waitFor("生成在途（流式文本出现或加载态）", async () => {
      const s = await evaluate(aiWindowStateExpr);
      return s.loading || s.stop || (s.convText || "").length > 0 ? s : null;
    }, { timeoutMs: 60000 });
    await sleep(6000); // 让流式多走一段，确保模型轮真正在途
    const st2 = await evaluate(aiWindowStateExpr);
    evidence.captured.inFlight = { loading: st2.loading, stop: st2.stop, textLen: (st2.convText || "").length };
    await screenshot("S7-强杀前");
    ok(evidence.captured.inFlight);
    break;
  }

  case "s7-kill": {
    evidence.name = "S7-强杀驱动";
    // pid 由外层 shell 查出传入（避免嵌套 PowerShell 引号问题）
    const pidArg = Number(process.argv[3] ?? 0);
    if (!pidArg) die("未传入驱动进程 pid（用法: node e2e-driver.mjs s7-kill <pid>）");
    const { execSync } = await import("node:child_process");
    let alive = false;
    try {
      execSync(`powershell -NoProfile -Command "Get-Process -Id ${pidArg} | Out-Null"`);
      alive = true;
    } catch { /* 已不存在 */ }
    if (!alive) die(`pid ${pidArg} 进程不存在（可能已退出或传错）`);
    evidence.captured.killedProcess = { pid: pidArg };
    execSync(`powershell -NoProfile -Command "Stop-Process -Id ${pidArg} -Force"`);
    evidence.events.push({ t: Date.now() - startedAt, ev: "driver killed", pid: pidArg });
    // 等应用自动重启驱动并恢复（窗口出现错误提示或恢复可继续状态）
    let recovered = null;
    const deadline = Date.now() + 180000;
    while (Date.now() < deadline && !recovered) {
      const st = await evaluate(aiWindowStateExpr);
      const settled = st.followUp || (!st.loading && !st.stop);
      if (settled) recovered = st;
      else await sleep(2000);
    }
    evidence.captured.afterKill = recovered
      ? { error: recovered.error, errorText: recovered.errorText, textLen: (recovered.convText || "").length, followUp: recovered.followUp }
      : null;
    await sleep(5000);
    await screenshot("S7-强杀后");
    ok({ killed: pidArg, afterKill: evidence.captured.afterKill });
    break;
  }

  case "s7-recovered": {
    evidence.name = "S7-恢复追问";
    // 崩溃后被杀轮次处于「失败待重试」态（追问输入禁用，产品设计的恢复入口是
    // 「重试」）：先点重试（同问题经恢复路径重发），完成后再正常追问一轮新问题。
    let st = await evaluate(aiWindowStateExpr);
    if (st.noWindow) die("讨论窗口不在");
    const retryVisible = await evaluate(`${VIS}(${W}?.querySelector('[data-role="follow-up-retry"]'))`);
    if (retryVisible) {
      await clickRect(`${W}?.querySelector('[data-role="follow-up-retry"]')`, "追问失败·重试按钮");
      evidence.events.push({ t: Date.now() - startedAt, ev: "retry clicked (killed round)" });
      const done = await aiRoundDone();
      evidence.captured.retryReplyTail = (done.convText || "").slice(-400);
      await sleep(1000);
    } else {
      evidence.events.push({ ev: "无重试按钮（轮次可能已非失败态），直接追问" });
    }
    const st2 = await followUp(Q7_RECOVER, "S7-恢复追问");
    evidence.captured.question = Q7_RECOVER;
    evidence.captured.replyText = st2.convText;
    evidence.captured.chainLines = st2.chainLines;
    await screenshot("S7-链路行仍在");
    const expect = `本轮链路：${CHAIN_NAME}·第1版`;
    if (!st2.chainLines.some((l) => l.includes(expect))) {
      die(`崩溃恢复后追问完成，但「本轮链路」行缺失；chainLines=${JSON.stringify(st2.chainLines)}`);
    }
    ok({ chainLines: st2.chainLines, replyLength: st2.convText.length });
    break;
  }

  case "s5-deactivate": {
    evidence.name = "S5-停用";
    await gotoModule("tab-making");
    const st0 = await waitFor("状态条当前启用", async () => {
      const s = await evaluate(makingStateExpr);
      return s.statusActive && s.statusText.includes(CHAIN_NAME) ? s : null;
    }, { timeoutMs: 15000 });
    evidence.captured.before = st0.statusText;
    await installConfirmOverride();
    await clickRect(`document.getElementById("making-deactivate-btn")`, "停用按钮");
    const st = await waitFor("状态条切换为未启用", async () => {
      const s = await evaluate(makingStateExpr);
      return s.statusIdle && s.statusIdleText.includes("当前未启用链路") ? s : null;
    }, { timeoutMs: 20000 });
    evidence.captured.confirmLog = await readConfirmLog();
    evidence.captured.statusText = st.statusIdleText;
    await screenshot("S5-停用");
    ok({ statusText: st.statusIdleText, confirmText: evidence.captured.confirmLog[0] ?? null });
    break;
  }

  case "s5-direct": {
    evidence.name = "S5-无链路";
    await gotoModule("tab-writing");
    const st = await askDirect(Q3, "S5-新讨论");
    evidence.captured.question = Q3;
    evidence.captured.replyText = st.convText;
    evidence.captured.chainLines = st.chainLines;
    evidence.captured.materialsBody = st.materialsBody;
    await screenshot("S5-无链路行");
    if (st.chainLines.length > 0) die(`停用后新讨论不应出现链路行：${JSON.stringify(st.chainLines)}`);
    await closeLastWindow();
    ok({ chainLines: st.chainLines, materialsPreview: st.materialsBody.slice(0, 300) });
    break;
  }

  case "s6-trial-open": {
    evidence.name = "S6-试问设置";
    await gotoModule("tab-making");
    let st = await evaluate(makingStateExpr);
    if (!st.convActive) {
      // 会话不在打开态：经链路库选中链路→空态「继续上次制作」
      if (!st.newChainBtnVisible && !st.libraryOpen) {
        await clickRect(`document.getElementById("making-library-toggle")`, "链路库入口");
        await sleep(500);
      }
      await clickRect(
        `[...document.querySelectorAll("#making-chain-list .making-chain-row")].find((b) => b.querySelector(".making-chain-row-name")?.textContent.trim() === "${CHAIN_NAME}")`,
        "链路行",
      );
      await sleep(500);
      await waitFor("继续上次制作入口出现", async () => evaluate(`${VIS}(document.querySelector("#making-conversation-recent .making-recent-continue"))`), { timeoutMs: 10000 });
      await clickRect(`document.querySelector("#making-conversation-recent .making-recent-continue")`, "继续上次制作");
      await waitFor("制作会话打开", async () => {
        const s = await evaluate(makingStateExpr);
        return s.convActive && s.draftPanels > 0 ? s : null;
      }, { timeoutMs: 15000 });
      st = await evaluate(makingStateExpr);
    }
    if (st.draftPanels === 0) die("制作会话打开但无草稿面板");
    await clickRect(
      `[...document.querySelectorAll("#making-session-messages .making-draft-panel .making-draft-actions button")].find((b) => b.textContent.trim() === "开始试问")`,
      "开始试问按钮",
    );
    const panel = await waitFor("试问设置面板出现", async () => {
      const s = await evaluate(makingStateExpr);
      return s.trialPanel && s.trialForm ? s : null;
    }, { timeoutMs: 15000 });
    evidence.captured.trialMeta = panel.trialMeta;
    // 关注文档选主角篇（键盘驱动原生 select）
    await selectByKeyboard(`document.getElementById("making-trial-focus")`, "主角篇", "试问关注文档");
    await typeInto(`document.getElementById("making-trial-question")`, Q1, "试问问题输入框");
    let ready = false;
    for (let i = 0; i < 30; i++) {
      const s = await evaluate(`document.getElementById("making-trial-start")?.disabled`);
      if (s === false) { ready = true; break; }
      await sleep(400);
    }
    if (!ready) die("开始试用按钮未启用");
    const focusLabel = await evaluate(`document.getElementById("making-trial-focus").selectedOptions[0]?.label ?? ""`);
    evidence.captured.focusDocument = focusLabel;
    await screenshot("S6-试问设置");
    ok({ trialMeta: panel.trialMeta, focusDocument: focusLabel, question: Q1 });
    break;
  }

  case "s6-trial-run": {
    evidence.name = "S6-试问带卡";
    await waitFor("开始试用可用", async () => evaluate(`document.getElementById("making-trial-start")?.disabled === false`), { timeoutMs: 10000 });
    await clickRect(`document.getElementById("making-trial-start")`, "开始试用按钮");
    // 等第一个试问块完成（含补读授权代点）
    const done = await waitFor("带卡试问完成", async () => {
      const s = await evaluate(makingStateExpr);
      if (!s.trialBlocks.length) return null;
      const b = s.trialBlocks[0];
      if (b.status.startsWith("生成失败")) return { fail: b.status };
      if (b.status === "已完成") return s;
      return null;
    }, { timeoutMs: 300000, intervalMs: 2000 });
    if (done.fail) die("带卡试问失败: " + done.fail);
    // 授权卡若出现，代点允许（记录）
    evidence.captured.trialBlocks = done.trialBlocks.map((b) => ({ kind: b.kind, status: b.status, question: b.question, replyLen: b.reply.length, hasAuth: b.hasAuth }));
    evidence.captured.replyText = done.trialBlocks[0].reply;
    evidence.captured.trialRunMeta = done.trialRunMeta;
    await sleep(1500);
    await screenshot("S6-试问带卡");
    ok({ status: done.trialBlocks[0].status, replyLength: done.trialBlocks[0].reply.length });
    break;
  }

  case "s6-trial-compare": {
    evidence.name = "S6-对照";
    await waitFor("对照按钮可用", async () => {
      const s = await evaluate(makingStateExpr);
      const b = s.trialBlocks[0];
      return b && b.status === "已完成" && b.hasCompare && !s.trialBlocks.some((x) => x.kind.includes("对照")) ? true : null;
    }, { timeoutMs: 15000 });
    await clickRect(`document.querySelector("#making-trial-runs .making-trial-block .making-trial-block-actions .making-mini-btn")`, "跑不带卡对照按钮");
    const done = await waitFor("对照试问完成", async () => {
      const s = await evaluate(makingStateExpr);
      if (s.trialBlocks.length < 2) return null;
      const b = s.trialBlocks[1];
      if (b.status.startsWith("生成失败")) return { fail: b.status };
      if (b.status === "已完成") return s;
      return null;
    }, { timeoutMs: 300000, intervalMs: 2000 });
    if (done.fail) die("对照试问失败: " + done.fail);
    evidence.captured.trialBlocks = done.trialBlocks.map((b) => ({ kind: b.kind, status: b.status, replyLen: b.reply.length }));
    evidence.captured.replyWithCard = done.trialBlocks[0].reply;
    evidence.captured.replyWithoutCard = done.trialBlocks[1].reply;
    await screenshot("S6-对照");
    ok({ blocks: evidence.captured.trialBlocks });
    break;
  }

  case "s6-inspector-records": {
    evidence.name = "S6-试问记录";
    await gotoModule("tab-making");
    // 打开链路库（若收拢）选中链路→点第一张卡展开检视面板
    let st = await evaluate(makingStateExpr);
    if (!st.newChainBtnVisible && !st.libraryOpen) {
      await clickRect(`document.getElementById("making-library-toggle")`, "链路库入口");
      await sleep(500);
    }
    await clickRect(
      `[...document.querySelectorAll("#making-chain-list .making-chain-row")].find((b) => b.querySelector(".making-chain-row-name")?.textContent.trim() === "${CHAIN_NAME}")`,
      "链路行",
    );
    await sleep(600);
    await clickRect(`document.querySelector("#making-card-list .making-card-row")`, "卡片行");
    const done = await waitFor("试问记录两条出现", async () => {
      const s = await evaluate(makingStateExpr);
      return s.cardPanelVisible && s.trialRecordRows >= 2 ? s : null;
    }, { timeoutMs: 20000 });
    evidence.captured.trialRecordsSummary = done.trialRecordsSummary;
    evidence.captured.trialRecordTexts = done.trialRecordTexts;
    evidence.captured.inspectorTitle = done.inspectorTitle;
    await screenshot("S6-试问记录");
    ok({ rows: done.trialRecordRows, summary: done.trialRecordsSummary });
    break;
  }

  case "check-archive-chain":
  case "check-archive-nochain": {
    const wantChain = step === "check-archive-chain";
    evidence.name = wantChain ? "S3-档案断言" : "S5-档案断言";
    const files = newestFiles(WORK_CONVERSATIONS, 240);
    if (files.length === 0) die("讨论目录近期无新档案");
    const read = files.map((f) => {
      const rec = JSON.parse(readFileSync(f.file, "utf8"));
      return {
        file: f.file.split("\\").pop(),
        mtime: new Date(f.mtime).toISOString(),
        conversation_id: rec.conversation_id,
        focus_document_title: rec.focus_document_title,
        turns: (rec.turns ?? []).map((t) => t.role),
        firstUserText: (rec.turns ?? []).find((t) => t.role === "user")?.text?.slice(0, 60) ?? "",
        chain_rounds: rec.chain_rounds ?? null,
      };
    });
    evidence.captured.archives = read;
    const newest = read[0];
    if (wantChain) {
      const withChain = read.filter((r) => Array.isArray(r.chain_rounds) && r.chain_rounds.length > 0);
      const hit = withChain.find((r) => r.chain_rounds.some((c) => c.chain_name === CHAIN_NAME && c.version_index === 1));
      if (!hit) die(`未找到 chain_rounds 记录 {chain_name:${CHAIN_NAME}, version_index:1}；档案=${JSON.stringify(read.map((r) => ({ f: r.file, cr: r.chain_rounds })))}`);
      const entry = hit.chain_rounds.find((c) => c.chain_name === CHAIN_NAME);
      evidence.captured.asserted = { file: hit.file, entry };
      if (!entry.chain_id || typeof entry.turn_index !== "number") die("chain_rounds 条目缺 chain_id/turn_index: " + JSON.stringify(entry));
      ok({ file: hit.file, entry });
    } else {
      if (Array.isArray(newest.chain_rounds) && newest.chain_rounds.length > 0) {
        die(`停用后新讨论档案不应有 chain_rounds 条目：${newest.file} → ${JSON.stringify(newest.chain_rounds)}`);
      }
      evidence.captured.asserted = { file: newest.file, chain_rounds: newest.chain_rounds };
      ok({ file: newest.file, firstUserText: newest.firstUserText });
    }
    break;
  }

  case "check-making-archives": {
    evidence.name = "S1-制作档案与链路库断言";
    const convDir = join(MAKING_DIR, "conversations");
    const convFiles = newestFiles(convDir, 240);
    const convs = convFiles.map((f) => {
      const rec = JSON.parse(readFileSync(f.file, "utf8"));
      return {
        file: f.file.split("\\").pop(),
        chain_id: rec.chain_id,
        title: rec.title,
        turns: (rec.turns ?? []).map((t) => `${t.role}:${t.status}`),
        lastAssistantHasMarkers: (rec.turns ?? []).filter((t) => t.role === "assistant").some((t) => (t.text ?? "").includes("【卡草稿开始】")),
      };
    });
    const chains = JSON.parse(readFileSync(join(MAKING_DIR, "chains.json"), "utf8"));
    const chain = chains.chains.find((c) => c.name === CHAIN_NAME);
    evidence.captured.makingConversations = convs;
    evidence.captured.chain = chain && {
      id: chain.id,
      versions: chain.versions.map((v) => ({ index: v.index, cards: v.cards.length, trials: v.trials.length })),
      active: chains.active,
    };
    if (!chain || chain.versions.length < 1) die("链路库未找到「装配验证链」或无版本");
    const conv = convs.find((c) => c.chain_id === chain.id && c.lastAssistantHasMarkers);
    if (!conv) die("制作会话档案未找到含标记块的助手轮");
    ok({ conversationFile: conv.file, chain: evidence.captured.chain });
    break;
  }

  case "check-trials": {
    evidence.name = "S6-TrialRecord断言";
    const trialDir = join(MAKING_DIR, "trials");
    const files = newestFiles(trialDir, 240);
    const trials = files.map((f) => {
      const rec = JSON.parse(readFileSync(f.file, "utf8"));
      return {
        file: f.file.split("\\").pop(),
        id: rec.id,
        chain_name: rec.chain_name,
        version_index: rec.version_index,
        with_card: rec.with_card,
        question: rec.question,
        reply_len: (rec.reply_text ?? "").length,
        status: rec.status,
        work_title: rec.work_title,
        focus_document_title: rec.focus_document_title,
      };
    });
    evidence.captured.trials = trials;
    const withCard = trials.find((t) => t.with_card === true);
    const withoutCard = trials.find((t) => t.with_card === false);
    if (!withCard) die("未找到带卡 TrialRecord（with_card=true）");
    if (withCard.reply_len === 0 || withCard.status !== "success") die("带卡试问记录无回复全文或状态非 success: " + JSON.stringify(withCard));
    if (!withoutCard) die("未找到对照 TrialRecord（with_card=false）");
    if (withCard.chain_name !== CHAIN_NAME || withCard.version_index !== 1) die("TrialRecord 链路标识不符: " + JSON.stringify(withCard));
    ok({ withCard: withCard.file, withoutCard: withoutCard.file });
    break;
  }

  case "close-window": {
    await closeLastWindow();
    evidence.name = "housekeeping-关窗";
    ok({ closed: true });
    break;
  }

  case "shot": {
    const name = process.argv[3] ?? "manual";
    evidence.name = `shot-${name}`;
    await screenshot(name);
    ok({ name });
    break;
  }

  default:
    console.error(`未知步骤: ${step}`);
    ws.close();
    process.exit(2);
}
