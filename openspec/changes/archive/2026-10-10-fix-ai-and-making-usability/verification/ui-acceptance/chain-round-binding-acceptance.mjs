// chain-round-binding-acceptance.mjs — task 7.3/7.4 真实在途/下一轮链路版本绑定验收。
// 真实 Tauri 隔离实例（identifier com.nextstory.acceptance，CDP 9225）+ 真实 Rust 链路线 + 真实模型。
// 目标：通过真实 UI 启用 v1 → 发一次常规讨论首轮请求 → 请求在途（loading 可见）时经真实 UI 启用 v2
//   → 证明在途请求绑定 v1（后端档案 chain_rounds 里该轮 version_index=1，且该记录仅在成功后按发起时
//     冻结值落档）→ 同讨论追问 → 证明下一轮绑定 v2。
// 证据口径：真实请求发送链路版本身份 = 后端以发起时冻结快照落档的 chain_rounds（冻结与档案同源），
//   非模型回复措辞推断。另读实时「本轮链路」只读行。
// 边界：不改产品源码/配置/keyring/正式用户数据；只写证据与隔离 fixture 指针；不发多余请求。
//   confirm 覆盖：原生系统对话框无法自动点击，沿既有验收方法经 devtools 通道改写 globalThis.confirm
//   并记录真实确认文案；业务结果仍由真实 Rust 命令产生，不伪造。
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { connect } from './cdp-client.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, 'evidence-binding');
mkdirSync(outDir, { recursive: true });

const CHAINS_FILE = 'C:/Users/Administrator/AppData/Local/com.nextstory.acceptance/making-module/chains.json';
const CONVOS_DIR = 'C:/Users/Administrator/AppData/Local/Temp/opencode/acceptance-fix-ai/project-geometry/CDP几何验收-隔离/next-story-system/conversations';
const CHAIN_ID = 'chain-cdp-long-acceptance';
const CHAIN_NAME = 'CDP长卡验收链';
const V1_ID = 'chainver-cdp-long-1';
const V2_ID = 'chainver-1791640932954121800-1';
const PROJECT_NAME = 'CDP几何验收-隔离';

// 合成验收问题（非正式用户文本）；要求稍长回答以留出在途窗口。
const QUESTION = '请直接回答：在陪想里，如果我只给你一句话片段，你会先做什么、后做什么？用四到六句话说明你的处理顺序，每句话都说清依据。';
const FOLLOW_UP = '接着上一个问题：如果这句话片段里既有确定的事实、也有我拿不准的猜测，你会怎么把它们分开并告诉我？用两三句话即可。';

const cdp = await connect(Number(process.argv[2] ?? 9225));
const ev = { started: new Date().toISOString(), target: cdp.target, chainId: CHAIN_ID, v1: V1_ID, v2: V2_ID, assertions: [], stages: [], screenshots: [], consoleErrors: [], confirmMessages: [], samples: [] };
const T0 = Date.now();
const shot = async (n) => { const f = join(outDir, `${n}.png`); await cdp.screenshot(f); ev.screenshots.push(f); return f; };
const assert = (name, pass, detail) => ev.assertions.push({ name, pass: !!pass, detail });
const mark = (name, data) => { ev.stages.push({ name, t: Date.now() - T0, data }); };

const disk = () => {
  const j = JSON.parse(readFileSync(CHAINS_FILE, 'utf8'));
  const c = j.chains.find((x) => x.id === CHAIN_ID);
  return { active: j.active ?? null, versions: (c?.versions ?? []).map((v) => ({ index: v.index, id: v.id, cards: v.cards.length })) };
};
const listConvoIds = () => readdirSync(CONVOS_DIR).filter((f) => f.endsWith('.json') && !f.endsWith('.meta.json')).map((f) => f.slice(0, -5));
const readConvo = (id) => JSON.parse(readFileSync(join(CONVOS_DIR, `${id}.json`), 'utf8'));
const tryReadConvo = (id, attempts = 4) => { for (let i = 0; i < attempts; i++) { try { return readConvo(id); } catch { /* 半写/未落盘，重试 */ } } return null; };
const assistantDoneCount = (r) => (r?.turns ?? []).filter((t) => t.role === 'assistant' && (t.status === 'done' || t.status === 'success' || (t.status === undefined && (t.text ?? '').length > 0))).length;

async function installConfirm(accepted) {
  await cdp.evaluate(`(() => {
    window.__binderConfirmLog = window.__binderConfirmLog || [];
    window.__binderConfirmAccept = ${accepted};
    globalThis.confirm = (msg) => { window.__binderConfirmLog.push(String(msg)); return Promise.resolve(window.__binderConfirmAccept); };
    return true;
  })()`);
}
const confirmLog = () => cdp.evaluate(`(window.__binderConfirmLog||[]).slice()`);

const waitActive = async (pred, ms = 8000) => { const end = Date.now() + ms; let last = null; while (Date.now() < end) { last = disk(); if (pred(last.active)) return last; await cdp.pause(150); } return last; };
// 在途判据（直接提问首轮与追问共用）：对话流里存在「正在思考…」状态消息；首轮另有 direct-question 发送键禁用。
// 完成后该状态消息消失（既有对话流不再含 status 消息）。
const inFlightNow = () => cdp.evaluate(`(() => {
  const status = document.querySelector('.ai-window .ai-message-status');
  const dq = document.querySelector('[data-role="direct-question-send"]');
  const statusText = status ? status.textContent.trim() : null;
  return { statusText, directDisabled: dq ? dq.disabled : null, inFlight: !!status || (dq ? dq.disabled : false) };
})()`);
const waitInFlight = async (want, ms = 20000) => {
  const end = Date.now() + ms; let last = null;
  while (Date.now() < end) { last = await inFlightNow(); if (last.inFlight === want) return last; await cdp.pause(150); }
  return last ?? { inFlight: !want };
};
const setVersion = async (versionId) => {
  await cdp.evaluate(`(() => { const s=document.querySelector('#making-version-select'); if(!s) return false; s.value=${JSON.stringify(versionId)}; s.dispatchEvent(new Event('change',{bubbles:true})); return s.value===${JSON.stringify(versionId)}; })()`);
  await cdp.pause(400);
};
const selectChain = async () => { await cdp.evaluate(`document.querySelector('#making-chain-list .making-chain-row[data-chain-id=${JSON.stringify(CHAIN_ID)}]')?.click()`); await cdp.pause(400); };
const makingReady = async () => { for (let i = 0; i < 25; i++) { if (await cdp.evaluate(`document.querySelectorAll('#making-chain-list .making-chain-row').length > 0`)) return true; await cdp.pause(200); } return false; };
const enableState = () => cdp.evaluate(`(() => { const b=document.getElementById('making-enable-btn'); return { hidden: b?.hidden ?? null, text: b?.textContent.trim() ?? null, disabled: b?.disabled ?? null }; })()`);
const opsState = () => cdp.evaluate(`(() => ({
  versions: [...document.querySelectorAll('#making-version-select option')].map(o=>o.textContent.trim()),
  viewedValue: document.querySelector('#making-version-select')?.value ?? null,
  using: document.querySelector('.making-version-using')?.textContent ?? null,
  inspectorState: document.querySelector('#making-inspector-state')?.textContent ?? null,
}))()`);
const chainLines = () => cdp.evaluate(`[...document.querySelectorAll('.ai-material-chain')].map(e=>e.textContent.trim())`);

try {
  // —— P0：项目就绪（欢迎页则打开隔离项目）——
  const welcome = await cdp.evaluate(`!document.querySelector('#welcome-page')?.classList.contains('hidden')`);
  if (welcome) {
    await cdp.evaluate(`(() => { const it=[...document.querySelectorAll('.recent-work-item')].find(e=>(e.querySelector('.recent-work-name')?.textContent||'').includes(${JSON.stringify(PROJECT_NAME)})); it?.click(); })()`);
    for (let i = 0; i < 60; i++) { if (await cdp.evaluate(`!document.querySelector('#editor-page')?.classList.contains('hidden')`)) break; await cdp.pause(200); }
  }
  mark('project', await cdp.evaluate(`({ name: document.querySelector('#current-project-name')?.textContent ?? null })`));

  // —— P0.5：制作页，选中链路；确认启用/停用同区（7.4 启停同区）——
  await cdp.evaluate(`document.querySelector('#tab-making')?.click()`); await cdp.pause(400);
  await makingReady();
  await selectChain();

  // 归一化：若隔离 fixture 残留启用指针，先经真实 UI 停用，保证从「未启用」起（可幂等重跑）。
  const preNorm = disk();
  if (preNorm.active !== null) {
    await installConfirm(true);
    await cdp.evaluate(`(() => { const b=document.getElementById('making-deactivate-btn'); if(b && !b.disabled) b.click(); })()`);
    const cleared = await waitActive((a) => a === null, 8000);
    mark('normalize-deactivate', { before: preNorm.active, after: cleared.active });
  }

  const sameArea = await cdp.evaluate(`(() => {
    const area = document.querySelector('#making-inspector-content .making-version-operations');
    const en = document.getElementById('making-enable-btn');
    const de = document.getElementById('making-deactivate-btn');
    return { areaExists: !!area, enableInside: !!area && !!en && area.contains(en), deactivateInside: !!area && !!de && area.contains(de), areaAria: area?.getAttribute('aria-label') ?? null };
  })()`);
  assert('sameArea.enableAndDeactivateInVersionOperations', sameArea.areaExists && sameArea.enableInside && sameArea.deactivateInside, sameArea);

  // 记录初始指针（期望未启用）。
  ev.initialDisk = disk();
  assert('initial.notEnabled', ev.initialDisk.active === null, ev.initialDisk.active);

  // —— P1：不经确认不改指针（7.3 取消启用）——
  await setVersion(V1_ID);
  await installConfirm(false); // 取消确认
  const logBeforeCancel = (await confirmLog()).length;
  const enableAvail = await enableState();
  if (enableAvail.hidden === false) { await cdp.click('#making-enable-btn'); await cdp.pause(800); }
  ev.cancelConfirmMsg = (await confirmLog()).slice(logBeforeCancel);
  ev.afterCancelDisk = disk();
  assert('cancel.confirmMessageRecorded', ev.cancelConfirmMsg.length >= 1, ev.cancelConfirmMsg);
  assert('cancel.pointerUnchanged', JSON.stringify(ev.afterCancelDisk.active) === JSON.stringify(ev.initialDisk.active), { before: ev.initialDisk.active, after: ev.afterCancelDisk.active });

  // —— P2：经确认启用 v1（真实 UI，真实 Rust chain_set_active）——
  await installConfirm(true);
  await selectChain();
  await setVersion(V1_ID);
  const v1Enable = await enableState();
  assert('v1.enableLabelPresent', v1Enable.hidden === false && (v1Enable.text ?? '').includes('第1版'), v1Enable);
  const logBeforeV1 = (await confirmLog()).length;
  await cdp.click('#making-enable-btn');
  const v1Disk = await waitActive((a) => a?.version_id === V1_ID, 8000);
  ev.v1ConfirmMsg = (await confirmLog()).slice(logBeforeV1);
  ev.p2 = { enableState: v1Enable, disk: v1Disk, ops: await opsState(), confirm: ev.v1ConfirmMsg };
  assert('v1.activeSetToV1', v1Disk.active?.chain_id === CHAIN_ID && v1Disk.active?.version_id === V1_ID, v1Disk.active);
  mark('v1-enabled', ev.p2);
  await shot('binding-00-v1-enabled');

  // —— P3：写作页 → 开 AI 面板 → 新建对话 → 输入常规首轮问题 ——
  const preIds = new Set(listConvoIds());
  await cdp.evaluate(`document.querySelector('#tab-writing')?.click()`); await cdp.pause(500);
  const dockVisible = await cdp.evaluate(`(() => { const d=document.querySelector('#ai-dock'); return !!d && !d.classList.contains('hidden') && d.getBoundingClientRect().width>0; })()`);
  if (!dockVisible) { await cdp.evaluate(`document.querySelector('#btn-toggle-ai')?.click()`); await cdp.pause(500); }
  await cdp.evaluate(`document.querySelector('#ai-conversation-list-toggle')?.click()`); await cdp.pause(400);
  await cdp.evaluate(`document.querySelector('#ai-list-new-conversation')?.click()`); await cdp.pause(700);
  await cdp.fillText('[data-role="direct-question-input"]', QUESTION);
  await cdp.pause(200);
  const sendReady = await cdp.evaluate(`(() => { const b=document.querySelector('[data-role="direct-question-send"]'); return b ? !b.disabled : null; })()`);
  assert('first.sendEnabled', sendReady === true, sendReady);
  mark('first-question-typed', { len: QUESTION.length, sendReady });

  // —— P4：发送 → 观察在途（对话流「正在思考…」状态可见＝请求在途）——
  const tSend = Date.now() - T0;
  await cdp.click('[data-role="direct-question-send"]');
  const inflightSeen = await waitInFlight(true, 20000);
  const tInFlight = Date.now() - T0;
  assert('first.inFlightStatusVisible', inflightSeen.inFlight === true, { tSend, tInFlight, detail: inflightSeen });
  await cdp.pause(800); // 真实命令已在途，留出冻结完成时间后立即切换
  const stillInFlightBeforeSwitch = (await inFlightNow()).inFlight;
  ev.inflight = { tSend, tInFlight, stillInFlightBeforeSwitch, inflightSample: inflightSeen, diskAtInflight: disk() };
  await shot('binding-01-inflight-v1');
  mark('inflight-first-round', ev.inflight);

  // —— P5：在途时经真实 UI 启用 v2 ——
  await cdp.evaluate(`document.querySelector('#tab-making')?.click()`); await cdp.pause(400);
  await makingReady();
  await selectChain();
  await setVersion(V2_ID);
  const v2Enable = await enableState();
  assert('v2.enableLabelPresent', v2Enable.hidden === false && (v2Enable.text ?? '').includes('第2版'), v2Enable);
  const logBeforeV2 = (await confirmLog()).length;
  await cdp.click('#making-enable-btn');
  const v2Disk = await waitActive((a) => a?.version_id === V2_ID, 8000);
  const tV2 = Date.now() - T0;
  ev.v2ConfirmMsg = (await confirmLog()).slice(logBeforeV2);
  // 此刻新讨论档案是否已完成首轮（未完成＝请求在途）。
  const newIdAtV2 = listConvoIds().find((id) => !preIds.has(id)) ?? null;
  let firstRoundDoneAtV2 = null;
  if (newIdAtV2 !== null) { const r = tryReadConvo(newIdAtV2, 6); firstRoundDoneAtV2 = r === null ? null : assistantDoneCount(r) > 0; }
  ev.p5 = { enableState: v2Enable, disk: v2Disk, ops: await opsState(), confirm: ev.v2ConfirmMsg, tV2, newConvoId: newIdAtV2, firstRoundDoneAtV2 };
  assert('v2.activeSetToV2', v2Disk.active?.chain_id === CHAIN_ID && v2Disk.active?.version_id === V2_ID, v2Disk.active);
  assert('inflight.requestNotCompletedWhenV2Enabled', firstRoundDoneAtV2 === false, { newConvoId: newIdAtV2, firstRoundDoneAtV2 });
  mark('v2-enabled-inflight', ev.p5);
  await shot('binding-02-v2-enabled-inflight');

  // —— P6：回到写作页，等待首轮完成，读实时「本轮链路」+ 档案 ——
  await cdp.evaluate(`document.querySelector('#tab-writing')?.click()`); await cdp.pause(400);
  const stillInFlightAtReturn = (await inFlightNow()).inFlight;
  ev.afterV2Return = { stillInFlightAtReturn };
  const convId = newIdAtV2 ?? (await (async () => { const end = Date.now() + 8000; while (Date.now() < end) { const id = listConvoIds().find((x) => !preIds.has(x)); if (id) return id; await cdp.pause(200); } return null; })());
  assert('first.conversationFileFound', convId !== null, convId);
  let firstConvo = null;
  { const end = Date.now() + 90000; while (Date.now() < end) { try { const r = readConvo(convId); if (assistantDoneCount(r) >= 1) { firstConvo = r; break; } } catch {} await cdp.pause(500); } }
  const tFirstDone = Date.now() - T0;
  ev.firstConvoId = convId;
  ev.firstRound = firstConvo === null ? null : {
    chainRounds: firstConvo.chain_rounds ?? null,
    assistantDone: assistantDoneCount(firstConvo),
    userTurns: (firstConvo.turns ?? []).filter((t) => t.role === 'user').length,
  };
  // 实时「本轮链路」只读行（若材料面板入口可见则打开）。
  await cdp.evaluate(`document.querySelector('[data-role="materials-toggle"]')?.click()`).catch(() => {});
  await cdp.pause(300);
  ev.firstChainLines = await chainLines();
  await shot('binding-03-first-round-done');

  const cr0 = (firstConvo?.chain_rounds ?? []).find((r) => r.turn_index === 0) ?? null;
  assert('first.roundCompleted', firstConvo !== null, { tFirstDone });
  assert('first.boundToV1ByFrozenRecord', cr0?.chain_id === CHAIN_ID && cr0?.version_index === 1, cr0);
  assert('first.inflightCompletionAfterV2Enable', tFirstDone > tV2, { tV2, tFirstDone });

  // —— P7：同讨论追问 → 下一轮绑定 v2 ——
  const followReady = await cdp.evaluate(`(() => { const f=document.querySelector('.ai-window [data-role="follow-up-form"]'); return !!f && !f.classList.contains('hidden'); })()`);
  if (followReady) {
    await cdp.fillText('.ai-window [data-role="follow-up-input"]', FOLLOW_UP);
    await cdp.pause(200);
    const fSend = await cdp.evaluate(`(() => { const b=document.querySelector('.ai-window [data-role="follow-up-send"]'); return b ? !b.disabled : null; })()`);
    assert('followup.sendEnabled', fSend === true, fSend);
    await cdp.click('.ai-window [data-role="follow-up-send"]');
    const followInflight = await waitInFlight(true, 20000);
    mark('followup-sent', { followInflight });
    let secondConvo = null;
    { const end = Date.now() + 90000; while (Date.now() < end) { try { const r = readConvo(convId); if (assistantDoneCount(r) >= 2) { secondConvo = r; break; } } catch {} await cdp.pause(500); } }
    ev.followUp = secondConvo === null ? null : {
      chainRounds: secondConvo.chain_rounds ?? null,
      assistantDone: assistantDoneCount(secondConvo),
      userTurns: (secondConvo.turns ?? []).filter((t) => t.role === 'user').length,
    };
    ev.secondChainLines = await chainLines();
    await shot('binding-04-followup-done');
    const cr1 = (secondConvo?.chain_rounds ?? []).find((r) => r.turn_index === 1) ?? null;
    assert('followup.roundCompleted', secondConvo !== null, {});
    assert('followup.nextRoundBoundToV2', cr1?.chain_id === CHAIN_ID && cr1?.version_index === 2, cr1);
    assert('followup.firstRoundStillV1', ((secondConvo?.chain_rounds ?? []).find((r) => r.turn_index === 0)?.version_index) === 1, secondConvo?.chain_rounds ?? null);
  } else {
    assert('followup.formAvailable', false, '追问表单不可见');
  }

  // —— P8：停用（恢复隔离 fixture 到未启用），真实 UI 经确认 ——
  await cdp.evaluate(`document.querySelector('#tab-making')?.click()`); await cdp.pause(400);
  await makingReady();
  await selectChain();
  await installConfirm(true);
  const deact = await cdp.evaluate(`(() => { const b=document.getElementById('making-deactivate-btn'); return { disabled: b?.disabled ?? null, text: b?.textContent.trim() ?? null }; })()`);
  if (deact.disabled === false) {
    const logBeforeDeact = (await confirmLog()).length;
    await cdp.click('#making-deactivate-btn');
    const deactDisk = await waitActive((a) => a === null, 8000);
    ev.deactivate = { button: deact, disk: deactDisk, confirm: (await confirmLog()).slice(logBeforeDeact) };
    assert('deactivate.activeCleared', deactDisk.active === null, deactDisk.active);
  } else {
    ev.deactivate = { button: deact, skipped: true };
    assert('deactivate.buttonEnabled', false, deact);
  }
  mark('deactivated', ev.deactivate);
} catch (error) {
  ev.fatal = String(error?.message ?? error);
  mark('fatal', ev.fatal);
} finally {
  ev.consoleErrors = cdp.consoleErrors;
  ev.finished = new Date().toISOString();
  writeFileSync(join(outDir, 'chain-round-binding-acceptance.json'), JSON.stringify(ev, null, 2));
  const failed = ev.assertions.filter((a) => !a.pass);
  process.exitCode = failed.length > 0 || ev.fatal ? 1 : 0;
  console.log(JSON.stringify({ total: ev.assertions.length, failed, fatal: ev.fatal ?? null, stages: ev.stages.map((s) => ({ name: s.name, t: s.t })), firstRound: ev.firstRound, followUp: ev.followUp, firstChainLines: ev.firstChainLines, secondChainLines: ev.secondChainLines }, null, 2));
  cdp.close();
}
