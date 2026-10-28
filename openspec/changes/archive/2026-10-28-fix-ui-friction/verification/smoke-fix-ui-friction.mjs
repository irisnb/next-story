// smoke-fix-ui-friction.mjs — fix-ui-friction-2026-10 任务 7.2 真机冒烟（CDP 端到端，自动化部分）。
//
// 方法（沿 2026-10-22 allow-empty-chain 冒烟与 2026-10-10 fix-ai-and-making-usability 既有惯例）：
// - 应用以 `npm run tauri:dev` + WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9223 启动；
// - 本脚本经 CDP WebSocket 连 Next Story 页面目标（cdp-client.mjs，与归档同款）；
// - 点击＝真实鼠标事件（Input.dispatchMouseEvent）；键盘＝Input.dispatchKeyEvent（Enter/Esc 真实键序）；
//   版本下拉选择沿 allow-empty-chain 先例用 evaluate 派发 change（如实记录改道）；
// - DOM 查询只走 Runtime.evaluate 只读；视觉证据＝Page.captureScreenshot；断言证据落 smoke-evidence.json；
// - 全部确认点均为应用内自绘确认窗（dialog.app-confirm），无需覆写 window.confirm；
// - 第 2 版链路经 __TAURI_INTERNALS__.invoke('chain_save_version') 驱动侧注入（沿 allow-empty-chain
//   S5 先例，绕过制作对话，如实注明注入方式）。
//
// 场景（对任务 7.2 验收清单的自动化覆盖；执行顺序按链路依赖微调，删除链路兼做清理）：
//   场景1 开发者菜单消失：讨论列表打开后头部无「⋯」（#ai-dock-more / aria-label=更多讨论操作 均无）；
//          窄轨（收起面板）无「更多」按钮；window.__waitTiming 已下线。
//   场景2 最大化头部贴边：新建讨论→最大化→头部通栏（≈面板内容宽，非 760 限宽）、动作组钉面板右缘；
//          正文/输入区仍 760px 限宽居中（getBoundingClientRect 判定）；恢复常宽后头部仍通栏。
//   场景4 制作页主按钮三态（先于场景3 执行，为删除链路准备对象）：零卡第1版＝启用语义→常规确认窗
//          （几何断言）→启用；注入第2版→启用第2版（确认含「替换当前」文案）；查看第1版（历史版本）＝
//          「回退到…」（回退语义需启用指针指向更晚版本，故停用检查移至回退断言之后）；回到第2版停用
//          →未启用态恒启用语义。
//   场景3 确认窗统一（危险变体＋键盘；常规变体几何已在场景4 的启用确认断言）：删除链路→
//          danger 变体＋两按钮几何一致（≈128×40）＋文案明示不可恢复；Esc 取消→链路仍在；
//          再触发→Enter 确认→链路删除（兼清理）。
//   场景5 AI 可见性关闭确认（danger）：文件管理关闭一篇「可读」文档的 AI 可见性→若该文档被讨论
//          使用过（或使用情况未知）则出 danger 确认窗（Esc 取消不改状态）；若项目内无可触发文档
//          （无使用记录则不弹确认、直接翻转）则有一次可还原的翻转并如实转「需人工验证」。
//   附加 700px 窄幅不换行（tasks 7.2「700px 窄幅」）：Win32 缩窗至导图区 640–760px 带宽后断言
//          操作区上行双状态标注与下行控件各自完整、同线不换行；缩窗不可用或落不进带宽则转人工。
//   收尾 控制台零错误断言＋「需人工验证」清单输出（不伪造自动化通过）。
//
// 运行前置：
// 1) PowerShell（项目根）：
//      $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS='--remote-debugging-port=9223'
//      npm run tauri:dev
//    （应用编译启动可能数分钟；脚本按归档惯例重试连接最长 5 分钟）
// 2) 欢迎页「最近项目」列表非空（脚本自动打开第一条；场景2/5 需要已打开项目）。
// 3) 应用窗口保持默认桌面尺寸（建议 ≥1280px 宽；场景2 要求最大化后面板内容宽 ≥860px）。
// 4) 本脚本不发送任何模型请求、不写任何用户文档正文；只创建并删除本脚本自己的冒烟链路；
//    场景2 点一次「新建讨论」（空讨论不发送、不落盘）；场景5 只做「确认后取消」或可还原翻转。
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { connect } from './cdp-client.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const OUT = join(here, 'evidence');
mkdirSync(OUT, { recursive: true });

const CHAIN_NAME = 'UI摩擦冒烟-fix-ui-friction';
const APP_DATA = process.env.LOCALAPPDATA + '\\com.nextstory.desktop';
const CHAINS_FILE = join(APP_DATA, 'making-module', 'chains.json');
const PS1 = join(here, 'ns-resize.ps1');

// 几何容差：覆盖 DPR 缩放下的 CSS px 取整（±1.5）；居中/对齐判定 ±2。
const TOL = 1.5;

// ========== 连接（应用编译启动可能需要数分钟，重试等待） ==========

async function connectWithRetry(totalMs = 300000) {
  const deadline = Date.now() + totalMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      return await connect(9223);
    } catch (error) {
      lastError = error;
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
  throw new Error('CDP 连接超时（应用未启动或 9223 调试通道未开）: ' + lastError?.message);
}

const cdp = await connectWithRetry();

// ========== 证据框架（沿归档输出风格：分场景、中文结果、汇总退出码） ==========

const ev = {
  startedAt: new Date().toISOString(),
  target: cdp.target,
  chainName: CHAIN_NAME,
  assertions: [],
  stages: [],
  screenshots: [],
  consoleErrors: [],
  confirms: [],
  captured: {},
  environmentNotes: [],
  manualSteps: [],
  fatal: null,
};
const T0 = Date.now();
const failures = [];
const assert = (name, pass, detail) => {
  ev.assertions.push({ name, pass: !!pass, detail });
  if (!pass) failures.push(name);
  console.log(`${pass ? 'PASS' : 'FAIL'} ${name}${detail !== undefined ? ' | ' + JSON.stringify(detail).slice(0, 220) : ''}`);
};
const mark = (name, data) => { ev.stages.push({ name, t: Date.now() - T0, data }); console.log(`---- ${name} @${Date.now() - T0}ms`); };
const shot = async (n) => { const f = join(OUT, `${n}.png`); await cdp.screenshot(f); ev.screenshots.push(`${n}.png`); return f; };

const wait = async (desc, probe, { timeoutMs = 20000, intervalMs = 500 } = {}) => {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    last = await probe();
    if (last) return last;
    await cdp.pause(intervalMs);
  }
  throw new Error(`等待超时(${timeoutMs}ms): ${desc}；最后状态=${JSON.stringify(last ?? null).slice(0, 300)}`);
};

// 真实键盘（沿 2026-10-10 undo-notice-geometry / making-naming-native 先例）。
const pressEsc = async () => {
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 });
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 });
  await cdp.pause(250);
};
const pressEnter = async () => {
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13, text: '\r', unmodifiedText: '\r' });
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
  await cdp.pause(250);
};

// ========== 磁盘断言（只读；链路库为全局文件，与归档冒烟同一路径） ==========

// 同名链路取最后一条（若上次冒烟中断残留同名链路，新链路总在列表末尾；如实记录重复数）。
function diskChain() {
  const j = JSON.parse(readFileSync(CHAINS_FILE, 'utf8'));
  const matched = j.chains.filter((x) => x.name === CHAIN_NAME);
  const c = matched[matched.length - 1];
  return {
    active: j.active ?? null,
    dupCount: matched.length,
    chainFound: !!c,
    chainId: c?.id ?? null,
    versions: (c?.versions ?? []).map((v) => ({
      id: v.id, index: v.index, cards: v.cards.length, changeNote: v.change_note ?? '',
    })),
  };
}

// ========== 页面探针（只读） ==========

// 场景1：开发者菜单残留探针。
const devMenuProbe = () => cdp.evaluate(`(() => {
  const label = (b) => ((b.getAttribute('aria-label') || '') + ' ' + (b.getAttribute('title') || '') + ' ' + (b.textContent || '')).trim();
  const listEl = document.getElementById('ai-conversation-list');
  const rail = document.getElementById('ai-dock-rail');
  return {
    dockMoreBtn: !!document.getElementById('ai-dock-more'),
    railMoreBtn: !!document.getElementById('ai-rail-more'),
    moreAria: !!document.querySelector('[aria-label="更多讨论操作"]'),
    dockDots: [...document.querySelectorAll('#ai-dock button')].filter((b) => /⋯|更多讨论操作/.test(label(b))).map(label),
    waitTimingGlobal: typeof globalThis.__waitTiming,
    listOpen: !!listEl && !listEl.classList.contains('hidden') && listEl.getBoundingClientRect().width > 0,
    listHeaderButtons: listEl ? [...listEl.querySelectorAll('button')].map((b) => label(b)).filter(Boolean) : [],
    railVisible: !!rail && !rail.classList.contains('hidden') && rail.getBoundingClientRect().width > 0,
    railButtons: rail ? [...rail.querySelectorAll('button')].map((b) => label(b)).filter(Boolean) : [],
  };
})()`);

// 场景2：面板与讨论窗口几何探针。
const panelGeometry = () => cdp.evaluate(`(() => {
  const dock = document.getElementById('ai-dock');
  const win = document.querySelector('#ai-dock-body .ai-window');
  if (!dock || !win) return { missing: true };
  const head = win.querySelector('.ai-window-head');
  const actions = win.querySelector('.ai-window-actions');
  const body = win.querySelector('.ai-window-body');
  const input = win.querySelector('.ai-window-input');
  const R = (e) => { if (!e) return null; const b = e.getBoundingClientRect(); return { left: +b.left.toFixed(2), right: +b.right.toFixed(2), width: +b.width.toFixed(2), center: +((b.left + b.right) / 2).toFixed(2) }; };
  return {
    maximized: dock.classList.contains('ai-panel-maximized'),
    dock: R(dock), win: R(win), head: R(head), actions: R(actions), body: R(body), input: R(input),
    headPadRight: head ? parseFloat(getComputedStyle(head).paddingRight) : null,
  };
})()`);

// 制作页状态探针（fix-ui-friction 后的元素契约：#making-primary-btn 三态、无旧启停按钮）。
const makingState = () => cdp.evaluate(`(() => {
  const byId = (id) => document.getElementById(id);
  const vis = (e) => !!e && !e.classList.contains('hidden') && !e.hidden && e.getBoundingClientRect().width > 0;
  const R = (e) => { if (!e) return null; const b = e.getBoundingClientRect(); return { left: +b.left.toFixed(2), right: +b.right.toFixed(2), top: +b.top.toFixed(2), bottom: +b.bottom.toFixed(2), cy: +(b.top + b.height / 2).toFixed(2), width: +b.width.toFixed(2) }; };
  const row = document.querySelector('.making-operations-actions');
  const identity = document.querySelector('.making-operations-identity');
  const inspector = byId('making-inspector');
  const content = byId('making-inspector-content');
  return {
    makingVisible: vis(byId('module-making')),
    statusActive: vis(byId('making-status-active')),
    statusText: (byId('making-status-text')?.textContent ?? '').trim(),
    statusIdle: vis(byId('making-status-idle')),
    statusError: vis(byId('making-status-error')) ? (byId('making-status-error')?.textContent ?? '').trim() : null,
    inspectorTitle: (byId('making-inspector-title')?.textContent ?? '').trim(),
    inspectorState: (byId('making-inspector-state')?.textContent ?? '').trim(),
    usingLabel: (document.querySelector('.making-version-using')?.textContent ?? '').trim(),
    versionOptions: [...document.querySelectorAll('#making-version-select option')].map((o) => o.textContent.trim()),
    viewedVersion: byId('making-version-select')?.value ?? null,
    primaryText: (byId('making-primary-btn')?.textContent ?? '').trim(),
    primaryVisible: vis(byId('making-primary-btn')),
    oldEnableBtn: !!byId('making-enable-btn'),
    oldDeactivateBtn: !!byId('making-deactivate-btn'),
    statusBarButtons: document.querySelectorAll('#making-status-bar button').length,
    chainRows: [...document.querySelectorAll('#making-chain-list .making-chain-row')].map((b) => ({
      name: b.querySelector('.making-chain-row-name')?.textContent ?? '',
      status: b.querySelector('.making-chain-row-status')?.textContent ?? '',
      selected: b.classList.contains('selected'),
    })),
    operations: {
      inspectorWidth: inspector ? +inspector.getBoundingClientRect().width.toFixed(2) : null,
      contentRight: content ? +content.getBoundingClientRect().right.toFixed(2) : null,
      rowTop: row ? +row.getBoundingClientRect().top.toFixed(2) : null,
      rowRight: row ? +row.getBoundingClientRect().right.toFixed(2) : null,
      identityBottom: identity ? +identity.getBoundingClientRect().bottom.toFixed(2) : null,
      select: R(byId('making-version-select')),
      del: R(byId('making-delete-chain-btn')),
      pri: R(byId('making-primary-btn')),
    },
  };
})()`);

// 应用内确认窗探针（dialog.app-confirm；几何、变体与居中一并读取）。
const confirmDialogState = () => cdp.evaluate(`(() => {
  const d = document.querySelector('dialog.app-confirm');
  if (!d) return { open: false };
  const cancel = d.querySelector('.app-confirm-cancel');
  const accept = d.querySelector('.app-confirm-accept');
  const R = (e) => { if (!e) return null; const b = e.getBoundingClientRect(); return { width: +b.width.toFixed(2), height: +b.height.toFixed(2) }; };
  const db = d.getBoundingClientRect();
  return {
    open: d.open,
    danger: d.classList.contains('app-confirm-danger'),
    title: (d.querySelector('h3')?.textContent ?? '').trim(),
    body: (d.querySelector('p')?.textContent ?? '').trim(),
    cancelLabel: (cancel?.textContent ?? '').trim(),
    acceptLabel: (accept?.textContent ?? '').trim(),
    acceptFocused: document.activeElement === accept,
    cancelRect: R(cancel),
    acceptRect: R(accept),
    cancelBg: cancel ? getComputedStyle(cancel).backgroundColor : null,
    acceptBg: accept ? getComputedStyle(accept).backgroundColor : null,
    dialogRect: { l: +db.left.toFixed(1), t: +db.top.toFixed(1), r: +db.right.toFixed(1), b: +db.bottom.toFixed(1) },
    viewport: [innerWidth, innerHeight],
  };
})()`);

// 场景5：文件管理 AI 可见性开关探针。
const fmState = () => cdp.evaluate(`(() => {
  const vis = (e) => !!e && !e.classList.contains('hidden') && e.getBoundingClientRect().width > 0;
  const toggles = [...document.querySelectorAll('#fm-file-tree .file-ai-visibility-toggle')].map((b) => ({
    nodeId: b.closest('.file-row')?.dataset.nodeId ?? null,
    checked: b.getAttribute('aria-checked'),
  }));
  return { filesVisible: vis(document.getElementById('module-files')), toggles };
})()`);

// ========== 通用动作 ==========

const gotoTab = async (id) => { await cdp.evaluate(`document.getElementById(${JSON.stringify(id)})?.click()`); await cdp.pause(600); };

// 制作页就绪探针（沿归档：欢迎页不在场且模块宽度>0）。
const makingReady = async () => {
  for (let i = 0; i < 40; i++) {
    const ready = await cdp.evaluate(`(() => {
      const welcome = document.getElementById('welcome-page');
      const making = document.getElementById('module-making');
      const welcomeHidden = !welcome || welcome.classList.contains('hidden');
      return welcomeHidden && !!making && making.getBoundingClientRect().width > 0;
    })()`);
    if (ready) return true;
    await cdp.pause(250);
  }
  return false;
};

// 链路行按名称找（取最后一条匹配，配合同名残留防御）。
const selectChain = async () => {
  await cdp.evaluate(`(() => { const rows=[...document.querySelectorAll('#making-chain-list .making-chain-row')].filter((x)=>(x.querySelector('.making-chain-row-name')?.textContent??'').trim()===${JSON.stringify(CHAIN_NAME)}); const b=rows[rows.length-1]; b?.click(); })()`);
  await cdp.pause(600);
};

// 版本下拉选择（沿 allow-empty-chain S5 先例：evaluate 派发 change，如实记录）。
const setVersionByLabel = async (labelPart) => {
  const ok = await cdp.evaluate(`(() => { const s=document.querySelector('#making-version-select'); if(!s) return false; const opt=[...s.options].find((o)=>o.textContent.includes(${JSON.stringify(labelPart)})); if(!opt) return false; s.value=opt.value; s.dispatchEvent(new Event('change',{bubbles:true})); return true; })()`);
  await cdp.pause(500);
  return ok;
};

const waitConfirmOpen = async (label) => wait(label, async () => {
  const d = await confirmDialogState();
  return d.open ? d : null;
}, { timeoutMs: 8000 });

const waitConfirmClosed = async () => wait('确认窗关闭', async () => {
  const d = await confirmDialogState();
  return !d.open ? true : null;
}, { timeoutMs: 8000 });

// 确认窗共同断言：应用内 dialog、两按钮几何一致（≈128×40）、打开即聚焦确认、仅颜色不同。
function assertConfirmCommon(st, name, { danger }) {
  assert(`${name}.确认窗为应用内 dialog.app-confirm`, !!st && st.open === true, { open: st?.open });
  assert(`${name}.变体正确（${danger ? 'danger' : '常规'}）`, danger ? st.danger === true : st.danger === false, { danger: st.danger });
  const c = st.cancelRect, a = st.acceptRect;
  assert(`${name}.按钮几何≈128×40（两键一致）`,
    !!c && !!a && Math.abs(c.width - 128) <= TOL && Math.abs(c.height - 40) <= TOL && Math.abs(a.width - 128) <= TOL && Math.abs(a.height - 40) <= TOL && Math.abs(c.width - a.width) <= 1 && Math.abs(c.height - a.height) <= 1,
    { cancel: c, accept: a });
  assert(`${name}.打开即聚焦确认按钮`, st.acceptFocused === true, { acceptFocused: st.acceptFocused });
  assert(`${name}.取消与确认仅颜色不同`, !!st.cancelBg && !!st.acceptBg && st.cancelBg !== st.acceptBg, { cancelBg: st.cancelBg, acceptBg: st.acceptBg });
  const dRect = st.dialogRect, vp = st.viewport;
  assert(`${name}.确认窗居中（±2px，不贴左上角）`,
    !!dRect && !!vp && Math.abs((dRect.l + dRect.r) / 2 - vp[0] / 2) <= 2 && Math.abs((dRect.t + dRect.b) / 2 - vp[1] / 2) <= 2,
    { dialogRect: dRect, viewport: vp });
}

// 操作区下行控件同线（不换行）断言，默认宽度与窄幅共用。
function assertOperationsSingleLine(st, name) {
  const o = st.operations;
  const okLine = !!o.select && !!o.del && !!o.pri &&
    Math.abs(o.select.cy - o.pri.cy) <= 6 && Math.abs(o.del.cy - o.pri.cy) <= 6;
  const okOverflow = !!o.pri && o.pri.right <= o.contentRight + TOL;
  assert(`${name}.操作区下行控件同线不换行`, okLine, { selectCy: o.select?.cy, delCy: o.del?.cy, priCy: o.pri?.cy });
  assert(`${name}.主按钮未被挤出操作区`, okOverflow, { priRight: o.pri?.right, contentRight: o.contentRight });
}

// ========== 人工清单（运行中按情况追加；不伪造自动化通过） ==========

ev.manualSteps.push('【人工】7.2 归档门槛的「用户真实点击」复核：请用户亲手完成一次启用确认（Enter 确认/Esc 取消）与一次删除链路确认，体感键盘行为、焦点与脚本断言一致。');
ev.manualSteps.push('【人工】写作页「删除有未保存修改的文档」确认（danger 变体）：需脏文档与删除入口联动，本脚本未自动化；请人工删除一篇有未保存修改的文档，确认弹应用内确认窗（危险变体）、取消不删除。');
ev.manualSteps.push('【人工】制作页「删卡」与「删制作会话」确认（常规/危险变体）：请人工各触发一次，确认同为应用内确认窗、按钮几何一致（≈128×40）、取消不执行。');
ev.manualSteps.push('【人工】场景2 视觉比对：最大化后头部贴边、正文保持稿纸宽度的整体观感（脚本已做几何断言，归档门槛另需视觉比对截图确认）。');

// ========== 步骤执行 ==========

let chainId = null;
let v1Id = null;

try {
  // ---------- P0 项目就绪：欢迎页则打开最近项目第一条（既有项目） ----------
  try {
    const welcome = await cdp.evaluate(`(() => { const w=document.getElementById('welcome-page'); return !!w && !w.classList.contains('hidden'); })()`);
    if (welcome) {
      const recentCount = await cdp.evaluate(`document.querySelectorAll('#recent-works-list .recent-work-item').length`);
      assert('P0.最近项目列表非空', recentCount > 0, recentCount);
      if (recentCount === 0) throw new Error('最近项目列表为空（场景2/5 需要已打开项目）');
      await cdp.evaluate(`document.querySelector('#recent-works-list .recent-work-item')?.click()`);
      await wait('项目打开（编辑页出现）', async () => cdp.evaluate(`(() => { const e=document.getElementById('editor-page'); const w=document.getElementById('welcome-page'); return !!e && !e.classList.contains('hidden') && !!w?.classList.contains('hidden'); })()`), { timeoutMs: 90000 });
      await cdp.pause(1500);
    }
    ev.captured.projectName = await cdp.evaluate(`(document.getElementById('current-project-name')?.textContent ?? '').trim()`);
    mark('P0 项目就绪', { projectName: ev.captured.projectName, viaWelcome: welcome });
    assert('P0.已进入既有项目', (ev.captured.projectName ?? '').length > 0, ev.captured.projectName);
  } catch (error) { ev.fatal = 'P0: ' + error.message; ev.stages.push({ name: 'P0-fatal', error: error.message }); }

  // ---------- 场景1 开发者菜单消失 ----------
  if (!ev.fatal) try {
    await gotoTab('tab-writing');
    // 面板可见性
    const dockVisible = await cdp.evaluate(`(() => { const d=document.querySelector('#ai-dock'); return !!d && !d.classList.contains('hidden') && d.getBoundingClientRect().width>0; })()`);
    if (!dockVisible) { await cdp.evaluate(`document.getElementById('btn-toggle-ai')?.click()`); await cdp.pause(600); }
    // 打开讨论列表
    const listHidden = await cdp.evaluate(`document.querySelector('#ai-conversation-list')?.classList.contains('hidden') ?? true`);
    if (listHidden) { await cdp.evaluate(`document.getElementById('ai-conversation-list-toggle')?.click()`); await cdp.pause(500); }
    const st1 = await wait('讨论列表打开', async () => (await devMenuProbe()).listOpen ? devMenuProbe() : null, { timeoutMs: 10000 });
    mark('场景1 列表打开', { listHeaderButtons: st1.listHeaderButtons });
    assert('场景1.#ai-dock-more 不存在', st1.dockMoreBtn === false, st1.dockMoreBtn);
    assert('场景1.无 aria-label=更多讨论操作 按钮', st1.moreAria === false, st1.moreAria);
    assert('场景1.面板内无「⋯/更多讨论操作」按钮', st1.dockDots.length === 0, st1.dockDots);
    assert('场景1.window.__waitTiming 已下线', st1.waitTimingGlobal === 'undefined', st1.waitTimingGlobal);
    await shot('场景1-讨论列表头部无更多菜单');
    // 收起面板 → v5 折叠态（顶栏入口恢复；旧竖条已按 conversation-list 规格「不保留旧竖条」下线）
    await cdp.evaluate(`document.getElementById('ai-conversation-list-close')?.click()`);
    await cdp.pause(300);
    await cdp.click('#ai-dock-collapse');
    await wait('面板已收起', async () => cdp.evaluate(`(() => { const d=document.getElementById('ai-dock'); return !!d && (d.classList.contains('hidden') || d.getBoundingClientRect().width===0); })()`), { timeoutMs: 10000 });
    const railProbe = await devMenuProbe();
    mark('场景1 折叠态', { railVisible: railProbe.railVisible, railButtons: railProbe.railButtons });
    assert('场景1.旧竖条不可见（v5 折叠态不保留竖条）', railProbe.railVisible === false, railProbe.railVisible);
    assert('场景1.#ai-rail-more 不存在（DOM）', railProbe.railMoreBtn === false, railProbe.railMoreBtn);
    assert('场景1.竖条 DOM 内无「更多/⋯」按钮', !railProbe.railButtons.some((b) => /更多|⋯/.test(b)), railProbe.railButtons);
    await shot('场景1-折叠态无更多入口');
    // 经顶栏 AI 入口展开恢复，为场景2 铺路（v5 恢复路径）
    await cdp.evaluate(`document.getElementById('btn-toggle-ai')?.click()`);
    await wait('面板展开', async () => cdp.evaluate(`(() => { const d=document.getElementById('ai-dock'); return !!d && !d.classList.contains('hidden') && d.getBoundingClientRect().width>0; })()`), { timeoutMs: 10000 });
    await cdp.pause(400);
  } catch (error) { ev.fatal = '场景1: ' + error.message; ev.stages.push({ name: '场景1-fatal', error: error.message }); }

  // ---------- 场景2 最大化头部贴边 ----------
  if (!ev.fatal) try {
    // 新建讨论（空讨论，不发送）
    const listHidden = await cdp.evaluate(`document.querySelector('#ai-conversation-list')?.classList.contains('hidden') ?? true`);
    if (listHidden) { await cdp.evaluate(`document.getElementById('ai-conversation-list-toggle')?.click()`); await cdp.pause(500); }
    await cdp.evaluate(`document.getElementById('ai-list-new-conversation')?.click()`);
    await cdp.pause(800);
    await wait('直接提问表单出现（讨论窗口在场）', async () => cdp.evaluate(`!!document.querySelector('#ai-dock-body .ai-window [data-role="direct-question"]') && !document.querySelector('#ai-dock-body .ai-window [data-role="direct-question"]')?.classList.contains('hidden')`), { timeoutMs: 15000 });
    ev.environmentNotes.push('场景2 点了一次「新建讨论」：空讨论不发送、不落盘，保留在面板中。');
    // 关闭列表，避免遮挡几何测量
    await cdp.evaluate(`document.getElementById('ai-conversation-list-close')?.click()`);
    await cdp.pause(400);
    const pre = await panelGeometry();
    mark('场景2 常宽基线', { maximized: pre.maximized, win: pre.win?.width, head: pre.head?.width });
    // 最大化
    await cdp.click('#ai-dock-maximize');
    const geo = await wait('最大化类挂载', async () => (await panelGeometry()).maximized ? panelGeometry() : null, { timeoutMs: 10000 });
    await cdp.pause(400);
    const g = await panelGeometry();
    ev.captured.maxGeometry = g;
    mark('场景2 最大化几何', { dock: g.dock, win: g.win, head: g.head, actions: g.actions, body: g.body, input: g.input, headPadRight: g.headPadRight });
    assert('场景2.前置.最大化窗口足够宽（≥860px）', g.win && g.win.width >= 860, { winWidth: g.win?.width });
    assert('场景2.头部通栏（宽≈窗口宽）', g.head && Math.abs(g.head.width - g.win.width) <= 2, { head: g.head?.width, win: g.win?.width });
    assert('场景2.头部不受 760 限宽', g.head && g.head.width > 800, { head: g.head?.width });
    const anchorRight = g.head ? +(g.head.right - (g.headPadRight ?? 0)).toFixed(2) : null;
    assert('场景2.动作组右缘钉在头部内容右缘（差≤2px）', g.actions && anchorRight !== null && Math.abs(g.actions.right - anchorRight) <= 2, { actionsRight: g.actions?.right, anchorRight });
    assert('场景2.动作组未悬在 760 内容列（距面板右缘≤26px）', g.dock && g.actions && g.dock.right - g.actions.right <= 26, { dockRight: g.dock?.right, actionsRight: g.actions?.right, gap: g.dock && g.actions ? +(g.dock.right - g.actions.right).toFixed(2) : null });
    assert('场景2.正文区 760 限宽居中', g.body && Math.abs(g.body.width - 760) <= 2 && Math.abs(g.body.center - g.win.center) <= 2, { body: g.body, winCenter: g.win.center });
    assert('场景2.输入区 760 限宽居中', g.input && Math.abs(g.input.width - 760) <= 2 && Math.abs(g.input.center - g.win.center) <= 2, { input: g.input, winCenter: g.win.center });
    await shot('场景2-最大化头部贴边');
    // 恢复常宽
    await cdp.click('#ai-dock-maximize');
    const restored = await wait('恢复常宽', async () => { const s = await panelGeometry(); return !s.maximized ? s : null; }, { timeoutMs: 10000 });
    await cdp.pause(400);
    const r = await panelGeometry();
    ev.captured.restoreGeometry = { win: r.win, head: r.head };
    assert('场景2.恢复常宽后头部仍通栏', r.head && Math.abs(r.head.width - r.win.width) <= 2, { head: r.head?.width, win: r.win?.width });
    // 验收补充（2026-10-28 用户报告）：共享提示独占——最大化/恢复按钮不得同时出现
    // Basecoat 伪元素提示与共享提示（双黑提示），也不得并存原生 title。
    const tip = await cdp.evaluate(`(() => { const b=document.getElementById('ai-dock-maximize'); return { before: getComputedStyle(b,'::before').display, after: getComputedStyle(b,'::after').display, title: b.getAttribute('title') }; })()`);
    assert('场景2.最大化按钮无双提示（伪元素已关、无原生title）', tip.before === 'none' && tip.after === 'none' && !tip.title, tip);
    await shot('场景2-恢复常宽');
  } catch (error) { ev.fatal = '场景2: ' + error.message; ev.stages.push({ name: '场景2-fatal', error: error.message }); }

  // ---------- 场景4 制作页主按钮三态（含常规确认窗几何） ----------
  if (!ev.fatal) try {
    await gotoTab('tab-making');
    await wait('制作页可见', async () => (await makingState()).makingVisible, { timeoutMs: 15000 });
    await makingReady();
    // 链路库可能收拢（中等宽度）：新建按钮不可见时先开库
    if (!(await cdp.evaluate(`(() => { const b=document.getElementById('making-new-chain-btn'); const vis=(e)=>!!e&&!e.classList.contains('hidden')&&e.getBoundingClientRect().width>0; return vis(b); })()`))) {
      await cdp.evaluate(`document.getElementById('making-library-toggle')?.click()`);
      await cdp.pause(500);
    }
    // 同名残留防御：若上次中断残留同名链路，如实记录（本脚本取名最后一条）
    if (diskChain().chainFound) ev.environmentNotes.push('发现同名残留链路（上次冒烟未清理）：' + JSON.stringify(diskChain().versions) + '；本次选择列表末尾的新建链路，残留请在结果中人工删除。');
    await cdp.click('#making-new-chain-btn');
    await wait('新建链路表单出现', async () => cdp.evaluate(`(() => { const f=document.getElementById('making-new-chain-form'); return !!f && !f.classList.contains('hidden'); })()`), { timeoutMs: 8000 });
    await cdp.fillText('#making-new-chain-name', CHAIN_NAME);
    await cdp.click('#making-new-chain-confirm');
    const st4 = await wait('链路出现并选中（零卡第1版）', async () => {
      const s = await makingState();
      const rows = s.chainRows.filter((r) => r.name === CHAIN_NAME);
      return rows.length > 0 && rows[rows.length - 1].selected ? s : null;
    }, { timeoutMs: 20000 });
    const d4 = await wait('磁盘链路落库', () => { const d = diskChain(); return d.chainFound ? d : null; }, { timeoutMs: 15000 });
    chainId = d4.chainId;
    v1Id = d4.versions.find((v) => v.index === 1)?.id ?? null;
    mark('场景4 零卡第1版', { inspectorTitle: st4.inspectorTitle, primaryText: st4.primaryText, versions: d4.versions, dupCount: d4.dupCount });
    assert('场景4.诞生即第1版零卡', d4.versions.length === 1 && d4.versions[0].index === 1 && d4.versions[0].cards === 0, d4.versions);
    assert('场景4.未启用态主按钮＝启用语义', st4.primaryText === `启用「${CHAIN_NAME}·第1版」`, st4.primaryText);
    assert('场景4.旧独立启用按钮不存在', st4.oldEnableBtn === false, st4.oldEnableBtn);
    assert('场景4.旧独立停用按钮不存在', st4.oldDeactivateBtn === false, st4.oldDeactivateBtn);
    assert('场景4.状态条不承担启停入口', st4.statusBarButtons === 0, st4.statusBarButtons);
    assertOperationsSingleLine(st4, '场景4.默认宽度');
    await shot('场景4-零卡第1版启用语义');

    // 4b 启用第1版：常规确认窗（几何断言）→ 真实点击确认
    await cdp.click('#making-primary-btn');
    const c4b = await waitConfirmOpen('启用第1版确认窗');
    ev.confirms.push({ step: '场景4-启用第1版', state: c4b });
    assertConfirmCommon(c4b, '场景4.启用确认', { danger: false });
    assert('场景4.启用确认标题正确', c4b.title === `启用「${CHAIN_NAME}·第1版」？`, c4b.title);
    assert('场景4.启用确认文案含零卡说明', c4b.body.includes('不含任何卡') && c4b.body.includes('不附加自定义内容'), c4b.body);
    assert('场景4.确认按钮文案＝启用', c4b.acceptLabel === '启用', c4b.acceptLabel);
    await shot('场景4-启用确认窗常规变体');
    await cdp.click('dialog.app-confirm .app-confirm-accept');
    const st4b = await wait('状态条切换为已启用第1版', async () => {
      const s = await makingState();
      return s.statusActive && s.statusText === `当前链路：${CHAIN_NAME}·第1版（未附加自定义）` ? s : null;
    }, { timeoutMs: 20000 });
    mark('场景4 启用完成', { statusText: st4b.statusText, primaryText: st4b.primaryText, usingLabel: st4b.usingLabel, inspectorState: st4b.inspectorState });
    assert('场景4.查看启用版主按钮＝停用当前链路', st4b.primaryText === '停用当前链路', st4b.primaryText);
    assert('场景4.两态并标（正在查看＋正在使用）', st4b.inspectorTitle === `正在查看：${CHAIN_NAME}·第1版` && st4b.usingLabel.includes(`正在使用：${CHAIN_NAME}·第1版`) && st4b.inspectorState === '当前启用版本', { title: st4b.inspectorTitle, using: st4b.usingLabel, state: st4b.inspectorState });
    await shot('场景4-查看启用版停用语义');

    // 4c 注入第2版（沿 allow-empty-chain S5 先例）→ 真实 UI 启用第2版（替换文案）
    const invokeAvail = await cdp.evaluate(`typeof window.__TAURI_INTERNALS__ === 'object' && typeof window.__TAURI_INTERNALS__.invoke === 'function'`);
    assert('场景4.注入通道可用(__TAURI_INTERNALS__.invoke)', invokeAvail === true, invokeAvail);
    if (!invokeAvail) throw new Error('__TAURI_INTERNALS__.invoke 不可用，无法注入第2版');
    const args = {
      chainId,
      cards: [{
        title: '摩擦冒烟卡-给可能性',
        trigger_desc: '适用：讨论情节走向时\n不适用：只聊单句台词时',
        body: '回应里至少给出两种不同可能，说明各自依据与代价，不替用户拍板。',
        slot_type: 'requirement',
      }],
      changeNote: 'fix-ui-friction 真机冒烟注入（沿 allow-empty-chain S5 先例）',
    };
    ev.captured.injectedArgs = args;
    await cdp.evaluate(`window.__TAURI_INTERNALS__.invoke('chain_save_version', ${JSON.stringify(args)})`);
    await gotoTab('tab-writing');
    await gotoTab('tab-making');
    await makingReady();
    await selectChain();
    const d4c = await wait('磁盘出现第2版', () => { const d = diskChain(); return d.versions.length >= 2 && d.versions.some((v) => v.index === 2) ? d : null; }, { timeoutMs: 15000 });
    const v2Id = d4c.versions.find((v) => v.index === 2)?.id ?? null;
    mark('场景4 注入第2版落库', { versions: d4c.versions, active: d4c.active });
    assert('场景4.第2版含一张卡', d4c.versions.find((v) => v.index === 2)?.cards === 1, d4c.versions.find((v) => v.index === 2));
    assert('场景4.注入未动启用指针（仍第1版）', d4c.active?.version_id === v1Id, d4c.active);
    await setVersionByLabel('第2版');
    const pre4c = await makingState();
    assert('场景4.第2版主按钮＝启用语义', pre4c.primaryText === `启用「${CHAIN_NAME}·第2版」`, pre4c.primaryText);
    await cdp.click('#making-primary-btn');
    const c4c = await waitConfirmOpen('启用第2版确认窗');
    ev.confirms.push({ step: '场景4-启用第2版', state: c4c });
    assertConfirmCommon(c4c, '场景4.启用第2版确认', { danger: false });
    assert('场景4.替换文案明示当前启用对象', c4c.body.includes(`替换当前「${CHAIN_NAME}·第1版」`), c4c.body);
    await cdp.click('dialog.app-confirm .app-confirm-accept');
    const st4c = await wait('状态条切换为第2版', async () => {
      const s = await makingState();
      return s.statusActive && s.statusText === `当前链路：${CHAIN_NAME}·第2版` ? s : null;
    }, { timeoutMs: 20000 });
    assert('场景4.查看第2版（启用版）主按钮＝停用当前链路', st4c.primaryText === '停用当前链路', st4c.primaryText);

    // 4d 查看第1版（旧版）＝回退语义（回退需启用指针指向更晚版本，故在第2版启用后查看）
    await setVersionByLabel('第1版');
    const st4d = await wait('查看切到第1版（历史版本）', async () => {
      const s = await makingState();
      return s.viewedVersion === v1Id && s.inspectorTitle.includes('（历史版本）') ? s : null;
    }, { timeoutMs: 10000 });
    mark('场景4 回退语义', { inspectorTitle: st4d.inspectorTitle, primaryText: st4d.primaryText, usingLabel: st4d.usingLabel });
    assert('场景4.查看旧版主按钮＝回退语义', st4d.primaryText === `回退到「${CHAIN_NAME}·第1版」`, st4d.primaryText);
    assert('场景4.两态并标（查看第1版＋使用第2版）', st4d.usingLabel.includes(`正在使用：${CHAIN_NAME}·第2版`) && st4d.inspectorState === '尚未启用', { using: st4d.usingLabel, state: st4d.inspectorState });
    await shot('场景4-旧版回退语义');

    // 4e 回到第2版停用：确认窗（常规）→ 确认 → 未启用态恒启用语义
    await setVersionByLabel('第2版（最新）');
    await wait('查看切回第2版（启用版）', async () => {
      const s = await makingState();
      return s.viewedVersion === v2Id && s.primaryText === '停用当前链路' ? s : null;
    }, { timeoutMs: 10000 });
    await cdp.click('#making-primary-btn');
    const c4e = await waitConfirmOpen('停用确认窗');
    ev.confirms.push({ step: '场景4-停用', state: c4e });
    assertConfirmCommon(c4e, '场景4.停用确认', { danger: false });
    assert('场景4.停用确认文案逐字保留', c4e.body === '停用当前链路？从下一轮提问开始回到日常陪想；链路、版本与试问档案全部保留。', c4e.body);
    await cdp.click('dialog.app-confirm .app-confirm-accept');
    const st4e = await wait('状态条回到未启用', async () => {
      const s = await makingState();
      return s.statusIdle ? s : null;
    }, { timeoutMs: 20000 });
    mark('场景4 停用完成', { statusIdle: st4e.statusIdle, primaryText: st4e.primaryText });
    assert('场景4.停用后主按钮恒为启用语义', st4e.primaryText === `启用「${CHAIN_NAME}·第2版」`, st4e.primaryText);
    await shot('场景4-停用后恒启用语义');
  } catch (error) { ev.fatal = '场景4: ' + error.message; ev.stages.push({ name: '场景4-fatal', error: error.message }); }

  // ---------- 场景3 确认窗统一（危险变体＋键盘；删除链路兼清理） ----------
  const chainWasCreated = chainId !== null && diskChain().chainFound;
  if (!ev.fatal && chainWasCreated) try {
    await selectChain();
    // 3a 触发删除链路 → danger 确认窗几何与文案
    await cdp.click('#making-delete-chain-btn');
    const c3 = await waitConfirmOpen('删除链路确认窗');
    ev.confirms.push({ step: '场景3-删除链路', state: c3 });
    assertConfirmCommon(c3, '场景3.删除链路确认', { danger: true });
    assert('场景3.确认窗标题正确', c3.title === `删除链路「${CHAIN_NAME}」？`, c3.title);
    assert('场景3.确认文案明示不可恢复', c3.body.includes('不可恢复'), c3.body);
    assert('场景3.确认按钮文案＝删除链路', c3.acceptLabel === '删除链路', c3.acceptLabel);
    assert('场景3.取消按钮文案＝取消', c3.cancelLabel === '取消', c3.cancelLabel);
    await shot('场景3-删除链路danger确认窗');
    // 3b Esc 取消 → 链路仍在
    await pressEsc();
    await waitConfirmClosed();
    assert('场景3.Esc 取消后确认窗关闭', (await confirmDialogState()).open === false, null);
    const afterEsc = await makingState();
    const diskAfterEsc = diskChain();
    assert('场景3.Esc 取消后链路仍在（UI）', afterEsc.chainRows.some((r) => r.name === CHAIN_NAME), afterEsc.chainRows.map((r) => r.name));
    assert('场景3.Esc 取消后链路仍在（磁盘）', diskAfterEsc.chainFound === true, diskAfterEsc.chainFound);
    await shot('场景3-Esc取消链路保留');
    // 3c 再触发 → Enter 确认 → 链路删除
    await cdp.click('#making-delete-chain-btn');
    await waitConfirmOpen('删除链路确认窗（第二次）');
    await pressEnter();
    await waitConfirmClosed();
    const gone = await wait('链路行消失', async () => {
      const s = await makingState();
      return !s.chainRows.some((r) => r.name === CHAIN_NAME) ? s : null;
    }, { timeoutMs: 20000 });
    const diskGone = await wait('磁盘链路删除', () => { const d = diskChain(); return !d.chainFound ? d : null; }, { timeoutMs: 15000 });
    mark('场景3 删除完成', { remaining: gone.chainRows.length, active: diskGone.active });
    assert('场景3.Enter 确认后链路已删除（磁盘）', diskGone.chainFound === false, diskGone);
    await shot('场景3-Enter确认链路删除');
  } catch (error) { ev.fatal = '场景3: ' + error.message; ev.stages.push({ name: '场景3-fatal（清理未完成，需人工删除冒烟链路）', error: error.message }); failures.push('场景3.清理'); }
  else if (!ev.fatal && !chainWasCreated) {
    ev.stages.push({ name: '场景3-skipped', note: '冒烟链路未创建（场景4 失败），无可清理对象' });
    console.log('SKIP 场景3：冒烟链路未创建');
  }

  // ---------- 场景5 AI 可见性关闭确认（danger） ----------
  if (!ev.fatal) try {
    await gotoTab('tab-files');
    const fm = await wait('文件管理页可见', async () => (await fmState()).filesVisible ? fmState() : null, { timeoutMs: 10000 });
    // 验收补充（2026-10-28 用户报告）：顶部四入口（新建文档/新建文件夹/导入/导出）「并列」成组，
    // 不得被自动外边距拆散（.export-word-btn 的 margin-left:auto 历史遗留已移除）。
    {
      const btns = await cdp.evaluate(`(() => {
        const ids = ['fm-new-document', 'fm-new-folder', 'fm-import-document', 'btn-export'];
        return ids.map((id) => { const e = document.getElementById(id); if (!e) return null; const b = e.getBoundingClientRect(); return { id, l: +b.left.toFixed(1), r: +b.right.toFixed(1) }; });
      })()`);
      const allPresent = btns.every(Boolean);
      const gaps = allPresent ? btns.slice(1).map((g, i) => +(g.l - btns[i].r).toFixed(1)) : null;
      assert('场景5.顶部四入口并列成组（相邻间距≤16px）', allPresent && gaps.every((g) => g >= 0 && g <= 16), { btns, gaps });
    }
    const onIdx = fm.toggles.findIndex((t) => t.checked === 'true');
    assert('场景5.存在「可读」文档开关', onIdx >= 0, { toggles: fm.toggles });
    if (onIdx < 0) {
      ev.manualSteps.push('【人工】场景5：项目内没有「可读」文档开关可触发，请在有讨论使用记录的文档上关闭 AI 可见性，确认弹 danger 应用内确认窗且取消不改状态。');
    } else {
      // 滚入视野后真实点击
      await cdp.evaluate(`(() => { const b=[...document.querySelectorAll('#fm-file-tree .file-ai-visibility-toggle')].find((x)=>x.getAttribute('aria-checked')==='true'); b?.scrollIntoView({block:'center'}); })()`);
      await cdp.pause(200);
      const nodeId = fm.toggles[onIdx].nodeId;
      await cdp.click('#fm-file-tree .file-ai-visibility-toggle[aria-checked="true"]');
      // 竞争等待：danger 确认窗出现，或（无使用记录时）开关直接翻转为 false
      let dialog = null; let flipped = false;
      for (let i = 0; i < 15; i++) {
        const d = await confirmDialogState();
        if (d.open) { dialog = d; break; }
        const checked = await cdp.evaluate(`document.querySelector('#fm-file-tree .file-row[data-node-id="${nodeId}"] .file-ai-visibility-toggle')?.getAttribute('aria-checked')`);
        if (checked === 'false') { flipped = true; break; }
        await cdp.pause(400);
      }
      if (dialog) {
        ev.confirms.push({ step: '场景5-关闭AI可见性', state: dialog });
        assertConfirmCommon(dialog, '场景5.关闭可见性确认', { danger: true });
        assert('场景5.确认文案明示永久只读', dialog.body.includes('永久只读'), dialog.body);
        await shot('场景5-关闭可见性danger确认窗');
        await pressEsc();
        await waitConfirmClosed();
        const stillOn = await cdp.evaluate(`document.querySelector('#fm-file-tree .file-row[data-node-id="${nodeId}"] .file-ai-visibility-toggle')?.getAttribute('aria-checked')`);
        assert('场景5.Esc 取消后可见性未变（仍可读）', stillOn === 'true', stillOn);
        await shot('场景5-取消后状态未变');
      } else if (flipped) {
        // 该文档无讨论使用记录：不弹确认、直接翻转（现行行为）。还原并如实转人工。
        ev.environmentNotes.push('场景5：所选文档无讨论使用记录，关闭不弹确认（现行设计：仅被使用过的文档才确认）。已翻转为不可读，现还原。');
        await cdp.evaluate(`(() => { const b=document.querySelector('#fm-file-tree .file-row[data-node-id="${nodeId}"] .file-ai-visibility-toggle'); b?.scrollIntoView({block:'center'}); })()`);
        await cdp.pause(200);
        await cdp.click(`#fm-file-tree .file-row[data-node-id="${nodeId}"] .file-ai-visibility-toggle`);
        await wait('可见性还原为可读', async () => cdp.evaluate(`document.querySelector('#fm-file-tree .file-row[data-node-id="${nodeId}"] .file-ai-visibility-toggle')?.getAttribute('aria-checked')`) === 'true' ? true : null, { timeoutMs: 10000 });
        ev.manualSteps.push('【人工】场景5：本冒烟项目内未找到被讨论使用过的文档（无使用记录的文档关闭不弹确认，属现行设计）。请人工在文件管理关闭一篇被讨论使用过的文档的 AI 可见性，确认弹 danger 应用内确认窗、取消不改状态。');
        console.log('SKIP 场景5 自动断言：无可触发文档，已转人工清单（状态已还原）');
      } else {
        throw new Error('点击可见性开关后既无确认窗也无翻转');
      }
    }
  } catch (error) { ev.fatal = '场景5: ' + error.message; ev.stages.push({ name: '场景5-fatal', error: error.message }); }

  // ---------- 附加 700px 窄幅不换行（尽力自动；失败转人工不误报） ----------
  if (!ev.fatal) try {
    await gotoTab('tab-making');
    await makingReady();
    // 操作区只在查看链路时呈现：冒烟链路已删则选任一剩余链路；链路库为空则转人工
    const rowsNow = (await makingState()).chainRows;
    if (rowsNow.length === 0) {
      ev.environmentNotes.push('链路库为空：操作区不呈现，700px 窄幅转人工。');
      ev.manualSteps.push('【人工】附加 700px 窄幅：链路库为空、操作区不呈现，请人工在任一链路的导图操作区做约 700px 窄幅视觉比对（上行双状态标注与下行控件不换行错位）。');
    } else {
      if (!rowsNow.some((r) => r.selected)) {
        await cdp.evaluate(`(() => { const b=[...document.querySelectorAll('#making-chain-list .making-chain-row')].find((x)=>(x.querySelector('.making-chain-row-name')?.textContent??'').trim()===${JSON.stringify(CHAIN_NAME)}) || document.querySelector('#making-chain-list .making-chain-row'); b?.click(); })()`);
        await cdp.pause(600);
      }
      await wait('操作区呈现（正在查看任一链路）', async () => {
        const s = await makingState();
        return s.inspectorTitle.includes('正在查看：') && s.operations.rowTop !== null ? s : null;
      }, { timeoutMs: 10000 });
      let query = null;
      try {
        query = JSON.parse(execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', PS1, '-Query'], { encoding: 'utf8' }));
      } catch (e) {
        ev.environmentNotes.push('缩窗助手不可用（转人工）: ' + e.message);
        ev.manualSteps.push('【人工】附加 700px 窄幅：缩窗助手不可用，请人工把应用窗口调窄至导图区约 700px，确认操作区两行不换行错位。');
      }
      if (query) {
        const outer = query.outer; // [left, top, width, height]
        let landedWidth = null; let lastInspectorWidth = null;
        try {
          for (const w of [1080, 980, 880, 800]) {
            execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', PS1, '-ClientWidth', String(w), '-ClientHeight', String(query.client[1])], { encoding: 'utf8' });
            await cdp.pause(500);
            const s = await makingState();
            lastInspectorWidth = s.operations.inspectorWidth;
            if (lastInspectorWidth !== null && lastInspectorWidth >= 640 && lastInspectorWidth <= 760) { landedWidth = lastInspectorWidth; break; }
          }
          if (landedWidth === null) {
            ev.environmentNotes.push(`缩窗迭代后导图区未落入 640–760px 带宽（最后实测 ${lastInspectorWidth}px），700px 窄幅转人工。`);
            ev.manualSteps.push('【人工】附加 700px 窄幅：自动缩窗未落进约 700px 带宽，请人工调窗并确认操作区两行不换行错位。');
          } else {
            const s = await makingState();
            mark('附加 窄幅几何', { inspectorWidth: landedWidth, operations: s.operations });
            assert('附加.窄幅上行标注在上、下行控件在下（两行结构完整）',
              s.operations.identityBottom !== null && s.operations.rowTop !== null && s.operations.identityBottom <= s.operations.rowTop + 2,
              { identityBottom: s.operations.identityBottom, rowTop: s.operations.rowTop });
            assertOperationsSingleLine(s, '附加.窄幅');
            await shot('附加-700px窄幅不换行');
          }
        } finally {
          try {
            execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', PS1, '-X', String(outer[0]), '-Y', String(outer[1]), '-OuterWidth', String(outer[2]), '-OuterHeight', String(outer[3])], { encoding: 'utf8' });
            await cdp.pause(500);
          } catch (e) {
            ev.environmentNotes.push('窗口尺寸还原失败（请手动调整回原尺寸）: ' + e.message);
          }
        }
      }
    }
  } catch (error) { ev.stages.push({ name: '附加窄幅-fatal（不影响其余场景，转人工）', error: error.message }); ev.manualSteps.push('【人工】附加 700px 窄幅：自动检查异常中断，请人工做窄幅视觉比对。'); }

  // ---------- 收尾 控制台零错误 ----------
  ev.consoleErrors = [...new Set(cdp.consoleErrors)];
  assert('收尾.全程控制台零错误（error/exception）', ev.consoleErrors.length === 0, ev.consoleErrors.slice(0, 10));
} finally {
  ev.finishedAt = new Date().toISOString();
  ev.elapsedMs = Date.now() - T0;
  ev.failedAssertions = failures;
  ev.passedCount = ev.assertions.filter((a) => a.pass).length;
  writeFileSync(join(OUT, 'smoke-evidence.json'), JSON.stringify(ev, null, 2));
  console.log('==== 汇总 ====');
  console.log(JSON.stringify({ passed: ev.passedCount, failed: failures, fatal: ev.fatal, screenshots: ev.screenshots }, null, 2));
  if (ev.manualSteps.length > 0) {
    console.log('==== 需人工验证清单（不得视为已自动通过） ====');
    for (const step of ev.manualSteps) console.log('- ' + step);
  }
  process.exitCode = failures.length > 0 || ev.fatal ? 1 : 0;
  cdp.close();
}
