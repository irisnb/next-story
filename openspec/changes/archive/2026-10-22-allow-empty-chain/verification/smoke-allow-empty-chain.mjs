// smoke-allow-empty-chain.mjs — allow-empty-chain 任务 5.2 真机冒烟（CDP 端到端）。
//
// 方法（沿 add-making-module-core e2e-driver 与 fix-ai-and-making-usability
// chain-round-binding-acceptance 既有惯例）：
// - 应用以 `npm run tauri:dev` + WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9223 启动；
// - 本脚本经 CDP WebSocket 连 Next Story 页面目标；
// - 点击＝真实鼠标事件（Input.dispatchMouseEvent），文本＝Input.insertText（IME 类提交）；
//   部分按钮点击沿 chain-round-binding 先例用 evaluate .click()（事件监听器不检查 isTrusted）；
// - DOM 查询只走 Runtime.evaluate 只读；
// - 原生确认对话框（Tauri 插件原生弹窗，合成输入无法驱动）沿 2026-09-22 C4 先例改道
//   devtools 通道：覆写 globalThis.confirm，捕获确认文案全文并按步骤策略返回（如实记录改道）；
// - 视觉证据＝Page.captureScreenshot 存 PNG（每步一张）；断言证据统一落 smoke-evidence.json。
//
// 流程（任务 5.2）：
//   S1 新建链路→诞生即含零卡第 1 版（导图无卡行、仅两个添加入口、磁盘 versions[0].cards=[]）
//   S2 直接启用第 1 版（确认文案含零卡说明；状态条「（未附加自定义）」）
//   S3 写作页打开最近项目既有项目→关注文档提问→等真实回包（智谱 glm-5.3）
//   S4 该轮「本次参考了什么」无「本轮链路」行（零卡轮次）＋档案 chain_rounds.has_cards=false
//   S5 驱动侧注入一张测试卡保存为第 2 版（经 __TAURI_INTERNALS__.invoke 调 chain_save_version，
//      如实注明注入方式）→ 真实 UI 启用第 2 版 → 状态条无「（未附加自定义）」后缀
//   S6 写作页同讨论追问一轮 → 「本次参考了什么」有「本轮链路：…第2版」＋档案 has_cards=true
//   S7 回制作页删第 2 版最后一张卡（确认文案含「不含任何卡的新版本」）→ 第 3 版零卡落库、
//      启用指针仍指第 2 版、状态条不变
//   S8 清理：删除冒烟链路
//   S9 全程 console 零错误断言
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { connect } from './cdp-client.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const OUT = join(here, 'evidence');
mkdirSync(OUT, { recursive: true });

const CHAIN_NAME = '零卡冒烟-allow-empty-chain';
const APP_DATA = process.env.LOCALAPPDATA + '\\com.nextstory.desktop';
const CHAINS_FILE = join(APP_DATA, 'making-module', 'chains.json');
const PROJECT_DIR = 'C:\\Users\\Administrator\\Desktop\\test\\8b 验证作品';
const CONVOS_DIR = join(PROJECT_DIR, 'next-story-system', 'conversations');

// 合成验收问题（非正式用户文本）；一句话类问题，控制回包时长。
const Q1 = '用一句话说说你看这段开头的方式。';
const Q2 = '再一句话说说：这段开头里最先让你注意到的是什么？';

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

// ========== 证据框架 ==========

const ev = {
  startedAt: new Date().toISOString(),
  target: cdp.target,
  chainName: CHAIN_NAME,
  assertions: [],
  stages: [],
  screenshots: [],
  consoleErrors: [],
  confirmMessages: [],
  captured: {},
  fatal: null,
  environmentNotes: [],
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

// confirm 覆写（沿 C4 先例）：捕获文案全文，按步骤策略返回。
async function installConfirm(accepted) {
  await cdp.evaluate(`(() => {
    window.__smokeConfirmLog = window.__smokeConfirmLog || [];
    window.__smokeConfirmAccept = ${JSON.stringify(accepted)};
    globalThis.confirm = (msg) => { window.__smokeConfirmLog.push(String(msg)); return Promise.resolve(window.__smokeConfirmAccept); };
    return true;
  })()`);
}
const confirmLog = () => cdp.evaluate(`(window.__smokeConfirmLog||[]).slice()`);
const confirmSlice = async (before) => (await confirmLog()).slice(before);

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

// ========== 磁盘断言（只读） ==========

function diskChain() {
  const j = JSON.parse(readFileSync(CHAINS_FILE, 'utf8'));
  const c = j.chains.find((x) => x.name === CHAIN_NAME);
  return {
    active: j.active ?? null,
    chainFound: !!c,
    chainId: c?.id ?? null,
    versions: (c?.versions ?? []).map((v) => ({
      id: v.id, index: v.index, cards: v.cards.length, changeNote: v.change_note ?? '',
    })),
  };
}

function listConvoIds() {
  return readdirSync(CONVOS_DIR).filter((f) => f.endsWith('.json') && !f.endsWith('.meta.json')).map((f) => f.slice(0, -5));
}
function readConvo(id) { return JSON.parse(readFileSync(join(CONVOS_DIR, `${id}.json`), 'utf8')); }
const assistantDoneCount = (r) => (r?.turns ?? []).filter((t) => t.role === 'assistant' && (t.status === 'done' || t.status === 'success' || (t.status === undefined && (t.text ?? '').length > 0))).length;

// ========== 页面探针（只读） ==========

const makingState = () => cdp.evaluate(`(() => {
  const byId = (id) => document.getElementById(id);
  const vis = (e) => !!e && !e.classList.contains('hidden') && !e.hidden && e.getBoundingClientRect().width > 0;
  return {
    makingVisible: vis(byId('module-making')),
    statusActive: vis(byId('making-status-active')),
    statusText: (byId('making-status-text')?.textContent ?? '').trim(),
    statusIdle: vis(byId('making-status-idle')),
    statusError: vis(byId('making-status-error')) ? (byId('making-status-error')?.textContent ?? '').trim() : null,
    inspectorTitle: (byId('making-inspector-title')?.textContent ?? '').trim(),
    versionOptions: [...document.querySelectorAll('#making-version-select option')].map((o) => o.textContent.trim()),
    viewedVersion: byId('making-version-select')?.value ?? null,
    enableHidden: byId('making-enable-btn')?.hidden ?? null,
    enableText: (byId('making-enable-btn')?.textContent ?? '').trim(),
    usingLabel: (document.querySelector('.making-version-using')?.textContent ?? '').trim(),
    chainRows: [...document.querySelectorAll('#making-chain-list .making-chain-row')].map((b) => ({
      name: b.querySelector('.making-chain-row-name')?.textContent ?? '',
      status: b.querySelector('.making-chain-row-status')?.textContent ?? '',
      selected: b.classList.contains('selected'),
    })),
    requirementCardRows: document.querySelectorAll('#making-card-list .making-card-row').length,
    postureCardRows: document.querySelectorAll('#making-posture-card-list .making-card-row').length,
    addRequirementVisible: vis(byId('making-add-card-btn')),
    addPostureVisible: vis(byId('making-add-posture-btn')),
    requirementCount: (byId('making-card-count')?.textContent ?? '').trim(),
    postureCount: (byId('making-posture-card-count')?.textContent ?? '').trim(),
  };
})()`);

const aiState = () => cdp.evaluate(`(() => {
  const w = document.querySelector('.ai-window');
  const vis = (e) => !!e && !e.classList.contains('hidden') && e.getBoundingClientRect().width > 0;
  if (!w) return { noWindow: true };
  return {
    doc: (w.querySelector('[data-role="doc"]')?.textContent || '').trim(),
    dqVisible: vis(w.querySelector('[data-role="direct-question"]')),
    sendDisabled: w.querySelector('[data-role="direct-question-send"]')?.disabled ?? null,
    followUp: vis(w.querySelector('[data-role="follow-up-form"]')),
    followUpSendDisabled: w.querySelector('[data-role="follow-up-send"]')?.disabled ?? null,
    status: w.querySelector('.ai-message-status')?.textContent?.trim() ?? null,
    error: vis(w.querySelector('[data-role="error-block"]')) || vis(w.querySelector('[data-role="follow-up-error"]')) || vis(w.querySelector('[data-role="direct-question-error"]')),
    errorText: (w.querySelector('[data-role="error-message"]')?.textContent || w.querySelector('[data-role="follow-up-error-message"]')?.textContent || w.querySelector('[data-role="direct-question-error-message"]')?.textContent || '').trim(),
    readingReq: vis(w.querySelector('[data-role="reading-request"]')),
    convText: (w.querySelector('[data-role="conversation"]')?.innerText || '').trim(),
    materialsVisible: vis(w.querySelector('[data-role="materials-panel"]')),
    chainLines: [...w.querySelectorAll('[data-role="materials-body"] .ai-material-chain')].map((el) => el.textContent.trim()),
  };
})()`);

// 页签切换（evaluate click，沿 chain-round-binding 先例）
const gotoTab = async (id) => { await cdp.evaluate(`document.getElementById(${JSON.stringify(id)})?.click()`); await cdp.pause(600); };
// 制作页就绪探针：页面真正可见（欢迎页不在场且模块宽度>0），不再误判隐藏页里的 DOM
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
const selectChain = async () => {
  // 链路行按名称找（data-chain-id 需先从磁盘读，按文本更稳）
  await cdp.evaluate(`(() => { const b=[...document.querySelectorAll('#making-chain-list .making-chain-row')].find((x)=>(x.querySelector('.making-chain-row-name')?.textContent??'').trim()===${JSON.stringify(CHAIN_NAME)}); b?.click(); })()`);
  await cdp.pause(600);
};
const setVersionByLabel = async (labelPart) => {
  await cdp.evaluate(`(() => { const s=document.querySelector('#making-version-select'); if(!s) return false; const opt=[...s.options].find((o)=>o.textContent.includes(${JSON.stringify(labelPart)})); if(!opt) return false; s.value=opt.value; s.dispatchEvent(new Event('change',{bubbles:true})); return true; })()`);
  await cdp.pause(500);
};

// AI 轮完成等待：停滞看护 200s / 硬上限 300s（任务书口径：单轮总时长放宽 5 分钟）
async function waitAiRoundDone(label) {
  const start = Date.now();
  let lastLen = -1;
  let lastProgress = Date.now();
  let allowClicked = false;
  for (;;) {
    const st = await aiState();
    if (st.noWindow) throw new Error(label + '：讨论窗口消失');
    if (st.error) throw new Error(label + ' 轮内出错: ' + (st.errorText || '').slice(0, 250));
    if (Date.now() - start > 300000) throw new Error(label + ' 等待硬超时（300s）');
    if (st.readingReq && !allowClicked) {
      ev.environmentNotes.push('按需补读授权卡出现，代点「允许」（沿既有验收惯例）');
      await cdp.evaluate(`document.querySelector('.ai-window [data-role="reading-allow"]')?.click()`);
      allowClicked = true;
      lastProgress = Date.now();
      await cdp.pause(1000);
      continue;
    }
    if (!st.readingReq && st.followUp && !st.status && st.convText.length > 0) {
      await cdp.pause(2500); // 终态原子更新后的保存余量
      return await aiState();
    }
    if (st.convText.length !== lastLen) { lastLen = st.convText.length; lastProgress = Date.now(); }
    if (Date.now() - lastProgress > 200000) throw new Error(label + ' 停滞超时（200s 无进展）');
    await cdp.pause(1500);
  }
}

async function openMaterials() {
  const st = await aiState();
  if (!st.materialsVisible) {
    await cdp.evaluate(`document.querySelector('.ai-window [data-role="materials-toggle"]')?.click()`);
    await wait('材料面板展开', async () => (await aiState()).materialsVisible, { timeoutMs: 10000 });
  }
  return aiState();
}

// ========== 步骤执行 ==========

let chainId = null;
let v1Id = null, v2Id = null, v3Id = null;
const convoIdsBefore = new Set(listConvoIds());
let smokeConvoId = null;

try {
  // ---------- P0 项目就绪：欢迎页则打开最近项目列表第一条（既有项目） ----------
  try {
    const welcome = await cdp.evaluate(`(() => { const w=document.getElementById('welcome-page'); return !!w && !w.classList.contains('hidden'); })()`);
    if (welcome) {
      const recentCount = await cdp.evaluate(`document.querySelectorAll('#recent-works-list .recent-work-item').length`);
      assert('P0.最近项目列表非空', recentCount > 0, recentCount);
      if (recentCount === 0) throw new Error('最近项目列表为空（无法按任务要求打开既有项目）');
      ev.captured.recentFirst = await cdp.evaluate(`(document.querySelector('#recent-works-list .recent-work-item .recent-work-name')?.textContent ?? '').trim()`);
      await cdp.evaluate(`document.querySelector('#recent-works-list .recent-work-item')?.click()`);
      await wait('项目打开（编辑页出现）', async () => cdp.evaluate(`(() => { const e=document.getElementById('editor-page'); const w=document.getElementById('welcome-page'); return !!e && !e.classList.contains('hidden') && !!w?.classList.contains('hidden'); })()`), { timeoutMs: 90000 });
      await cdp.pause(1500);
    }
    ev.captured.projectName = await cdp.evaluate(`(document.getElementById('current-project-name')?.textContent ?? '').trim()`);
    ev.captured.currentDoc = await cdp.evaluate(`(document.getElementById('current-document-name')?.textContent ?? '').trim()`);
    mark('P0 项目就绪', { projectName: ev.captured.projectName, currentDoc: ev.captured.currentDoc, viaWelcome: welcome, recentFirst: ev.captured.recentFirst ?? null });
    assert('P0.已进入既有项目', (ev.captured.projectName ?? '').length > 0, ev.captured.projectName);
  } catch (error) { ev.fatal = 'P0: ' + error.message; ev.stages.push({ name: 'P0-fatal', error: error.message }); }

  // ---------- S1 新建链路（诞生即零卡第 1 版） ----------
  if (!ev.fatal) try {
    await installConfirm(true); // 全程默认接受确认（每步用 slice 记录各自文案）
    await gotoTab('tab-making');
    await wait('制作页可见', async () => (await makingState()).makingVisible, { timeoutMs: 15000 });
    await makingReady();
    // 链路库可能收拢（中等宽度）：新建按钮不可见时先开库
    if (!(await cdp.evaluate(`(() => { const b=document.getElementById('making-new-chain-btn'); const vis=(e)=>!!e&&!e.classList.contains('hidden')&&e.getBoundingClientRect().width>0; return vis(b); })()`))) {
      await cdp.evaluate(`document.getElementById('making-library-toggle')?.click()`);
      await cdp.pause(500);
    }
    await cdp.click('#making-new-chain-btn');
    await wait('新建链路表单出现', async () => cdp.evaluate(`(() => { const f=document.getElementById('making-new-chain-form'); return !!f && !f.classList.contains('hidden'); })()`), { timeoutMs: 8000 });
    await cdp.fillText('#making-new-chain-name', CHAIN_NAME);
    await cdp.click('#making-new-chain-confirm');
    const st1 = await wait('链路出现并选中', async () => {
      const s = await makingState();
      return s.chainRows.some((r) => r.name === CHAIN_NAME && r.selected) ? s : null;
    }, { timeoutMs: 20000 });
    mark('S1 UI', { inspectorTitle: st1.inspectorTitle, versionOptions: st1.versionOptions, requirementCardRows: st1.requirementCardRows, postureCardRows: st1.postureCardRows });
    assert('S1.导图显示第1版', st1.inspectorTitle === `正在查看：${CHAIN_NAME}·第1版`, st1.inspectorTitle);
    assert('S1.版本下拉仅第1版(最新)', st1.versionOptions.length === 1 && st1.versionOptions[0].includes('第1版') && st1.versionOptions[0].includes('最新'), st1.versionOptions);
    assert('S1.自定义分区无卡行', st1.requirementCardRows === 0 && st1.postureCardRows === 0, { req: st1.requirementCardRows, posture: st1.postureCardRows });
    assert('S1.两个常驻添加入口在场', st1.addRequirementVisible && st1.addPostureVisible, { req: st1.addRequirementVisible, posture: st1.addPostureVisible });
    assert('S1.两组计数如实为0', st1.requirementCount.includes('0 张卡') && st1.postureCount.includes('0 张卡'), { req: st1.requirementCount, posture: st1.postureCount });
    const d1 = await wait('磁盘链路库落盘', () => { const d = diskChain(); return d.chainFound && d.versions.length >= 1 ? d : null; }, { timeoutMs: 15000 });
    mark('S1 磁盘', d1);
    chainId = d1.chainId; v1Id = d1.versions.find((v) => v.index === 1)?.id ?? null;
    assert('S1.磁盘:诞生即含第1版零卡', d1.versions.length === 1 && d1.versions[0].index === 1 && d1.versions[0].cards === 0, d1.versions);
    assert('S1.磁盘:第1版变更说明=新建链路', d1.versions[0].changeNote === '新建链路', d1.versions[0].changeNote);
    await shot('S1-新建零卡链路');
  } catch (error) { ev.fatal = 'S1: ' + error.message; ev.stages.push({ name: 'S1-fatal', error: error.message }); }

  // ---------- S2 直接启用第 1 版（零卡） ----------
  if (!ev.fatal) try {
    await selectChain();
    const pre = await makingState();
    assert('S2.零卡版本启用入口在场', pre.enableHidden === false && pre.enableText.includes('第1版'), { enableHidden: pre.enableHidden, enableText: pre.enableText });
    const logBefore = (await confirmLog()).length;
    await cdp.click('#making-enable-btn');
    const confirm2 = await confirmSlice(logBefore);
    ev.confirmMessages.push({ step: 'S2-启用第1版', messages: confirm2 });
    mark('S2 确认文案', confirm2);
    assert('S2.确认文案含零卡说明', confirm2.length > 0 && /不含任何卡/.test(confirm2[0]) && /不附加自定义内容/.test(confirm2[0]), confirm2[0] ?? null);
    const st2 = await wait('状态条切换为已启用', async () => {
      const s = await makingState();
      return s.statusActive && s.statusText.includes(CHAIN_NAME) ? s : null;
    }, { timeoutMs: 20000 });
    mark('S2 UI', { statusText: st2.statusText, usingLabel: st2.usingLabel });
    assert('S2.状态条零卡后缀', st2.statusText === `当前链路：${CHAIN_NAME}·第1版（未附加自定义）`, st2.statusText);
    assert('S2.using行同步零卡后缀', st2.usingLabel === `正在使用：${CHAIN_NAME}·第1版（未附加自定义）`, st2.usingLabel);
    await shot('S2-启用零卡第1版');
  } catch (error) { ev.fatal = 'S2: ' + error.message; ev.stages.push({ name: 'S2-fatal', error: error.message }); }

  // ---------- S3 写作页：既有项目内关注文档真实提问 ----------
  let aiAvailable = true;
  if (!ev.fatal) try {
    await gotoTab('tab-writing');
    assert('S3.已进入既有项目（P0 打开）', (ev.captured.projectName ?? '').length > 0, ev.captured.projectName);
    // 打开 AI 面板 → 讨论列表 → 新建讨论
    const dockVisible = await cdp.evaluate(`(() => { const d=document.querySelector('#ai-dock'); return !!d && !d.classList.contains('hidden') && d.getBoundingClientRect().width>0; })()`);
    if (!dockVisible) { await cdp.evaluate(`document.getElementById('btn-toggle-ai')?.click()`); await cdp.pause(600); }
    const listHidden = await cdp.evaluate(`document.querySelector('.ai-conversation-list')?.classList.contains('hidden') ?? true`);
    if (listHidden) { await cdp.evaluate(`document.getElementById('ai-conversation-list-toggle')?.click()`); await cdp.pause(400); }
    await cdp.evaluate(`document.getElementById('ai-list-new-conversation')?.click()`);
    await cdp.pause(800);
    await wait('直接提问表单出现', async () => (await aiState()).dqVisible, { timeoutMs: 15000 });
    await cdp.fillText('.ai-window [data-role="direct-question-input"]', Q1);
    await wait('发送按钮启用', async () => (await aiState()).sendDisabled === false, { timeoutMs: 10000 });
    await cdp.evaluate(`document.querySelector('.ai-window [data-role="direct-question-send"]')?.click()`);
    mark('S3 已发送', { question: Q1 });
    const done3 = await waitAiRoundDone('S3 首轮');
    ev.captured.q1ReplyLen = done3.convText.length;
    ev.captured.q1Doc = done3.doc;
    ev.captured.readingAllowed = ev.environmentNotes.some((n) => n.includes('按需补读'));
    mark('S3 完成', { doc: done3.doc, replyLen: done3.convText.length, replyPreview: done3.convText.slice(0, 160) });
    assert('S3.真实回包完成（文本非空）', done3.convText.length > 0, { replyLen: done3.convText.length });
    assert('S3.关注文档已绑定', (done3.doc ?? '').length > 0, done3.doc);
    // 讨论档案落盘（has_cards 契约证据在 S4 断言）
    smokeConvoId = listConvoIds().find((id) => !convoIdsBefore.has(id)) ?? null;
    ev.captured.smokeConvoId = smokeConvoId;
    assert('S3.讨论档案已落盘', smokeConvoId !== null, smokeConvoId);
    await shot('S3-零卡轮真实回包');
  } catch (error) {
    aiAvailable = false;
    ev.fatal = 'S3: ' + error.message;
    ev.stages.push({ name: 'S3-fatal', error: error.message });
  }

  // ---------- S4 零卡轮「本次参考了什么」无链路行 ----------
  if (!ev.fatal && aiAvailable) try {
    const st4 = await openMaterials();
    mark('S4 材料面板', { chainLines: st4.chainLines, materialsVisible: st4.materialsVisible });
    assert('S4.零卡轮无「本轮链路」行', st4.chainLines.length === 0, st4.chainLines);
    // 档案证据：chain_rounds 记录在场（历史如实留存）且 has_cards=false（接口缝）
    const convo4 = smokeConvoId ? readConvo(smokeConvoId) : null;
    const cr0 = (convo4?.chain_rounds ?? []).find((r) => r.turn_index === 0) ?? null;
    ev.captured.s4ArchiveChainRound = cr0;
    mark('S4 档案 chain_rounds[0]', cr0);
    assert('S4.档案链路记录在场（零卡轮仍如实记录）', cr0 !== null && cr0.chain_name === CHAIN_NAME && cr0.version_index === 1, cr0);
    assert('S4.档案 has_cards=false（接口缝）', cr0?.has_cards === false, cr0?.has_cards);
    await shot('S4-零卡轮无链路行');
  } catch (error) { ev.fatal = 'S4: ' + error.message; ev.stages.push({ name: 'S4-fatal', error: error.message }); }

  // ---------- S5 注入一张测试卡为第 2 版 → 真实 UI 启用 ----------
  if (!ev.fatal) try {
    const invokeAvail = await cdp.evaluate(`typeof window.__TAURI_INTERNALS__ === 'object' && typeof window.__TAURI_INTERNALS__.invoke === 'function'`);
    assert('S5.注入通道可用(__TAURI_INTERNALS__.invoke)', invokeAvail === true, invokeAvail);
    if (!invokeAvail) throw new Error('__TAURI_INTERNALS__.invoke 不可用，无法注入第 2 版（制作对话驾驶成本过高，任务书允许的注入路径不可达）');
    const args = {
      chainId,
      cards: [{
        title: '冒烟测试卡-多给可能',
        trigger_desc: '适用：讨论情节走向时\n不适用：只聊单句台词时',
        body: '回应里至少给出两种不同可能，说明各自的依据与代价，不替用户拍板。',
        slot_type: 'requirement',
      }],
      changeNote: '真机冒烟注入（任务 5.2 允许的驱动侧保存路径）',
    };
    ev.captured.s5Injection = { via: '__TAURI_INTERNALS__.invoke("chain_save_version")', args };
    const saved = await cdp.evaluate(`window.__TAURI_INTERNALS__.invoke('chain_save_version', ${JSON.stringify(args)})`);
    ev.captured.s5SavedVersion = { id: saved.id, index: saved.index, cards: saved.cards.length };
    // 切页签触发制作页重读链路库（注入绕过 UI 层，不自动刷新）
    await gotoTab('tab-writing');
    await gotoTab('tab-making');
    await makingReady();
    await selectChain();
    const d5 = await wait('磁盘出现第2版', () => { const d = diskChain(); return d.versions.length >= 2 && d.versions.some((v) => v.index === 2) ? d : null; }, { timeoutMs: 15000 });
    v2Id = d5.versions.find((v) => v.index === 2)?.id ?? null;
    mark('S5 注入落库', { saved: ev.captured.s5SavedVersion, versions: d5.versions, active: d5.active });
    assert('S5.第2版含一张卡', d5.versions.find((v) => v.index === 2)?.cards === 1, d5.versions.find((v) => v.index === 2));
    assert('S5.注入未动启用指针（仍指第1版）', d5.active?.version_id === v1Id, d5.active);
    // 真实 UI 查看并启用第 2 版
    await setVersionByLabel('第2版');
    const pre5 = await makingState();
    assert('S5.第2版启用入口在场', pre5.enableHidden === false && pre5.enableText.includes('第2版'), { enableHidden: pre5.enableHidden, enableText: pre5.enableText });
    const logBefore = (await confirmLog()).length;
    await cdp.click('#making-enable-btn');
    const confirm5 = await confirmSlice(logBefore);
    ev.confirmMessages.push({ step: 'S5-启用第2版', messages: confirm5 });
    mark('S5 确认文案', confirm5);
    assert('S5.第2版确认文案无零卡说明（有卡版本）', confirm5.length > 0 && !/不含任何卡/.test(confirm5[0]) && /替换当前/.test(confirm5[0]), confirm5[0] ?? null);
    const st5 = await wait('状态条切换为第2版', async () => {
      const s = await makingState();
      return s.statusActive && s.statusText.includes('第2版') ? s : null;
    }, { timeoutMs: 20000 });
    mark('S5 UI', { statusText: st5.statusText, usingLabel: st5.usingLabel });
    assert('S5.状态条无「（未附加自定义）」后缀', st5.statusText === `当前链路：${CHAIN_NAME}·第2版`, st5.statusText);
    await shot('S5-加卡启用第2版');
  } catch (error) { ev.fatal = 'S5: ' + error.message; ev.stages.push({ name: 'S5-fatal', error: error.message }); }

  // ---------- S6 有卡轮「本次参考了什么」恢复链路行 ----------
  if (!ev.fatal && aiAvailable) try {
    await gotoTab('tab-writing');
    await wait('追问表单可见', async () => (await aiState()).followUp, { timeoutMs: 15000 });
    await cdp.fillText('.ai-window [data-role="follow-up-input"]', Q2);
    await wait('追问发送按钮启用', async () => (await aiState()).followUpSendDisabled === false, { timeoutMs: 10000 });
    await cdp.evaluate(`document.querySelector('.ai-window [data-role="follow-up-send"]')?.click()`);
    mark('S6 已发送追问', { question: Q2 });
    const done6 = await waitAiRoundDone('S6 追问');
    const st6 = await openMaterials();
    mark('S6 材料面板', { chainLines: st6.chainLines });
    const expect6 = `本轮链路：${CHAIN_NAME}·第2版`;
    const lines6 = st6.chainLines.filter((l) => l.includes('第2版'));
    assert('S6.有卡轮恢复「本轮链路」行', lines6.some((l) => l === expect6 || l.includes(expect6)), st6.chainLines);
    assert('S6.首轮链路行仍不显示（零卡轮历史一致）', !st6.chainLines.some((l) => l.includes('第1版')), st6.chainLines.filter((l) => l.includes('第1版')));
    const convo6 = smokeConvoId ? readConvo(smokeConvoId) : null;
    const cr1 = (convo6?.chain_rounds ?? []).find((r) => r.turn_index === 1) ?? null;
    ev.captured.s6ArchiveChainRound = cr1;
    mark('S6 档案 chain_rounds[1]', cr1);
    assert('S6.档案追问轮 has_cards 契约（true 或缺省=有卡）', cr1 !== null && cr1.chain_name === CHAIN_NAME && cr1.version_index === 2 && cr1.has_cards !== false, cr1);
    ev.captured.q2ReplyLen = done6.convText.length;
    assert('S6.追问真实回包完成', done6.convText.length > 0, { replyLen: done6.convText.length });
    await shot('S6-有卡轮链路行恢复');
  } catch (error) { ev.fatal = 'S6: ' + error.message; ev.stages.push({ name: 'S6-fatal', error: error.message }); }

  // ---------- S7 删第 2 版最后一张卡 → 零卡第 3 版、指针不动 ----------
  if (!ev.fatal) try {
    await gotoTab('tab-making');
    await makingReady();
    await selectChain();
    await setVersionByLabel('第2版');
    const pre7 = await makingState();
    assert('S7.第2版在场且有一张卡行', pre7.viewedVersion === v2Id && pre7.requirementCardRows === 1, { viewed: pre7.viewedVersion, rows: pre7.requirementCardRows });
    await cdp.evaluate(`document.querySelector('#making-card-list .making-card-row')?.click()`);
    await wait('卡片快捷小窗出现', async () => cdp.evaluate(`(() => { const p=document.getElementById('making-quick-panel'); return !!p && !p.classList.contains('hidden') && p.dataset.source === 'card'; })()`), { timeoutMs: 10000 });
    const delEnabled = await cdp.evaluate(`(() => { const b=[...document.querySelectorAll('#making-quick-panel .making-quick-actions button')].find((x)=>(x.textContent??'').trim()==='删除卡片'); return b ? { found: true, disabled: b.disabled } : { found: false }; })()`);
    assert('S7.最后一张卡删除按钮可点（不再禁用）', delEnabled.found && delEnabled.disabled === false, delEnabled);
    const logBefore = (await confirmLog()).length;
    await cdp.evaluate(`[...document.querySelectorAll('#making-quick-panel .making-quick-actions button')].find((x)=>(x.textContent??'').trim()==='删除卡片')?.click()`);
    const confirm7 = await confirmSlice(logBefore);
    ev.confirmMessages.push({ step: 'S7-删最后一张卡', messages: confirm7 });
    mark('S7 确认文案', confirm7);
    assert('S7.确认文案明示零卡新版本', confirm7.length > 0 && /不含任何卡的新版本/.test(confirm7[0]), confirm7[0] ?? null);
    // 等保存完成：自动查看第 3 版
    const st7 = await wait('删除保存完成（查看切到第3版）', async () => {
      const s = await makingState();
      return s.inspectorTitle.includes('第3版') ? s : null;
    }, { timeoutMs: 25000 });
    const d7 = await wait('磁盘第3版零卡落库', () => { const d = diskChain(); return d.versions.length >= 3 && d.versions.some((v) => v.index === 3) ? d : null; }, { timeoutMs: 15000 });
    v3Id = d7.versions.find((v) => v.index === 3)?.id ?? null;
    mark('S7 完成', { inspectorTitle: st7.inspectorTitle, versions: d7.versions, active: d7.active, statusText: st7.statusText, requirementCardRows: st7.requirementCardRows });
    assert('S7.产生零卡第3版', d7.versions.find((v) => v.index === 3)?.cards === 0, d7.versions.find((v) => v.index === 3));
    assert('S7.启用指针仍指第2版', d7.active?.chain_id === chainId && d7.active?.version_id === v2Id, d7.active);
    assert('S7.状态条仍第2版（无零卡后缀）', st7.statusText === `当前链路：${CHAIN_NAME}·第2版`, st7.statusText);
    assert('S7.第3版导图无卡行', st7.requirementCardRows === 0 && st7.postureCardRows === 0, { req: st7.requirementCardRows, posture: st7.postureCardRows });
    await shot('S7-删至零出新版本');
  } catch (error) { ev.fatal = 'S7: ' + error.message; ev.stages.push({ name: 'S7-fatal', error: error.message }); }

  // ---------- S8 清理：删除冒烟链路（仅当 S1 确实创建过它） ----------
  const chainWasCreated = chainId !== null && diskChain().chainFound;
  if (!chainWasCreated) {
    ev.stages.push({ name: 'S8-skipped', note: '冒烟链路从未创建（前置步骤失败），无可清理对象' });
    console.log('SKIP S8：冒烟链路未创建，无清理对象');
  } else try {
    await gotoTab('tab-making');
    await makingReady();
    await selectChain();
    const logBefore = (await confirmLog()).length;
    await cdp.evaluate(`document.getElementById('making-delete-chain-btn')?.click()`);
    await cdp.pause(1200);
    const confirm8 = await confirmSlice(logBefore);
    ev.confirmMessages.push({ step: 'S8-删除冒烟链路', messages: confirm8 });
    const gone = await wait('链路行消失', async () => {
      const s = await makingState();
      return !s.chainRows.some((r) => r.name === CHAIN_NAME) ? s : null;
    }, { timeoutMs: 20000 });
    const d8 = await wait('磁盘链路删除', () => { const d = diskChain(); return !d.chainFound ? d : null; }, { timeoutMs: 15000 });
    mark('S8 清理', { confirm: confirm8, active: d8.active, remaining: gone.chainRows.length });
    assert('S8.冒烟链路已删除', !d8.chainFound, d8);
    ev.captured.activeAfterCleanup = d8.active;
    await shot('S8-清理完成');
  } catch (error) { ev.stages.push({ name: 'S8-fatal（清理未完成，需人工处理）', error: error.message }); failures.push('S8.清理'); }

  // ---------- S9 console 零错误 ----------
  ev.consoleErrors = [...new Set(cdp.consoleErrors)];
  assert('S9.全程控制台零错误（error/exception）', ev.consoleErrors.length === 0, ev.consoleErrors.slice(0, 10));
} finally {
  ev.finishedAt = new Date().toISOString();
  ev.elapsedMs = Date.now() - T0;
  ev.failedAssertions = failures;
  ev.passedCount = ev.assertions.filter((a) => a.pass).length;
  writeFileSync(join(OUT, 'smoke-evidence.json'), JSON.stringify(ev, null, 2));
  console.log('==== 汇总 ====');
  console.log(JSON.stringify({ passed: ev.passedCount, failed: failures, fatal: ev.fatal, screenshots: ev.screenshots }, null, 2));
  process.exitCode = failures.length > 0 || ev.fatal ? 1 : 0;
  cdp.close();
}
