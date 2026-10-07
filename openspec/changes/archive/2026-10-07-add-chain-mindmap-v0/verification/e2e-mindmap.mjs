// e2e-mindmap.mjs — add-chain-mindmap-v0 任务 6.1（真机视觉比对素材）＋6.2（端到端走查）
//
// 方法（沿 add-making-module-core e2e-driver.mjs 既定惯例）：
// - 应用以 `npm run tauri:dev` + WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9223 启动；
// - 本脚本经 CDP WebSocket 连 Next Story 页面目标；
// - 点击＝真实鼠标事件（Input.dispatchMouseEvent：moved→pressed→released）；
// - 视觉证据＝Page.captureScreenshot 存 PNG；断言证据＝每景 JSON；
// - 原生确认对话框（启用）按 2026-09-22 app-real-chain-validation C4 先例改道 devtools 通道：
//   覆写 globalThis.confirm，捕获确认文案全文并返回 true（文案入证据，如实记录改道）；
// - 已知合成改道（如实记录）：版本下拉以 evaluate 设值＋dispatch change（原生下拉无法合成鼠标驱动）。
//
// 用法：node e2e-mindmap.mjs   （一次跑完 S1–S5，输出到 ./6-visual/）

import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const BASE = "http://127.0.0.1:9223";
const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "6-visual");
mkdirSync(OUT, { recursive: true });

const list = await fetch(`${BASE}/json/list`).then((r) => r.json());
const target = list.find((t) => t.type === "page" && t.title.includes("Next Story"));
if (!target) {
  console.error("FAIL 未找到 Next Story 页面目标（应用未启动或 9223 调试通道未开）");
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
    consoleErrors.push(msg.params.args.map((a) => a.value ?? a.description ?? a.type).join(" ").slice(0, 400));
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
await send("Page.enable");

const consoleErrors = [];
const startedAt = Date.now();
const evidence = { scenes: [], consoleErrors: [], confirmCaptured: [], deviations: [
  "版本下拉以 evaluate 设值＋dispatch change（原生下拉无法合成鼠标驱动）",
  "原生确认对话框经 devtools 覆写 confirm 采集文案并返回 true（C4 先例）",
] };

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
async function evaluate(expression) {
  const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error("页面求值异常: " + JSON.stringify(r.exceptionDetails).slice(0, 300));
  return r.result?.value;
}
async function rectOf(selector) {
  const r = await evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return null; const b = el.getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height, visible: !el.classList.contains("hidden") && b.width > 0 && b.height > 0 }; })()`);
  if (!r) throw new Error("元素不存在: " + selector);
  return r;
}
/** 图区相对矩形：小窗挂在图区内、随页面滚动走，同位同尺寸的判定基准是图区坐标而非视口坐标。 */
async function graphRelativeRect(selector) {
  const r = await evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); const g = document.querySelector("#making-graph"); if (!el || !g) return null; const eb = el.getBoundingClientRect(); const gb = g.getBoundingClientRect(); return { gx: eb.x - gb.x, gy: eb.y - gb.y, w: eb.width, h: eb.height, visible: !el.classList.contains("hidden") && eb.width > 0 && eb.height > 0 }; })()`);
  if (!r) throw new Error("元素不存在: " + selector);
  return r;
}
async function realClick(selector) {
  // 真实鼠标点击前先滚入视口（图区高于视口时底座/动态区在折叠线下，viewport 坐标点击会落空）
  await evaluate(`document.querySelector(${JSON.stringify(selector)})?.scrollIntoView({ block: "center" })`);
  await sleep(150);
  const b = await rectOf(selector);
  if (!b.visible) throw new Error("元素不可见，无法真实点击: " + selector);
  const x = b.x + b.w / 2, y = b.y + b.h / 2;
  await send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y, button: "none", clickCount: 0 });
  await sleep(60);
  await send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
  await sleep(40);
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
  await sleep(220);
}
async function waitFor(msg, fn, { timeoutMs = 30000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await fn()) return;
    await sleep(500);
  }
  throw new Error("等待超时: " + msg);
}
async function clickButtonByText(containerSelector, text) {
  // 给命中按钮打临时标记，再以真实鼠标点击该标记（避免 nth-of-type 在嵌套结构失准）
  const found = await evaluate(`(() => { const c = document.querySelector(${JSON.stringify(containerSelector)}); if (!c) return false; const els = [...c.querySelectorAll("button")]; const hit = els.find(b => (b.textContent ?? "").includes(${JSON.stringify(text)}) || (b.getAttribute("aria-label") ?? "").includes(${JSON.stringify(text)})); if (!hit) return false; els.forEach(b => b.removeAttribute("data-e2e-hit")); hit.setAttribute("data-e2e-hit", "1"); return true; })()`);
  if (!found) throw new Error(`容器 ${containerSelector} 内未找到含「${text}」的按钮`);
  await realClick(`${containerSelector} button[data-e2e-hit]`);
  await evaluate(`document.querySelectorAll("[data-e2e-hit]").forEach(el => el.removeAttribute("data-e2e-hit"))`);
}
async function shot(name) {
  const r = await send("Page.captureScreenshot", { format: "png" });
  writeFileSync(join(OUT, name), Buffer.from(r.data, "base64"));
}
function assert(cond, msg) {
  if (!cond) throw new Error("断言失败: " + msg);
}
async function scene(name, fn) {
  const rec = { name, at: new Date().toISOString(), assertions: {} };
  try {
    await fn(rec.assertions);
    rec.passed = true;
    evidence.scenes.push(rec);
    console.log(`SCENE_OK[${name}]`);
  } catch (e) {
    rec.passed = false;
    rec.error = String(e.message ?? e);
    evidence.scenes.push(rec);
    console.error(`SCENE_FAIL[${name}] ${rec.error}`);
    await finish(1);
  }
}
async function finish(code) {
  evidence.elapsedMs = Date.now() - startedAt;
  evidence.consoleErrors = [...new Set(consoleErrors)].slice(0, 50);
  evidence.confirmCaptured = await evaluate("globalThis.__confirmLog ?? []").catch(() => []);
  writeFileSync(join(OUT, "evidence.json"), JSON.stringify(evidence, null, 2));
  console.log(code === 0 ? "ALL_OK" : "ALL_FAIL");
  ws.close();
  process.exit(code);
}

// 确认对话框改道（C4 先例）
await evaluate(`(() => { globalThis.__confirmLog = []; const orig = globalThis.confirm; globalThis.confirm = (msg) => { globalThis.__confirmLog.push(String(msg)); return true; }; return true; })()`);

// ---------- S0 打开最近作品（沿 ② e2e-driver S0 惯例：冷启动停在欢迎页，需先开作品进主壳；幂等：已开则跳过） ----------
await scene("S0-打开最近作品", async (a) => {
  const VIS = `((el) => el && !el.classList.contains("hidden"))`;
  const editorReady = () => evaluate(`${VIS}(document.getElementById("editor-page")) && !${VIS}(document.getElementById("welcome-page"))`);
  if (await editorReady()) { a.alreadyOpen = true; return; }
  await waitFor("欢迎页可见", () => evaluate(`${VIS}(document.getElementById("welcome-page"))`));
  a.recentCount = await evaluate(`document.querySelectorAll("#recent-works-list .recent-work-item").length`);
  assert(a.recentCount > 0, "最近作品列表为空");
  a.openedName = (await evaluate(`(document.querySelector("#recent-works-list .recent-work-item .recent-work-name")?.textContent ?? "").trim()`));
  await realClick("#recent-works-list .recent-work-item");
  await waitFor("作品打开（编辑页出现、欢迎页隐藏）", editorReady, { timeoutMs: 60000 });
  a.opened = true;
});

// ---------- S1 导图总览 ----------
await scene("S1-导图总览", async (a) => {
  // 导航到制作模块（nav 按钮由 main.ts 动态挂载，按文本定位）
  await clickButtonByText("body", "制作模块");
  await sleep(600);
  const visible = await evaluate(`!document.querySelector("#module-making").classList.contains("hidden")`);
  assert(visible, "制作页未显示");
  // 进入制作页默认空检视态：先在链路库选中第一条链路，导图才渲染。
  // 窄窗（<1180px）下链路库是抽屉式浮层（toggle 为开关，不能盲点）：
  // 行不可见才展开；选中后若抽屉开着才收起——幂等，适配任意起始状态。
  const rowVisibleFn = `(() => { const el = document.querySelector("#making-chain-list > *"); if (!el) return false; const b = el.getBoundingClientRect(); return b.width > 0 && b.height > 0; })()`;
  const drawerOpen = () => evaluate(`document.getElementById("module-making").classList.contains("making-library-open")`);
  a.libraryExpandedFromCollapsed = false;
  if (!(await evaluate(rowVisibleFn))) {
    const toggleVisible = await evaluate(`(() => { const t = document.getElementById("making-library-toggle"); if (!t) return false; const b = t.getBoundingClientRect(); return b.width > 0 && b.height > 0; })()`);
    if (!toggleVisible) throw new Error("链路库行不可见且无展开按钮（非预期状态）");
    await realClick("#making-library-toggle");
    await sleep(300);
    a.libraryExpandedFromCollapsed = true;
  }
  await waitFor("链路库行可见", () => evaluate(rowVisibleFn), { timeoutMs: 20000 });
  await realClick("#making-chain-list > *:first-child");
  await waitFor("检视内容出现", () => evaluate(`!document.querySelector("#making-inspector-content").classList.contains("hidden")`), { timeoutMs: 20000 });
  // 抽屉开着会盖住图区左半边：选中链路后收起（仅当开着）
  if (await drawerOpen()) {
    await realClick("#making-library-close-btn");
    await sleep(250);
    a.libraryDrawerClosed = true;
  }
  a.mapTabDefault = await evaluate(`document.querySelector("#making-view-map-btn").classList.contains("active")`);
  assert(a.mapTabDefault === true, "默认标签不是导图");
  a.zones = await evaluate(`["making-zone-custom","making-base-node","making-dynamic-node"].map(id => { const el = document.getElementById(id); return el ? el.getAttribute("aria-label") ?? el.textContent.trim().slice(0, 12) : null; })`);
  assert(a.zones[0]?.includes("自定义要求"), "分区一不是自定义要求: " + a.zones[0]);
  assert(a.zones[1]?.includes("固定底座"), "分区二不是固定底座");
  assert(a.zones[2]?.includes("每轮动态"), "分区三不是每轮动态");
  await waitFor("流线渲染", () => evaluate(`document.querySelectorAll("#making-wire-paths path").length >= 4`), { timeoutMs: 20000 });
  a.wireCount = await evaluate(`document.querySelectorAll("#making-wire-paths path").length`);
  a.markerOnlyOnWires = await evaluate(`[...document.querySelectorAll("#making-wire-paths path")].every(p => p.getAttribute("marker-end") !== null) && [...document.querySelectorAll("#making-card-list button")].every(c => c.querySelector("svg") === null)`);
  assert(a.markerOnlyOnWires === true, "箭头未仅限于流线");
  a.outputIsDiv = await evaluate(`document.querySelector("#making-output-node") !== null && document.querySelector("#making-output-node button") === null`);
  assert(a.outputIsDiv === true, "输出块不是纯象征形态");
  a.readingNotes = await evaluate(`[...document.querySelectorAll("#making-reading-notes p")].map(p => p.textContent.trim())`);
  assert(a.readingNotes.includes("箭头只表示流向组装，不表示卡片执行顺序"), "阅读说明缺箭头语义句");
  assert(a.readingNotes.includes("启用对象是整个链路版本"), "阅读说明缺启用对象句");
  assert(a.readingNotes.some(t => t.startsWith("展示链路的组装结构与适用条件")), "阅读说明缺免责句");
  a.ghostText = await evaluate(`document.querySelector("#making-add-card-btn")?.textContent.trim()`);
  assert(a.ghostText === "＋ 添加要求卡", "ghost 加卡文案不对: " + a.ghostText);
  a.cardCount = await evaluate(`document.querySelectorAll("#making-card-list button").length`);
  a.chainName = await evaluate(`document.querySelector("#making-inspector-title")?.textContent ?? ""`);
  a.statusIdle = await evaluate(`!document.querySelector("#making-status-idle").classList.contains("hidden")`);
  await shot("01-map-overview.png");
});

// ---------- S2 点卡→快捷小窗→全页详情→返回 ----------
let cardPanelRect = null;
await scene("S2-卡片详情两级", async (a) => {
  assert((await evaluate(`document.querySelectorAll("#making-card-list button").length`)) > 0, "链路无卡片（预置数据缺卡）");
  await realClick("#making-card-list button");
  await sleep(300);
  a.quickVisible = await evaluate(`!document.querySelector("#making-quick-panel").classList.contains("hidden")`);
  assert(a.quickVisible === true, "点卡未打开快捷小窗");
  cardPanelRect = await graphRelativeRect("#making-quick-panel");
  a.quickRect = { ...cardPanelRect };
  await shot("02-quick-panel-card.png");
  await clickButtonByText("#making-quick-panel", "完整详情");
  await sleep(300);
  a.fullVisible = await evaluate(`!document.querySelector("#making-full-detail").classList.contains("hidden")`);
  assert(a.fullVisible === true, "未打开全页详情");
  a.fullSections = await evaluate(`[...document.querySelectorAll("#making-card-panel section, #making-card-panel h4")].map(el => el.textContent.trim().slice(0, 8)).filter(Boolean)`);
  for (const key of ["身份", "何时用", "怎么做", "本版变化", "试问记录"]) {
    assert(a.fullSections.some(s => s.includes(key)), `全页详情缺「${key}」`);
  }
  a.fullBodyHasVerbatim = await evaluate(`(document.querySelector("#making-card-panel")?.textContent ?? "").includes("不往反转方向处理")`);
  assert(a.fullBodyHasVerbatim === true, "全页详情「怎么做」未含卡片正文原文（疑似只剩概括）");
  a.fullBodyLength = await evaluate(`document.querySelector("#making-card-panel")?.textContent.length ?? 0`);
  assert(a.fullBodyLength > 120, "全页详情文本量异常偏少: " + a.fullBodyLength);
  await shot("03-full-detail.png");
  await realClick("#making-full-back");
  await sleep(300);
  a.backToQuick = await evaluate(`!document.querySelector("#making-quick-panel").classList.contains("hidden") && document.querySelector("#making-full-detail").classList.contains("hidden")`);
  assert(a.backToQuick === true, "返回后未回到快捷小窗");
  await shot("04-back-to-quick.png");
  await clickButtonByText("#making-quick-panel", "关闭");
  await sleep(200);
  a.closed = await evaluate(`document.querySelector("#making-quick-panel").classList.contains("hidden")`);
  assert(a.closed === true, "小窗未关闭");
});

// ---------- S3 三类对象同位同尺寸 ----------
await scene("S3-统一详情位置", async (a) => {
  await realClick("#making-base-node");
  await sleep(300);
  const baseRect = await graphRelativeRect("#making-quick-panel");
  a.baseRect = { ...baseRect };
  a.sameAsCard = Math.abs(baseRect.gx - cardPanelRect.gx) < 1 && Math.abs(baseRect.gy - cardPanelRect.gy) < 1 && Math.abs(baseRect.w - cardPanelRect.w) < 1 && Math.abs(baseRect.h - cardPanelRect.h) < 1;
  assert(a.sameAsCard === true, `底座小窗与卡片小窗图区坐标不同（卡:${JSON.stringify(cardPanelRect)} 底座:${JSON.stringify(baseRect)}）`);
  a.baseNoActions = await evaluate(`![...document.querySelectorAll("#making-quick-panel button")].some(b => /修改|删除|添加/.test(b.textContent ?? ""))`);
  assert(a.baseNoActions === true, "底座详情出现了修改/删除/添加控件");
  await shot("05-quick-panel-base.png");
  await clickButtonByText("#making-quick-panel", "关闭");
  await sleep(200);
  await realClick("#making-dynamic-node");
  await sleep(300);
  const dynRect = await graphRelativeRect("#making-quick-panel");
  a.dynSame = Math.abs(dynRect.gx - cardPanelRect.gx) < 1 && Math.abs(dynRect.gy - cardPanelRect.gy) < 1 && Math.abs(dynRect.w - cardPanelRect.w) < 1 && Math.abs(dynRect.h - cardPanelRect.h) < 1;
  assert(a.dynSame === true, `每轮动态小窗与卡片小窗图区坐标不同（卡:${JSON.stringify(cardPanelRect)} 动态:${JSON.stringify(dynRect)}）`);
  a.dynNoActions = await evaluate(`![...document.querySelectorAll("#making-quick-panel button")].some(b => /修改|删除/.test(b.textContent ?? ""))`);
  assert(a.dynNoActions === true, "动态详情出现了修改/删除控件");
  await shot("06-quick-panel-dynamic.png");
  await clickButtonByText("#making-quick-panel", "关闭");
  await sleep(200);
});

// ---------- S4 双标签切换 ----------
await scene("S4-双标签切换", async (a) => {
  const visEl = (sel) => evaluate(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return false; const b = el.getBoundingClientRect(); return b.width > 0 && b.height > 0; })()`);
  await realClick("#making-view-chat-btn");
  await sleep(300);
  a.chatVisible = await visEl("#making-conversation-pane");
  a.mapHidden = !(await visEl("#making-inspector"));
  assert(a.chatVisible === true && a.mapHidden === true, "切到制作对话标签后视图显隐不对");
  a.statusStillThere = await evaluate(`document.querySelector("#making-status-bar") !== null && document.querySelector("#making-status-bar").getBoundingClientRect().height > 0`);
  assert(a.statusStillThere === true, "状态条未常驻");
  await shot("07-chat-tab.png");
  await realClick("#making-view-map-btn");
  await sleep(300);
  a.backToMap = (await visEl("#making-inspector")) && !(await visEl("#making-conversation-pane"));
  assert(a.backToMap === true, "切回导图失败");
});

// ---------- S5 三态分离（起点归一：先停用回零，再 启用→查草稿→停用 还原；幂等） ----------
await scene("S5-草稿三态分离", async (a) => {
  const hasDraft = await evaluate(`(() => { const sel = document.querySelector("#making-version-select"); return sel ? sel.options.length >= 2 : false; })()`);
  assert(hasDraft === true, "预置链路无第二版本（无法验证草稿场景）");
  // 起点归一：若已有启用链路（历史运行遗留），先停用回零（证据记录）
  const idleNow = () => evaluate(`!document.getElementById("making-status-idle").classList.contains("hidden")`);
  if (!(await idleNow())) {
    await realClick("#making-deactivate-btn");
    await sleep(500);
    a.deactivatedFirst = true;
  }
  assert(await idleNow(), "起点归一失败（停用后状态条未回到未启用）");
  // 选第1版 → 启用（confirm 已改道采集）
  await evaluate(`(() => { const sel = document.querySelector("#making-version-select"); const opt = [...sel.options].find(o => o.textContent.includes("第1版")); if (!opt) return false; sel.value = opt.value; sel.dispatchEvent(new Event("change", { bubbles: true })); return true; })()`);
  await sleep(400);
  const enableVisible = await evaluate(`(() => { const el = document.getElementById("making-enable-btn"); if (!el || el.hidden || el.classList.contains("hidden")) return false; const b = el.getBoundingClientRect(); return b.width > 0 && b.height > 0; })()`);
  assert(enableVisible === true, "查看未启用版本时启用按钮未出现");
  await realClick("#making-enable-btn");
  await sleep(600);
  a.statusAfterEnable = await evaluate(`document.querySelector("#making-status-text")?.textContent ?? ""`);
  assert(a.statusAfterEnable.includes("第1版"), "启用后状态条非第1版: " + a.statusAfterEnable);
  a.statusSharedVisible = await evaluate(`(() => { const el = document.querySelector(".making-status-shared"); if (!el) return false; const b = el.getBoundingClientRect(); return el.textContent.includes("所有作品共用") && b.width > 0; })()`);
  assert(a.statusSharedVisible === true, "状态条缺「所有作品共用」");
  // 切到第2版（草稿）——已知改道：evaluate 设值＋change
  await evaluate(`(() => { const sel = document.querySelector("#making-version-select"); const opt = [...sel.options].find(o => o.textContent.includes("第2版")); if (!opt) return false; sel.value = opt.value; sel.dispatchEvent(new Event("change", { bubbles: true })); return true; })()`);
  await sleep(400);
  a.inspectorTitle = await evaluate(`document.querySelector("#making-inspector-title")?.textContent ?? ""`);
  a.inspectorState = await evaluate(`document.querySelector("#making-inspector-state")?.textContent ?? ""`);
  assert(a.inspectorTitle.includes("第2版") && a.inspectorTitle.includes("草稿"), "检视标题非第2版草稿: " + a.inspectorTitle);
  assert(a.inspectorState.includes("尚未启用"), "检视未标尚未启用: " + a.inspectorState);
  a.statusUnchanged = await evaluate(`document.querySelector("#making-status-text")?.textContent ?? ""`);
  assert(a.statusUnchanged === a.statusAfterEnable, "查看草稿时状态条被改动（三态混同）");
  a.noActiveVisual = await evaluate(`!document.querySelector("#making-inspector").className.includes("active")`);
  await shot("08-draft-three-states.png");
  // 数据还原：停用
  await realClick("#making-deactivate-btn");
  await sleep(500);
  a.statusIdleRestored = await evaluate(`!document.querySelector("#making-status-idle").classList.contains("hidden")`);
  assert(a.statusIdleRestored === true, "停用后状态条未回到未启用");
});

assert(consoleErrors.length === 0, "全程存在控制台错误: " + consoleErrors.join(" | ").slice(0, 300));
await finish(0);
