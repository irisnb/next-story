// smoke-tooltip-ownership.mjs — fix-tooltip-rule-ownership 任务 5.1/5.3（真机冒烟 CDP 断言）
//
// 冒烟形态（项目既定惯例，沿 e2e-driver.mjs / round.mjs）：
// - 应用以 `npm run tauri:dev` + 环境变量 WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9223 启动；
// - 本脚本经 CDP WebSocket 连 Next Story 页面目标；
// - 点击＝真实鼠标事件（Input.dispatchMouseEvent：moved→pressed→released）；
// - DOM 查询只走 Runtime.evaluate 只读；
// - 证据＝本目录 smoke-tooltip-ownership.json（含每条断言的实测值）。
//
// 前置：已打开任一项目（写作页可见）。无真实 API 也能全跑——④ 的「生成不中断」
// 需要真实生成请求，本脚本按设计降级为「收起后讨论仍在列表、重开正文保留」，
// 降级如实写入证据（assertion4.generationContinuity = "degraded: no live request"）。
//
// 四条级联回归断言（验成片不验台本——全部基于浏览器计算结果）：
// ① 三个发送按钮（追问 / 直接提问 / 制作对话）纹样以真实 img 渲染：宽 28px、
//    高宽比＝988/789（以 naturalWidth/naturalHeight 实测为准）、可见；
// ② 悬停带提示按钮（停靠区头「最大化」）仅出现一个提示层：#ui-tooltip 可见、
//    被悬停元素的 ::before/::after 计算样式无提示内容、全 DOM 无 data-tooltip 写入；
// ③ 无选区时悬停禁用态工具按钮（如「粗体」）：aria-disabled=true 且共享提示
//    显示功能名（非空中文）；真实点击粗体→提示层出现且文本含「先选中文字再用」、
//    提示矩形须出现在按钮邻近（不得钳到窗口角落，3.9/3.10 锚点断言）、编辑器
//    innerHTML 无任何变化（无 <strong> 等格式标记，D3 C 案 3.6/3.7）；六枚补漏
//    按钮（对齐四枚＋清除格式两枚）aria-disabled=true、opacity=1、非原生
//    disabled（3.8）；悬停「撤销」（历史空时 aria-disabled=true）→功能名提示
//    可见（不再原生 disabled 无提示，D3 C 案 3.5）；
// ④ 讨论窗口头无收起按钮；停靠区头 ✕ 收起面板后讨论仍在列表（重开正文保留）。
// 附 3.11：「讨论」开关展开态轻表面断言（aria-expanded=true 底色三通道 >180 且非
//    rgb(115,115,115) 深灰；收起态透明/浅色）。
//
// 用法：node smoke-tooltip-ownership.mjs

import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const BASE = "http://127.0.0.1:9223";
const HERE = dirname(fileURLToPath(import.meta.url));

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
  }
});
await new Promise((res, rej) => {
  ws.addEventListener("open", res);
  ws.addEventListener("error", () => rej(new Error("WebSocket 连接失败")));
});
await send("Runtime.enable");

const startedAt = Date.now();
const evidence = { step: "smoke-tooltip-ownership", at: new Date().toISOString(), assertions: {}, events: [] };
function die(msg) {
  evidence.passed = false;
  evidence.failReason = msg;
  dump();
  console.error(`STEP_FAIL ${msg}`);
  ws.close();
  process.exit(1);
}
function dump() {
  evidence.elapsedMs = Date.now() - startedAt;
  mkdirSync(HERE, { recursive: true });
  writeFileSync(join(HERE, "smoke-tooltip-ownership.json"), JSON.stringify(evidence, null, 2));
}
async function evaluate(expression) {
  const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) die("页面求值异常: " + JSON.stringify(r.exceptionDetails).slice(0, 400));
  return r.result?.value;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 真实鼠标点击元素中心（沿 e2e-driver 惯例：moved→pressed→released）。 */
async function click(selector) {
  const rect = await evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
  if (!rect) die(`点击目标不存在: ${selector}`);
  await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: rect.x, y: rect.y });
  await send("Input.dispatchMouseEvent", { type: "mousePressed", x: rect.x, y: rect.y, button: "left", clickCount: 1 });
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: rect.x, y: rect.y, button: "left", clickCount: 1 });
  await sleep(250);
}

/** 悬停元素中心（真实 mouseMoved；共享提示由 pointerover 驱动）。 */
async function hover(selector) {
  const rect = await evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
  if (!rect) die(`悬停目标不存在: ${selector}`);
  await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: rect.x, y: rect.y });
  await sleep(400);
}

// ---------- 前置：写作页与项目已打开 ----------
const writingVisible = await evaluate(`(() => { const t = document.getElementById("tab-writing"); const p = document.getElementById("editor-textarea"); return { tab: !!t, editor: !!p && p.getClientRects().length > 0 }; })()`);
if (!writingVisible?.editor) die("前置不满足：请先打开一个项目并停留在写作页（编辑器不可见）");
await click("#tab-writing");
await sleep(200);
// 面板若默认收起则先经顶栏入口打开（断言②的悬停目标在面板头部）。
const panelOpen = await evaluate(`(() => { const d = document.getElementById("ai-dock"); return !!d && !d.classList.contains("hidden") && d.getClientRects().length > 0; })()`);
if (!panelOpen) {
  await click("#btn-toggle-ai");
  await sleep(400);
}

// ---------- ② 悬停唯一提示层（先做，无需项目内容以外的状态） ----------
await hover("#ai-dock-maximize");
const tip2 = await evaluate(`(() => {
  const tip = document.getElementById("ui-tooltip");
  const btn = document.getElementById("ai-dock-maximize");
  const cs = getComputedStyle(btn);
  const before = getComputedStyle(btn, "::before");
  const after = getComputedStyle(btn, "::after");
  return {
    sharedTipVisible: !!tip && !tip.classList.contains("hidden") && tip.getClientRects().length > 0,
    sharedTipText: tip?.textContent ?? null,
    btnDataTooltip: btn.getAttribute("data-tooltip"),
    btnDataHint: btn.getAttribute("data-hint"),
    pseudoBefore: { content: before.content, display: before.display },
    pseudoAfter: { content: after.content, display: after.display },
    domDataTooltipCount: document.querySelectorAll("[data-tooltip]").length,
    visibleTooltipRoles: Array.from(document.querySelectorAll('[role="tooltip"]')).filter((el) => el.getClientRects().length > 0).length,
  };
})()`);
evidence.assertions["② 单一悬停提示"] = tip2;
if (!tip2.sharedTipVisible || !tip2.sharedTipText?.trim()) die(`② 共享提示未显示: ${JSON.stringify(tip2)}`);
if (tip2.visibleTooltipRoles !== 1) die(`② 可见提示层数应为 1，实测 ${tip2.visibleTooltipRoles}`);
// 伪元素提示「断粮」的正确判定指标是 content（content:none/normal ⇒ 伪元素不生成盒子、
// 不渲染任何东西）；display 的计算值与是否生成盒子无关（未命中规则时为默认值 block）。
const starved = (p) => p.content === "none" || p.content === "normal";
if (!starved(tip2.pseudoBefore) || !starved(tip2.pseudoAfter)) die(`② 伪元素提示未断粮: ${JSON.stringify({ b: tip2.pseudoBefore, a: tip2.pseudoAfter })}`);
if (tip2.domDataTooltipCount !== 0) die(`② 全 DOM 不得再有 data-tooltip 写入（实测 ${tip2.domDataTooltipCount} 处）`);
// 移开鼠标收起提示，避免干扰后续断言。
await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 4, y: 400 });
await sleep(250);

// ---------- ③ 无选区：悬停功能名 + 点击原因提示（D3 C 案 3.4–3.7） ----------
const sel3 = await evaluate(`(() => { const t = document.getElementById("btn-bold"); return { exists: !!t, ariaDisabled: t?.getAttribute("aria-disabled"), nativeDisabled: t?.disabled, hint: t?.getAttribute("data-hint") }; })()`);
if (!sel3.exists) die("③ 工具按钮 btn-bold 不存在（未进入写作页？）");
if (sel3.ariaDisabled !== "true") die(`③ 无选区时 btn-bold 应为 aria-disabled=true，实测 ${JSON.stringify(sel3)}（请确保编辑器无选区）`);
if (sel3.nativeDisabled !== false) die(`③ 不可用工具不得置原生 disabled（D3 C 案「亮着」），实测 ${JSON.stringify(sel3)}`);
// 不可用态外观＝启用态：不得变灰/半透明（opacity 计算值应与启用态基线 1 一致）。
// 3.8 补漏六枚（对齐四枚＋清除格式两枚）同场核对：首版实测 op=0.4 dis=true 已修。
const lit3 = await evaluate(`(() => {
  const probe = (id) => { const el = document.getElementById(id); return { aria: el?.getAttribute("aria-disabled"), dis: el?.disabled, op: el ? getComputedStyle(el).opacity : null }; };
  const bold = probe("btn-bold");
  const missed = ["btn-align-left", "btn-align-center", "btn-align-right", "btn-align-justify", "btn-clear-character-format", "btn-clear-paragraph-format"].map(probe);
  return { bold, missed };
})()`);
evidence.assertions["③ 不可用态亮着"] = lit3;
if (lit3.bold.op !== "1") die(`③ 不可用工具不得变灰/半透明（opacity 应为 1，实测 ${lit3.bold.op}）`);
for (let i = 0; i < lit3.missed.length; i += 1) {
  const m = lit3.missed[i];
  if (m.aria !== "true") die(`③ 3.8 补漏按钮第 ${i + 1} 枚应 aria-disabled=true，实测 ${JSON.stringify(m)}`);
  if (m.dis !== false) die(`③ 3.8 补漏按钮第 ${i + 1} 枚不得原生 disabled，实测 ${JSON.stringify(m)}`);
  if (m.op !== "1") die(`③ 3.8 补漏按钮第 ${i + 1} 枚不得变灰（opacity 应为 1，实测 ${m.op}）`);
}
await hover("#btn-bold");
const tip3 = await evaluate(`(() => { const tip = document.getElementById("ui-tooltip"); return { visible: !!tip && !tip.classList.contains("hidden"), text: tip?.textContent ?? "" }; })()`);
evidence.assertions["③ 禁用态功能名提示"] = { button: sel3, tip: tip3 };
if (!tip3.visible || !tip3.text.trim()) die(`③ 禁用态悬停应显示功能名提示，实测 ${JSON.stringify(tip3)}`);
await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 4, y: 400 });
await sleep(300);

// 真实点击粗体（无选区）：动作被守卫拒绝＋共享提示层给原因提示＋文档零变化。
// 脚本修正（3.11 复跑发现两处）：①前次编辑把快照改成对象 {html, strongCount} 但
// 比较仍按字符串直等（对象≠字符串恒 false，必死）——比较改用 .html；②<strong>
// 判据用差值（点击前后数量一致）——真实项目文档可本来就含加粗文字，绝对式断言
// 会误伤。另加内容稳定等待：新开项目编辑器内容异步装载，快照取在装载完成前会把
// 「内容流入」误报成「点击改变内容」；两次采样一致后才做零变化断言（不弱化）。
let editorBefore = null;
for (let i = 0; i < 10 && editorBefore === null; i += 1) {
  const a = await evaluate(`(() => { const e = document.querySelector("#editor-textarea .ProseMirror"); return { html: e?.innerHTML ?? null, strongCount: e ? e.querySelectorAll("strong").length : null }; })()`);
  await sleep(300);
  const b = await evaluate(`(() => { const e = document.querySelector("#editor-textarea .ProseMirror"); return { html: e?.innerHTML ?? null, strongCount: e ? e.querySelectorAll("strong").length : null }; })()`);
  if (a?.html !== null && a?.html === b?.html) editorBefore = a;
}
if (editorBefore === null || editorBefore.html === null) die("③ 编辑器内容不可读或装载未稳定，无法做零变化断言");
await click("#btn-bold");
const click3 = await evaluate(`(() => {
  const tip = document.getElementById("ui-tooltip");
  const bold = document.getElementById("btn-bold");
  const editor = document.querySelector("#editor-textarea .ProseMirror");
  return {
    tipVisible: !!tip && !tip.classList.contains("hidden") && tip.getClientRects().length > 0,
    tipText: tip?.textContent ?? "",
    boldStillAriaDisabled: bold?.getAttribute("aria-disabled"),
    editorStrongCount: editor ? editor.querySelectorAll("strong").length : null,
    editorHtml: editor?.innerHTML ?? null,
    tipRect: tip?.getBoundingClientRect().toJSON() ?? null,
    boldRect: bold?.getBoundingClientRect().toJSON() ?? null,
    viewport: { w: window.innerWidth, h: window.innerHeight },
  };
})()`);
evidence.assertions["③ 点击不可用工具给原因提示"] = {
  reasonTip: { visible: click3.tipVisible, text: click3.tipText },
  boldStillAriaDisabled: click3.boldStillAriaDisabled,
  editorUnchanged: click3.editorHtml === editorBefore.html,
  strongCountBeforeAfter: [editorBefore.strongCount, click3.editorStrongCount],
  position: { tip: click3.tipRect, bold: click3.boldRect },
};
if (!click3.tipVisible || !click3.tipText.includes("先选中文字再用")) die(`③ 无选区点击粗体应显示「先选中文字再用」原因提示，实测 ${JSON.stringify(click3)}`);
if (click3.editorHtml !== editorBefore.html) die("③ 无选区点击粗体不得改变编辑器内容（innerHTML 应零变化）");
if (click3.editorStrongCount !== editorBefore.strongCount) die(`③ 无选区点击粗体不得新增 <strong>（差值判据：前 ${editorBefore.strongCount} 后 ${click3.editorStrongCount}）`);
if (click3.boldStillAriaDisabled !== "true") die("③ 点击后按钮应保持 aria-disabled=true");
// 3.10 位置断言：提示须出现在触发按钮邻近（不得再被钳到窗口角落——3.9 修复前
// 实测提示在 x:2448,y:8 而按钮在 x:10,y:240）。判定：tip.x ∈ [btn.x−150, btn.x+350]
// 且 tip.y ∈ [btn.y−80, btn.y+120]。
const near = click3.tipRect && click3.boldRect
  ? click3.tipRect.left >= click3.boldRect.left - 150 && click3.tipRect.left <= click3.boldRect.left + 350 &&
    click3.tipRect.top >= click3.boldRect.top - 80 && click3.tipRect.top <= click3.boldRect.top + 120
  : false;
if (!near) {
  die(`③ 原因提示未出现在按钮邻近（3.9 锚点修复失效）：tip=${JSON.stringify(click3.tipRect)} btn=${JSON.stringify(click3.boldRect)} viewport=${JSON.stringify(click3.viewport)}`);
}
// 原因提示展示期约 1.4 秒（期间悬停不抢位）：等待到期后再做撤销悬停，避免互相干扰。
await sleep(1600);

// 悬停撤销（历史空时并入同一模式）：功能名提示可见，不再是原生 disabled 的无提示。
const undo3 = await evaluate(`(() => { const u = document.getElementById("btn-undo"); return { exists: !!u, ariaDisabled: u?.getAttribute("aria-disabled"), nativeDisabled: u?.disabled, hint: u?.getAttribute("data-hint") }; })()`);
if (!undo3.exists) die("③ 工具按钮 btn-undo 不存在");
let undoTip;
if (undo3.ariaDisabled === "true") {
  await hover("#btn-undo");
  undoTip = await evaluate(`(() => { const tip = document.getElementById("ui-tooltip"); return { visible: !!tip && !tip.classList.contains("hidden"), text: tip?.textContent ?? "" }; })()`);
  if (!undoTip.visible || !undoTip.text.includes("撤销")) die(`③ 历史空悬停撤销应显示功能名提示（不再是原生 disabled 无提示），实测 ${JSON.stringify({ undo3, undoTip })}`);
} else {
  undoTip = { skipped: true, note: "degraded: 撤销历史非空（aria-disabled=false），功能名提示属可用态常规路径；历史空场景留待空文档时核对" };
  evidence.events.push(`③ 撤销悬停降级：${undoTip.note}`);
}
evidence.assertions["③ 撤销（历史空）功能名提示"] = { button: undo3, tip: undoTip };
await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 4, y: 400 });
await sleep(250);

// ---------- ① 三个发送按钮纹样实际渲染（真实 img） ----------
// 直接提问按钮：新建讨论即得（无选区要求）。#ai-new-conversation 是隐藏兜底按钮，
// 真实鼠标无法命中；走可见路径：列表开关 → 列表内「新建讨论」。
await click("#ai-conversation-list-toggle");
await sleep(400);
// 3.11 「讨论」开关展开态轻表面断言：aria-expanded=true 期间计算底色三通道均 >180
// （轻底），不得为 Basecoat ghost 展开态默认持续深灰 rgb(115,115,115)（用户读作
// 「卡住」，2026-10-30 拍板改轻表面）；新建讨论后列表收起，补收起态探针（透明或
// 浅色，不得为深灰）。实测值入证据 JSON。
const toggleBgOpen = await evaluate(`(() => {
  const t = document.getElementById("ai-conversation-list-toggle");
  const bg = getComputedStyle(t).backgroundColor;
  const n = bg.match(/[\\d.]+/g)?.map(Number) ?? [];
  return { expanded: t?.getAttribute("aria-expanded"), backgroundColor: bg, rgba: n };
})()`);
evidence.assertions["3.11 开关展开态轻表面"] = { open: toggleBgOpen };
if (toggleBgOpen.expanded !== "true") die(`3.11 列表已打开，开关应为 aria-expanded=true，实测 ${JSON.stringify(toggleBgOpen)}`);
{
  const [r, g, b] = toggleBgOpen.rgba;
  if (!(r > 180 && g > 180 && b > 180)) die(`3.11 展开态底色应为轻表面（三通道均 >180），实测 ${toggleBgOpen.backgroundColor}`);
  if (r === 115 && g === 115 && b === 115) die(`3.11 展开态底色不得为 Basecoat ghost 深灰 rgb(115,115,115)，实测 ${toggleBgOpen.backgroundColor}`);
}
await click("#ai-list-new-conversation");
await sleep(400);
const toggleBgClosed = await evaluate(`(() => {
  const t = document.getElementById("ai-conversation-list-toggle");
  const bg = getComputedStyle(t).backgroundColor;
  const n = bg.match(/[\\d.]+/g)?.map(Number) ?? [];
  return { expanded: t?.getAttribute("aria-expanded"), backgroundColor: bg, rgba: n };
})()`);
evidence.assertions["3.11 开关展开态轻表面"].closed = toggleBgClosed;
{
  const [r, g, b, a] = toggleBgClosed.rgba;
  const transparent = a === 0;
  const light = r > 180 && g > 180 && b > 180;
  if (toggleBgClosed.expanded !== "false") die(`3.11 新建讨论后列表应收起（aria-expanded=false），实测 ${JSON.stringify(toggleBgClosed)}`);
  if (!(transparent || light)) die(`3.11 收起态底色应为透明或浅色（不得为深灰），实测 ${toggleBgClosed.backgroundColor}`);
}
const imgProbe = (selector) => `(() => {
  const btn = document.querySelector(${JSON.stringify(selector)});
  if (!btn) return { found: false };
  const img = btn.querySelector("img");
  if (!img) return { found: true, img: false };
  const r = img.getBoundingClientRect();
  return {
    found: true, img: true,
    rendered: { width: r.width, height: r.height, visible: r.width > 0 && r.height > 0, complete: img.complete, naturalOk: img.naturalWidth === 988 && img.naturalHeight === 789 },
    ratio: r.height > 0 ? r.width / r.height : null,
    srcTail: (img.currentSrc || img.src || "").split("/").slice(-2).join("/"),
    disabledLook: getComputedStyle(btn).backgroundColor,
  };
})()`;
const direct = await evaluate(imgProbe('[data-role="direct-question-send"]'));
// 制作对话按钮：切到制作页，再切「制作对话」子标签（默认在「导图」，对话面板隐藏、img 无客户区）。
await click("#tab-making");
await sleep(400);
await click("#making-view-chat-btn");
await sleep(400);
const making = await evaluate(imgProbe("#making-conversation-send"));
await click("#tab-writing");
await sleep(400);
// 追问按钮：任一已有讨论打开追问表单即得；从列表打开最近讨论（若无则如实降级记录）。
await click("#ai-conversation-list-toggle");
await sleep(400);
const firstRow = await evaluate(`(() => { const row = document.querySelector(".ai-cl-row"); if (!row) return null; const r = row.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
let followUp;
if (firstRow) {
  await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: firstRow.x, y: firstRow.y });
  await send("Input.dispatchMouseEvent", { type: "mousePressed", x: firstRow.x, y: firstRow.y, button: "left", clickCount: 1 });
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: firstRow.x, y: firstRow.y, button: "left", clickCount: 1 });
  await sleep(600);
  followUp = await evaluate(imgProbe('[data-role="follow-up-send"]'));
} else {
  followUp = { found: false, note: "degraded: 无历史讨论可开，追问按钮几何留待有讨论时核对（结构与另两按钮同款）" };
}
evidence.assertions["① 发送纹样真实 img 渲染"] = { direct, making, followUp };
for (const [name, probe, requireGeometry] of [["直接提问", direct, true], ["制作对话", making, true], ["追问", followUp, false]]) {
  if (!probe?.found) { if (requireGeometry) die(`① ${name}发送按钮不存在`); else { evidence.events.push(`① ${name}按钮几何降级：${probe?.note}`); continue; } }
  if (!probe.img) die(`① ${name}发送按钮内无真实 img（纹样未以 img 呈现）`);
  // 追问按钮降级：打开的讨论若无已完成轮次，追问表单不显示（img 无客户区），
  // 几何留待有轮次讨论时核对；另两枚按钮（直接提问/制作对话）仍严格断言。
  if (!requireGeometry && !probe.rendered?.visible) { evidence.events.push(`① ${name}按钮几何降级：追问表单未显示（该讨论尚无已完成轮次），结构已核（img 存在）`); continue; }
  if (Math.round(probe.rendered.width) !== 28) die(`① ${name}纹样渲染宽应为 28px，实测 ${probe.rendered.width}`);
  if (!probe.rendered.naturalOk) die(`① ${name}img 原始尺寸应为 988×789，实测不符: ${JSON.stringify(probe)}`);
  const expect = 988 / 789;
  if (Math.abs(probe.ratio - expect) > 0.02) die(`① ${name}纹样高宽比应约 ${expect.toFixed(4)}，实测 ${probe.ratio?.toFixed(4)}`);
  if (!probe.rendered.visible || !probe.rendered.complete) die(`① ${name}纹样不可见或未完成加载: ${JSON.stringify(probe)}`);
}

// ---------- ④ 窗口头无收起按钮；停靠区 ✕ 收起后讨论保留 ----------
const head4 = await evaluate(`(() => {
  const win = document.querySelector(".ai-window");
  const head = win?.querySelector('.ai-window-head');
  return {
    windowOpen: !!win && win.getClientRects().length > 0,
    closeRoleInHead: head ? !!head.querySelector('[data-role="close"]') : null,
    closeClassInHead: head ? !!head.querySelector(".ai-win-btn-close") : null,
    dockCollapse: !!document.getElementById("ai-dock-collapse"),
  };
})()`);
evidence.assertions["④ 收起入口唯一"] = { head: head4 };
if (head4.closeRoleInHead !== false || head4.closeClassInHead !== false) die(`④ 讨论窗口头不得承载收起按钮: ${JSON.stringify(head4)}`);
if (!head4.dockCollapse) die("④ 停靠区头 ✕（#ai-dock-collapse）应存在");
const discussionId = await evaluate(`(() => { const win = document.querySelector(".ai-window"); return win?.dataset?.conversationId ?? null; })()`);
await click("#ai-dock-collapse");
await sleep(400);
const collapsed = await evaluate(`(() => { const dock = document.getElementById("ai-dock"); const list = document.getElementById("ai-conversation-list"); return { panelHidden: dock.classList.contains("hidden"), listExists: !!list }; })()`);
if (!collapsed.panelHidden) die("④ 停靠区头 ✕ 未收起面板");
// 重开面板并确认讨论仍在列表（生成不中断需真实 API，按设计降级并如实记录）。
await click("#btn-toggle-ai");
await sleep(400);
await click("#ai-conversation-list-toggle");
await sleep(400);
const stillThere = await evaluate(`(() => { const rows = Array.from(document.querySelectorAll(".ai-cl-row")); return rows.length; })()`);
evidence.assertions["④ 收起入口唯一"].collapse = {
  discussionIdBeforeCollapse: discussionId,
  panelHiddenAfterCollapse: collapsed.panelHidden,
  conversationRowsAfterReopen: stillThere,
  generationContinuity: "degraded: no live request（生成不中断需真实 API；以收起后讨论仍在列表、可重开为降级断言）",
};
if (!Number.isInteger(stillThere) || stillThere < 1) die("④ 收起后重开，讨论列表为空（讨论应保留）");

evidence.passed = true;
dump();
console.log(`STEP_OK 四条级联回归断言全部通过（证据: verification/smoke-tooltip-ownership.json）`);
ws.close();
process.exit(0);
