// e2e-s8-s9.mjs — add-making-module-core 任务 5.5 补充验证（S8 反馈改卡、S9 日常转介）
//
// 复用本目录 e2e-driver.mjs 的启动与驱动模式（2026-10-06 已验证可行）：
// - 应用以 `npm run tauri:dev` + WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9223 启动；
// - 本脚本经 CDP WebSocket 连 Next Story 页面目标；
// - 点击＝真实鼠标事件（Input.dispatchMouseEvent：moved→pressed→released）；
// - 文本＝Input.insertText（IME 类提交，项目验收既有通道）；
// - DOM 查询只走 Runtime.evaluate 只读（确认对话框改道除外）；
// - 视觉证据＝Page.captureScreenshot 存 PNG；每步另存 JSON 断言证据；
// - 原生确认对话框（Tauri 插件原生弹窗）按 2026-09-22 app-real-chain-validation C4
//   先例改道 devtools 通道：覆写 globalThis.confirm，捕获确认文案全文并返回 true。
//
// 场景（任务 5.5 未实测两项；模型轮次预算：S8 一轮＋S9 一轮＝2 轮 ≤4）：
// - S8 反馈改卡：打开「装配验证链」既有制作会话（继续上次）→ 发送反馈
//   （「把正文压成一行以内，其他保持不变。」——任务书例文引用的「检验角度」一节
//   在实际卡正文里不存在（实际正文为「情节讨论中，多从反差与反转的角度进行探索。……」），
//   故按例文意图（压短正文、其余不动）适配为整段正文压缩，如实记录）→ 等流式完成 →
//   断言标记块＋修订对应反馈 → 保存这版草稿 → 确认 → 磁盘断言第2版追加、旧第1版逐字不变；
// - S9 日常转介：写作页 AI 面板新讨论 → 提问「帮我把装配验证链里的那张卡改成只在情节问题时使用」→
//   等完成 → 硬性断言 chains.json 与发起前逐字一致；回复全文如实入证（转介措辞为行为观察）。
//
// 用法：node e2e-s8-s9.mjs <step>（s8-open-session | s8-feedback | s8-save | s9-daily-referral | probe）

import { writeFileSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const BASE = "http://127.0.0.1:9223";
const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "8.2-e2e");

const APP_DATA = "C:\\Users\\Administrator\\AppData\\Local\\com.nextstory.desktop";
const MAKING_DIR = join(APP_DATA, "making-module");
const CHAINS_PATH = join(MAKING_DIR, "chains.json");
const CHAIN_NAME = "装配验证链";

// S8 反馈（例文「检验角度」在实际卡正文中不存在，按意图适配为整段正文压缩；见文件头说明）
const S8_FEEDBACK = "把正文压成一行以内，其他保持不变。";
// S9 日常转介提问（任务书给定）
const S9_QUESTION = "帮我把装配验证链里的那张卡改成只在情节问题时使用";

// ========== CDP 连接与基础设施（沿 e2e-driver.mjs） ==========

const step = process.argv[2] ?? "";
if (!step) {
  console.error("用法: node e2e-s8-s9.mjs <step>");
  process.exit(2);
}

const consoleErrors = [];
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

const VIS = `((el) => !!el && !el.classList.contains("hidden") && !el.hidden && el.getBoundingClientRect().width > 0)`;

async function installConfirmOverride() {
  await evaluate(`(() => { window.__confirmLog = []; globalThis.confirm = (msg) => { window.__confirmLog.push(String(msg)); return Promise.resolve(true); }; return true; })()`);
}
async function readConfirmLog() {
  return (await evaluate(`window.__confirmLog ?? []`)) ?? [];
}

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

// ========== 页面状态探针（只读，沿 e2e-driver.mjs） ==========

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
    convActive: vis(byId("making-conversation-active")),
    convEmpty: vis(byId("making-conversation-empty")),
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
    lastDraftPanelCards: (() => { const panels = [...document.querySelectorAll("#making-session-messages .making-draft-panel")]; if (!panels.length) return []; const p = panels[panels.length - 1]; return [...p.querySelectorAll(".making-draft-card")].map((c) => ({ title: c.querySelector(".making-draft-line:nth-child(1) .making-draft-label + span")?.textContent ?? "", lines: [...c.querySelectorAll(".making-draft-line")].map((l) => l.textContent.trim()), body: c.querySelector(".making-draft-body")?.textContent ?? "" })); })(),
  };
})()`;

async function makingDone(deadlineNoProgressMs = 200000, hardCapMs = 420000) {
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
    await sleep(2000);
    return await evaluate(makingStateExpr);
  }
}

async function aiRoundDone(deadlineNoProgressMs = 200000, hardCapMs = 420000) {
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

// ========== 组合动作（沿 e2e-driver.mjs） ==========

async function gotoModule(tab) {
  await clickRect(`document.getElementById("${tab}")`, `页签 ${tab}`);
  await sleep(600);
}

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
      die("找不到「新建对话」入口（停靠区展开失败）");
    }
  }
  await clickRect(`document.getElementById("ai-new-conversation")`, "新建对话按钮");
}

async function askDirect(question, shotName) {
  const existing = await evaluate(aiWindowStateExpr);
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
  if (st.doc && st.doc.length > 0 && !st.doc.includes("主角篇")) {
    // 与 e2e-driver.mjs 相同：已有绑定但非主角篇时显式切换；无绑定时发送后核对
    await clickRect(`${W}?.querySelector('[data-role="focus-switch"]')`, "切换关注文档入口");
    await waitFor("关注文档菜单出现", async () => evaluate(`!!document.querySelector("body > .ai-menu")`), { timeoutMs: 8000 });
    await clickRect(
      `[...document.querySelectorAll("body > .ai-menu button")].find((b) => (b.textContent || "").trim().startsWith("主角篇"))`,
      `菜单项 主角篇`,
    );
    await waitFor("关注文档切换生效", async () => {
      const s = await evaluate(aiWindowStateExpr);
      return s.doc.includes("主角篇") ? s.doc : null;
    }, { timeoutMs: 15000 });
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
  await clickRect(`${W}?.querySelector('[data-role="materials-toggle"]')`, "本次参考了什么入口");
  const final = await waitFor("材料面板展开", async () => {
    const s = await evaluate(aiWindowStateExpr);
    return s.materialsVisible ? s : null;
  }, { timeoutMs: 10000 });
  if (!final.doc.includes("主角篇")) die(`首轮完成后关注文档不是主角篇：doc=${final.doc}`);
  if (shotName) await screenshot(shotName);
  return final;
}

// ========== 卡草稿解析（逐字移植 src/making/making-conversation.ts parseCardDrafts，只读断言用） ==========

function parseCardDrafts(text) {
  const drafts = [];
  const lines = text.split(/\r?\n/);
  let inBlock = false;
  let current = null;
  const appendToLast = (line) => {
    if (current === null || current.last === null) return;
    current[current.last] = current[current.last].length === 0 ? line : `${current[current.last]}\n${line}`;
  };
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line === "【卡草稿开始】") {
      current = { title: "", whenToUse: "", whenNotToUse: "", body: "", last: null };
      inBlock = true;
      continue;
    }
    if (!inBlock || current === null) continue;
    if (line === "【卡草稿结束】") {
      if (current.title.trim().length > 0 && current.body.trim().length > 0) {
        drafts.push({
          title: current.title.trim(),
          whenToUse: current.whenToUse.trim(),
          whenNotToUse: current.whenNotToUse.trim(),
          body: current.body.trim(),
        });
      }
      current = null;
      inBlock = false;
      continue;
    }
    const match = /^(卡名|何时用|何时不用|正文)[：:](.*)$/.exec(line);
    if (match === null) { appendToLast(line); continue; }
    const value = match[2].trim();
    switch (match[1]) {
      case "卡名": current.title = value; current.last = "title"; break;
      case "何时用": current.whenToUse = value; current.last = "whenToUse"; break;
      case "何时不用": current.whenNotToUse = value; current.last = "whenNotToUse"; break;
      default: current.body = value; current.last = "body"; break;
    }
  }
  return drafts;
}

// 从 chains.json 版本卡还原 {title, whenToUse, whenNotToUse, body}（trigger_desc＝适用/不适用两行）
function cardFromChainVersion(v) {
  const card = v.cards[0];
  let when = "";
  let whenNot = "";
  for (const l of (card.trigger_desc ?? "").split(/\r?\n/)) {
    if (l.startsWith("适用：")) when = l.slice("适用：".length).trim();
    else if (l.startsWith("不适用：")) whenNot = l.slice("不适用：".length).trim();
  }
  return { title: card.title, whenToUse: when, whenNotToUse: whenNot, body: card.body };
}

const sha256 = (s) => createHash("sha256").update(s, "utf8").digest("hex");

function readChainState() {
  const raw = readFileSync(CHAINS_PATH, "utf8");
  const parsed = JSON.parse(raw);
  const chain = parsed.chains.find((c) => c.name === CHAIN_NAME);
  return { raw, parsed, chain };
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
    }))()`);
    ok(st);
    break;
  }

  case "s8-open-session": {
    evidence.name = "S8-继续会话";
    // 打开任务书指定测试作品「统一真机验收-20260926」（显示名「8b 验证作品」）：
    // 欢迎页时在最近列表按名称匹配（最近第一条当前是另一作品「统一真机验收-20261001」，
    // 上轮脚本按第一条点击会打开错误作品——驱动修正，如实记录）；已打开其他作品时先返回欢迎页。
    const WORK_TITLE = "8b 验证作品";
    const openedName = await evaluate(`(${VIS}(document.getElementById("editor-page")) && !${VIS}(document.getElementById("welcome-page"))) ? ((document.getElementById("current-project-name")?.textContent ?? "").trim()) : ""`);
    if (openedName && openedName !== WORK_TITLE) {
      await clickRect(`document.getElementById("btn-back-welcome")`, "返回欢迎页按钮");
      await waitFor("欢迎页出现", async () => evaluate(`${VIS}(document.getElementById("welcome-page"))`), { timeoutMs: 15000 });
    }
    const welcome = await evaluate(`${VIS}(document.getElementById("welcome-page"))`);
    if (welcome) {
      const idx = await evaluate(`[...document.querySelectorAll("#recent-works-list .recent-work-item")].findIndex((b) => ((b.querySelector(".recent-work-name")?.textContent ?? "").trim() === "${WORK_TITLE}"))`);
      if (idx === -1) {
        const names = await evaluate(`[...document.querySelectorAll("#recent-works-list .recent-work-item .recent-work-name")].map((n) => (n.textContent ?? "").trim())`);
        die(`最近列表找不到作品「${WORK_TITLE}」，现有：` + JSON.stringify(names));
      }
      evidence.captured.openedWork = WORK_TITLE;
      await clickRect(`document.querySelectorAll("#recent-works-list .recent-work-item")[${idx}]`, `最近作品·${WORK_TITLE}`);
      await waitFor("作品打开（编辑页出现）", async () => {
        const p = await evaluate(`(() => (${VIS}(document.getElementById("editor-page")) && !${VIS}(document.getElementById("welcome-page"))) ? (document.getElementById("current-project-name")?.textContent ?? "").trim() : null)()`);
        return p === WORK_TITLE ? p : null;
      }, { timeoutMs: 90000 });
      await sleep(1500);
    }
    // 制作页 → 打开「装配验证链」既有制作会话（继续上次）
    await gotoModule("tab-making");
    let st = await waitFor("制作页可见", async () => evaluate(makingStateExpr).then((s) => s.makingVisible), { timeoutMs: 15000 });
    // 会话区（活跃会话或空态）异步渲染：先等任一出现，再走分支（驱动修正，如实记录）
    st = await waitFor("制作会话区渲染（会话或空态）", async () => {
      const s = await evaluate(makingStateExpr);
      return s.convActive || s.convEmpty ? s : null;
    }, { timeoutMs: 20000 });
    if (!st.convActive) {
      if (!st.convEmpty) die("制作对话区状态异常（既无会话也无空态）");
      if (!st.newChainBtnVisible && !st.libraryOpen) {
        await clickRect(`document.getElementById("making-library-toggle")`, "链路库入口（中等宽度收拢）");
        await sleep(500);
      }
      await clickRect(
        `[...document.querySelectorAll("#making-chain-list .making-chain-row")].find((b) => b.querySelector(".making-chain-row-name")?.textContent.trim() === "${CHAIN_NAME}")`,
        "链路行",
      );
      await sleep(500);
      await waitFor("继续上次制作入口出现", async () => evaluate(`${VIS}(document.querySelector("#making-conversation-recent .making-recent-continue"))`), { timeoutMs: 10000 });
      await clickRect(`document.querySelector("#making-conversation-recent .making-recent-continue")`, "继续上次制作");
    }
    st = await waitFor("制作会话打开且输入可用", async () => {
      const s = await evaluate(makingStateExpr);
      return s.convActive && s.inputDisabled === false && s.stopHidden ? s : null;
    }, { timeoutMs: 15000 });
    evidence.captured.sessionTitle = st.sessionTitle;
    evidence.captured.draftPanelsFromHistory = st.draftPanels;
    evidence.captured.chainStatusIdle = st.statusIdleText;
    // 磁盘基线：改卡前 chains.json 快照（S8 全程的「旧第1版」对照基准）
    const before = readChainState();
    writeFileSync(join(OUT, "S8-改卡前chains快照.json"), before.raw);
    const v1 = before.chain?.versions.find((v) => v.index === 1);
    evidence.captured.chainsBefore = {
      sha256: sha256(before.raw),
      versions: before.chain?.versions.map((v) => ({ index: v.index, cards: v.cards.length, trials: v.trials.length })) ?? null,
      active: before.parsed.active,
      v1Card: v1 ? cardFromChainVersion(v1) : null,
    };
    await screenshot("S8-继续会话");
    if (!v1) die("chains.json 中「装配验证链」无第1版（前置状态不符）");
    if (st.draftPanels < 1) die("会话打开后历史轮未渲染草稿面板（预期≥1，来自第1版草稿轮）");
    ok({ sessionTitle: st.sessionTitle, draftPanels: st.draftPanels, versionsBefore: evidence.captured.chainsBefore.versions });
    break;
  }

  case "s8-feedback": {
    evidence.name = "S8-反馈改卡";
    await gotoModule("tab-making");
    let st = await waitFor("制作会话打开且输入可用", async () => {
      const s = await evaluate(makingStateExpr);
      return s.convActive && s.inputDisabled === false && s.stopHidden ? s : null;
    }, { timeoutMs: 15000 });
    const panelsBefore = st.draftPanels;
    await typeInto(`document.getElementById("making-conversation-input")`, S8_FEEDBACK, "制作对话输入框");
    let ready = false;
    for (let i = 0; i < 30; i++) {
      const s = await evaluate(makingStateExpr);
      if (s.sendDisabled === false) { ready = true; break; }
      await sleep(400);
    }
    if (!ready) die("制作发送按钮未启用");
    await clickRect(`document.getElementById("making-conversation-send")`, "制作发送按钮");
    evidence.events.push({ t: Date.now() - startedAt, ev: "making feedback sent", text: S8_FEEDBACK });
    const done = await makingDone();
    evidence.captured.feedback = S8_FEEDBACK;
    evidence.captured.assistantText = done.lastAssistantText;
    evidence.captured.draftPanels = done.draftPanels;
    evidence.captured.draftCardCount = done.draftCardCount;
    await screenshot("S8-反馈改卡");
    // 断言 1：标记块存在
    const hasMarkers = done.lastAssistantText.includes("【卡草稿开始】") && done.lastAssistantText.includes("【卡草稿结束】");
    evidence.assertions.draftMarkersInText = hasMarkers;
    if (!hasMarkers) die("回应不含【卡草稿开始】…【卡草稿结束】标记块（模型未按信封出修订草稿）");
    // 断言 2：修订对应反馈——正文压成一行以内（无换行且短于第1版正文），其余字段与第1版一致
    const before = JSON.parse(readFileSync(join(OUT, "S8-改卡前chains快照.json"), "utf8"));
    const v1Card = cardFromChainVersion(before.chains.find((c) => c.name === CHAIN_NAME).versions.find((v) => v.index === 1));
    const drafts = parseCardDrafts(done.lastAssistantText);
    evidence.captured.parsedDrafts = drafts;
    evidence.captured.v1Card = v1Card;
    if (drafts.length === 0) die("标记块存在但解析不出完整草稿（缺字段）");
    const d = drafts[drafts.length - 1];
    const bodyOneLine = !d.body.includes("\n");
    const bodyShorter = d.body.length < v1Card.body.length;
    const othersUnchanged = d.title === v1Card.title && d.whenToUse === v1Card.whenToUse && d.whenNotToUse === v1Card.whenNotToUse;
    evidence.assertions.bodyCompressedToOneLine = bodyOneLine;
    evidence.assertions.bodyShorterThanV1 = bodyShorter;
    evidence.assertions.otherFieldsUnchanged = othersUnchanged;
    evidence.assertions.newDraftPanelShown = done.draftPanels === panelsBefore + 1;
    // 溯源观察：回应叙述是否对应反馈（提及「一行」类措辞）——行为观察，如实记录
    evidence.assertions.replyMentionsOneLine = done.lastAssistantText.includes("一行");
    if (!bodyOneLine || !bodyShorter || !othersUnchanged) {
      die(`修订未对应反馈：oneLine=${bodyOneLine} shorter=${bodyShorter} othersUnchanged=${othersUnchanged}；新正文=「${d.body}」`);
    }
    if (!evidence.assertions.newDraftPanelShown) die(`草稿面板数未按预期+1（before=${panelsBefore}, after=${done.draftPanels}）`);
    ok({
      newBody: d.body,
      v1BodyLen: v1Card.body.length,
      newBodyLen: d.body.length,
      replyMentionsOneLine: evidence.assertions.replyMentionsOneLine,
    });
    break;
  }

  case "s8-save": {
    evidence.name = "S8-保存第2版";
    await gotoModule("tab-making");
    const st0 = await waitFor("草稿面板存在（≥2：第1版历史＋新草稿）", async () => {
      const s = await evaluate(makingStateExpr);
      return s.draftPanels >= 2 ? s : null;
    }, { timeoutMs: 10000 });
    // 保存前快照（与改卡前快照一致性亦断言：模型轮不写 chains.json）
    const preSave = readChainState();
    const preRound = JSON.parse(readFileSync(join(OUT, "S8-改卡前chains快照.json"), "utf8"));
    evidence.assertions.chainsUnchangedDuringRound = preSave.raw === preRound.raw;
    await installConfirmOverride();
    await clickRect(
      `[...document.querySelectorAll("#making-session-messages .making-draft-panel")].at(-1)?.querySelector('.making-draft-actions button') && [...[...document.querySelectorAll("#making-session-messages .making-draft-panel")].at(-1).querySelectorAll(".making-draft-actions button")].find((b) => b.textContent.trim() === "保存这版草稿")`,
      "保存这版草稿按钮（最后一个草稿面板）",
    );
    const st = await waitFor("保存结果提示出现（第2版）", async () => {
      const s = await evaluate(makingStateExpr);
      return s.notice && s.notice.includes("已保存为") && s.notice.includes("第2版") ? s : null;
    }, { timeoutMs: 20000 });
    evidence.captured.confirmLog = await readConfirmLog();
    evidence.captured.notice = st.notice;
    await sleep(2000); // 落盘余量
    // 磁盘断言：第2版追加、旧第1版逐字不变
    const after = readChainState();
    writeFileSync(join(OUT, "S8-保存后chains.json"), after.raw);
    const chain = after.chain;
    const versions = chain?.versions ?? [];
    const v1After = versions.find((v) => v.index === 1);
    const v2After = versions.find((v) => v.index === 2);
    const v1Before = preRound.chains.find((c) => c.name === CHAIN_NAME).versions.find((v) => v.index === 1);
    evidence.assertions.versionsAppended = versions.length === preRound.chains.find((c) => c.name === CHAIN_NAME).versions.length + 1;
    evidence.assertions.v2Index = v2After ? v2After.index : null;
    evidence.assertions.v1DeepEqual = v1After ? isDeepStrictEqual(v1After, v1Before) : false;
    evidence.captured.chainsAfter = {
      sha256: sha256(after.raw),
      versions: versions.map((v) => ({ index: v.index, cards: v.cards.length, trials: v.trials.length, change_note: v.change_note })),
      active: after.parsed.active,
      v1Card: v1After ? cardFromChainVersion(v1After) : null,
      v2Card: v2After ? cardFromChainVersion(v2After) : null,
    };
    await screenshot("S8-保存第2版");
    if (!evidence.assertions.versionsAppended) die(`versions 长度未+1：${versions.length}`);
    if (!v2After || v2After.index !== 2) die("新版本 index≠2: " + JSON.stringify(versions.map((v) => v.index)));
    if (!evidence.assertions.v1DeepEqual) die("旧第1版在保存后发生变化（应逐字不变）");
    if (!v2After.cards.length) die("第2版无卡");
    if (v2After.cards[0].body === v1After.cards[0].body) die("第2版正文与第1版相同（未体现修订）");
    ok({
      notice: st.notice,
      confirmText: evidence.captured.confirmLog[0] ?? null,
      versions: evidence.captured.chainsAfter.versions,
      v1DeepEqual: evidence.assertions.v1DeepEqual,
    });
    break;
  }

  case "s8-defect-evidence": {
    // 只读取证：s8-open-session 发现「继续上次制作」失败（前端 makingConversationLoad
    // 传 { id }，后端命令要求 conversationId，参数校验拒绝），UI 停在失败现场——
    // 拍下 notice 文本＋空态状态＋磁盘基线，作为 S8 不可执行的缺陷证据。
    evidence.name = "S8-重开缺陷现场";
    const st = await waitFor("制作页可见", async () => evaluate(makingStateExpr).then((s) => s.makingVisible), { timeoutMs: 15000 });
    const st2 = await evaluate(makingStateExpr);
    evidence.captured.ui = {
      convActive: st2.convActive,
      convEmpty: st2.convEmpty,
      sessionTitle: st2.sessionTitle,
      notice: st2.notice,
      inputDisabled: st2.inputDisabled,
      inspectorTitle: st2.inspectorTitle,
      statusIdleText: st2.statusIdleText,
      chainRows: st2.chainRows,
    };
    const before = readChainState();
    writeFileSync(join(OUT, "S8-改卡前chains快照.json"), before.raw);
    evidence.captured.chainsBefore = {
      sha256: sha256(before.raw),
      versions: before.chain?.versions.map((v) => ({ index: v.index, cards: v.cards.length, trials: v.trials.length })) ?? null,
      active: before.parsed.active,
    };
    await screenshot("S8-重开缺陷现场");
    const defectConfirmed = typeof st2.notice === "string" && st2.notice.includes("making_conversation_load") && st2.notice.includes("conversationId");
    evidence.assertions.defectConfirmed = defectConfirmed;
    if (!defectConfirmed) die("缺陷现场与预期不符（notice 未含 making_conversation_load 参数错误），需人工复核: " + (st2.notice ?? ""));
    ok({ notice: st2.notice, versionsBefore: evidence.captured.chainsBefore.versions });
    break;
  }

  case "s9-daily-referral": {
    evidence.name = "S9-日常转介";
    // 发起前快照（硬性断言基准）
    const before = readChainState();
    writeFileSync(join(OUT, "S9-提问前chains快照.json"), before.raw);
    evidence.captured.chainsBefore = {
      sha256: sha256(before.raw),
      length: before.raw.length,
      versions: before.chain?.versions.map((v) => ({ index: v.index, cards: v.cards.length })) ?? null,
      active: before.parsed.active,
    };
    await gotoModule("tab-writing");
    const st = await askDirect(S9_QUESTION, "S9-日常提问");
    evidence.captured.question = S9_QUESTION;
    evidence.captured.replyText = st.convText;
    evidence.captured.chainLines = st.chainLines;
    evidence.captured.materialsPreview = (st.materialsBody || "").slice(0, 400);
    await sleep(3000); // 轮后落盘余量
    // 硬性断言：chains.json 与发起前逐字一致
    const after = readChainState();
    const identical = after.raw === before.raw;
    evidence.assertions.chainsJsonByteIdentical = identical;
    evidence.captured.chainsAfter = { sha256: sha256(after.raw), length: after.raw.length };
    // 行为观察（如实记录，不判失败）：是否拒绝代改／是否转介制作模块·制作对话
    const reply = st.convText || "";
    evidence.captured.observation = {
      mentionsMakingModule: /制作(模块|页|对话|会话)/.test(reply),
      mentionsChainName: reply.includes(CHAIN_NAME),
      replyPreview: reply.slice(0, 500),
      replyTail: reply.slice(-500),
    };
    if (!identical) {
      writeFileSync(join(OUT, "S9-提问后chains快照.json"), after.raw);
      die(`chains.json 在日常提问后发生变化（sha256 before=${evidence.captured.chainsBefore.sha256.slice(0, 12)} after=${evidence.captured.chainsAfter.sha256.slice(0, 12)}）`);
    }
    ok({
      chainsIdentical: identical,
      replyLength: reply.length,
      mentionsMakingModule: evidence.captured.observation.mentionsMakingModule,
      chainLines: st.chainLines,
    });
    break;
  }

  default:
    console.error(`未知步骤: ${step}`);
    ws.close();
    process.exit(2);
}
