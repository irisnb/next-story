// card-delete-cancel-failure.mjs — 补 completion-evidence.md §2.1–2.3 的真机空白：
//   卡删除「取消」「失败（受控 I/O 故障注入）」「基线失效取消重确认（changed / missing）」。
// 真实 WebView + 真实 Rust 链路库，隔离实例 com.nextstory.acceptance；无模型请求；不改产品源码。
//
// 确认对话框：原生 confirm 无法自动点击，沿用既有验证方法经 devtools 通道改写 globalThis.confirm，
//   记录真实文案并判定接受/取消；业务结果仍由真实 Rust 命令 / 真实磁盘写入产生（非模型 mock）。
// 取消场景：弹确认时先记录文案，再由本脚本 resolve(false)（＝用户在对话框点「取消」）。
// 基线失效：确认文案已产生、await confirm 挂起期间，由本脚本直接改写**隔离 fixture** chains.json
//   （明确标注的 fixture 注入，非产品路径，非后端 API）。产品随后自身经真实 chain_library_load
//   重新读到被改动的隔离存储，走既有基线比对分支取消。
// 失败注入：把隔离 chains.json 置只读，令真实 Rust 原子写（tempfile persist）真失败；
//   **明确标注的故障注入**，不是 mock 冒充 Rust 失败。
// 依赖 seed-chains.mjs 做 fixture 复位。证据写入 evidence-making/。
import { mkdirSync, writeFileSync, readFileSync, chmodSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { connect } from './cdp-client.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, 'evidence-making');
mkdirSync(outDir, { recursive: true });

const APP_DATA = 'C:/Users/Administrator/AppData/Local/com.nextstory.acceptance';
const CHAINS_FILE = `${APP_DATA}/making-module/chains.json`;
const SEED = join(here, 'seed-chains.mjs');
const OWNED_DEV = 'C:/Users/Administrator/AppData/Local/Temp/opencode/acceptance-fix-ai/owned-dev.json';
const CHAIN_ID = 'chain-cdp-long-acceptance';
const VERSION_ID = 'chainver-cdp-long-1';
const DELETE_CARD_ID = 'card-cdp-second-2';

if (!APP_DATA.includes('com.nextstory.acceptance')) throw new Error('拒绝：非隔离 acceptance 数据目录');

const readLib = () => JSON.parse(readFileSync(CHAINS_FILE, 'utf8'));
const writeLib = (lib) => writeFileSync(CHAINS_FILE, JSON.stringify(lib, null, 2), 'utf8');
const clearReadonly = () => { try { chmodSync(CHAINS_FILE, 0o666); } catch { /* ignore */ } };
const setReadonly = () => chmodSync(CHAINS_FILE, 0o444);
const seed = () => execFileSync(process.execPath, [SEED], { cwd: here, stdio: 'ignore' });
const disk = () => {
  const j = readLib();
  const c = j.chains.find((x) => x.id === CHAIN_ID);
  const v1 = c?.versions.find((v) => v.id === VERSION_ID);
  return {
    active: j.active,
    versionCount: c?.versions.length ?? 0,
    v1CardIds: v1?.cards.map((k) => k.id) ?? null,
    v1CardCount: v1?.cards.length ?? null,
  };
};

const cdp = await connect(Number(process.argv[2] ?? 9225));
const ev = {
  started: new Date().toISOString(),
  target: cdp.target,
  isolation: { appData: APP_DATA, fixtureChainId: CHAIN_ID },
  faultInjections: [],
  fixtureInjections: [],
  stages: [],
  screenshots: [],
  assertions: [],
  consoleErrors: [],
  confirmMessages: {},
};
const shot = async (name) => { const f = join(outDir, `${name}.png`); await cdp.screenshot(f); ev.screenshots.push(f); return f; };
const assert = (name, pass, detail) => ev.assertions.push({ name, pass: !!pass, detail });

async function installPendingConfirm() {
  await cdp.evaluate(`(() => {
    window.__confirmLog = window.__confirmLog || [];
    window.__resolveConfirm = null;
    globalThis.confirm = (msg) => { window.__confirmLog.push(String(msg)); return new Promise((resolve) => { window.__resolveConfirm = resolve; }); };
    return true;
  })()`);
}
async function installImmediateConfirm(accept) {
  await cdp.evaluate(`(() => {
    window.__confirmLog = window.__confirmLog || [];
    window.__confirmAccept = ${accept};
    globalThis.confirm = (msg) => { window.__confirmLog.push(String(msg)); return Promise.resolve(window.__confirmAccept); };
    return true;
  })()`);
}
const confirmLog = () => cdp.evaluate(`(window.__confirmLog||[]).slice()`);
const resolveConfirm = (v) => cdp.evaluate(`(typeof window.__resolveConfirm === 'function' ? window.__resolveConfirm(${v}) : null)`);

async function clickText(scope, text) {
  const p = await cdp.evaluate(`(() => { const root=document.querySelector(${JSON.stringify(scope)}); if(!root) return null; const el=[...root.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(text)}); if(!el) return null; el.scrollIntoView({ block: 'center', inline: 'nearest' }); return true; })()`);
  if (!p) throw new Error(`clickText 未找到: ${scope} 「${text}」`);
  await cdp.pause(250);
  const pos = await cdp.evaluate(`(() => { const root=document.querySelector(${JSON.stringify(scope)}); const el=[...root.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(text)}); if(!el) return null; const r=el.getBoundingClientRect(); return r.width&&r.height?{x:r.x+r.width/2,y:r.y+r.height/2}:null; })()`);
  if (!pos) throw new Error(`clickText 目标不可见: ${scope} 「${text}」`);
  for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await cdp.send('Input.dispatchMouseEvent', { type, x: pos.x, y: pos.y, button: type === 'mouseMoved' ? 'none' : 'left', clickCount: 1 });
  await cdp.pause(250);
  return pos;
}

const domState = () => cdp.evaluate(`(() => ({
  versions: [...document.querySelectorAll('#making-version-select option')].map(o=>o.textContent.trim()),
  viewedIndex: document.querySelector('#making-version-select')?.selectedIndex,
  cardCount: document.querySelector('#making-card-count')?.textContent ?? null,
  using: document.querySelector('.making-version-using')?.textContent ?? null,
  statusError: (() => { const e=document.querySelector('#making-status-error'); return e && !e.classList.contains('hidden') ? e.textContent.trim() : null; })(),
  fullDetailVisible: (() => { const e=document.querySelector('#making-full-detail'); return !!e && !e.classList.contains('hidden'); })(),
  deleteBtn: (() => { const f=document.querySelector('#making-card-panel .making-card-actions'); if(!f) return null; const b=[...f.querySelectorAll('button')].find(x=>x.textContent.trim()==='删除卡片'); return b ? { disabled: b.disabled } : null; })(),
  cardRowPresent: !!document.querySelector('#making-card-list .making-card-row[data-card-id=${JSON.stringify(DELETE_CARD_ID)}]'),
}))()`);

async function openDeleteCardFull() {
  await cdp.evaluate(`document.querySelector('#making-card-list .making-card-row[data-card-id=${JSON.stringify(DELETE_CARD_ID)}]')?.click()`);
  await cdp.pause(250);
  await cdp.evaluate(`document.querySelector('.making-quick-open')?.click()`);
  await cdp.pause(300);
}

try {
  // ===== 前端重载到干净状态（清掉长驻应用内存里上一轮遗留的操作错误条），再重开隔离项目 =====
  await cdp.evaluate(`location.reload()`);
  await cdp.pause(3500);
  await cdp.evaluate(`document.querySelector('#recent-works-list .recent-work-item')?.click()`);
  for (let i = 0; i < 60; i++) { if (await cdp.evaluate(`!document.querySelector('#editor-page')?.classList.contains('hidden')`)) break; await cdp.pause(250); }
  ev.reopenedEditor = await cdp.evaluate(`!document.querySelector('#editor-page')?.classList.contains('hidden')`);
  assert('setup.reopenedIsolatedProject', ev.reopenedEditor === true, ev.reopenedEditor);

  // ===== owned 核实（隔离实例）=====
  ev.ownedDev = existsSync(OWNED_DEV) ? JSON.parse(readFileSync(OWNED_DEV, 'utf8')) : null;
  let overrideId = null;
  try { overrideId = JSON.parse(readFileSync(String(ev.ownedDev?.override), 'utf8')).identifier; } catch { /* ignore */ }
  ev.isolation.overrideIdentifier = overrideId;
  assert('isolation.ownedDevRecordPresent', ev.ownedDev !== null && overrideId === 'com.nextstory.acceptance', { ownedDev: ev.ownedDev, overrideId });
  assert('isolation.targetIsDevPage', String(ev.target.url).startsWith('http://localhost:1420'), ev.target.url);

  // ===== fixture 复位到确定基线 =====
  clearReadonly();
  seed();
  ev.baselineDisk = disk();
  assert('setup.seededOneVersionTwoCards', ev.baselineDisk.versionCount === 1 && ev.baselineDisk.v1CardCount === 2 && ev.baselineDisk.active === null, ev.baselineDisk);

  // ===== 进入制作页并选中 fixture 链路（切页触发 refresh）=====
  await cdp.evaluate(`document.querySelector('#tab-writing')?.click()`); await cdp.pause(200);
  await cdp.evaluate(`document.querySelector('#tab-making')?.click()`); await cdp.pause(400);
  for (let i = 0; i < 30; i++) { if (await cdp.evaluate(`document.querySelectorAll('#making-chain-list .making-chain-row').length > 0`)) break; await cdp.pause(200); }
  const rows = await cdp.evaluate(`[...document.querySelectorAll('#making-chain-list .making-chain-row')].map(b=>b.dataset.chainId)`);
  ev.isolation.chainRows = rows;
  assert('isolation.singleFixtureChain', rows.length === 1 && rows[0] === CHAIN_ID, rows);
  await cdp.evaluate(`document.querySelector('#making-chain-list .making-chain-row[data-chain-id=${JSON.stringify(CHAIN_ID)}]')?.click()`);
  await cdp.pause(400);
  ev.initialDom = await domState();
  assert('initial.twoCards', ev.initialDom.cardCount.includes('2'), ev.initialDom);

  // ================= 场景 1：取消（真实 UI 点删除 → 用户在确认对话框点取消）=================
  await openDeleteCardFull();
  ev.deleteReady = await domState();
  assert('cancel.deleteEnabledWithTwoCards', ev.deleteReady.deleteBtn?.disabled === false && ev.deleteReady.cardCount.includes('2'), ev.deleteReady);
  await installPendingConfirm();
  const logLen1 = (await confirmLog()).length;
  const before1 = disk();
  const domBefore1 = await domState();
  await clickText('#making-card-panel .making-card-actions', '删除卡片');
  ev.confirmMessages.cancel = (await confirmLog()).slice(logLen1);
  await resolveConfirm(false); // 用户在对话框点「取消」
  await cdp.pause(700);
  const after1 = disk();
  const dom1 = await domState();
  await shot('card-delete-cancel');
  ev.stages.push({ name: 'cancel', data: { before: before1, after: after1, domBefore: domBefore1, dom: dom1, confirm: ev.confirmMessages.cancel } });
  assert('cancel.confirmWordingRecorded', ev.confirmMessages.cancel.some((m) => m.includes('删除卡片') && m.includes('新版本')), ev.confirmMessages.cancel);
  assert('cancel.noVersionAppended', after1.versionCount === before1.versionCount && after1.versionCount === 1, { before: before1.versionCount, after: after1.versionCount });
  assert('cancel.activeUnchanged', JSON.stringify(after1.active) === JSON.stringify(before1.active) && after1.active === null, { before: before1.active, after: after1.active });
  assert('cancel.cardStaysCount2', after1.v1CardCount === 2 && after1.v1CardIds.includes(DELETE_CARD_ID), after1);
  assert('cancel.noNewError', dom1.statusError === domBefore1.statusError && dom1.statusError === null, { before: domBefore1.statusError, after: dom1.statusError });

  // ================= 场景 2：基线失效（changed）＝确认期间隔离存储中锁定版本卡内容被改 =========
  clearReadonly(); seed();
  ev.fixtureInjections.push({ scenario: 'baseline-changed', method: '直接改写隔离 fixture chains.json：把锁定版本 chainver-cdp-long-1 的删除目标卡 body 追加标记（明确标注的 fixture 注入，非产品路径）' });
  await openDeleteCardFull();
  await installPendingConfirm();
  const logLen2 = (await confirmLog()).length;
  const before2 = disk();
  await clickText('#making-card-panel .making-card-actions', '删除卡片');
  ev.confirmMessages.baselineChanged = (await confirmLog()).slice(logLen2);
  // —— 确认挂起期间注入 fixture 变更 ——
  const mutated = readLib();
  const mv1 = mutated.chains.find((c) => c.id === CHAIN_ID).versions.find((v) => v.id === VERSION_ID);
  const target = mv1.cards.find((k) => k.id === DELETE_CARD_ID);
  target.body = target.body + ' [BASELINE-FIXTURE-CHANGED]';
  writeLib(mutated);
  ev.stages.push({ name: 'baseline-changed.injection', data: { diskAfterInject: disk() } });
  await resolveConfirm(true); // 用户点「确认」
  await cdp.pause(900);
  const after2 = disk();
  const dom2 = await domState();
  await shot('card-delete-baseline-changed');
  ev.stages.push({ name: 'baseline-changed', data: { before: before2, after: after2, dom: dom2, confirm: ev.confirmMessages.baselineChanged } });
  assert('baselineChanged.confirmWordingRecorded', ev.confirmMessages.baselineChanged.some((m) => m.includes('删除卡片')), ev.confirmMessages.baselineChanged);
  assert('baselineChanged.cancelledWithReconfirmHint', (dom2.statusError ?? '').includes('删除已取消') && (dom2.statusError ?? '').includes('重新'), dom2.statusError);
  assert('baselineChanged.noVersionAppended', after2.versionCount === 1, { before: before2.versionCount, after: after2.versionCount });
  assert('baselineChanged.activeUnchanged', JSON.stringify(after2.active) === JSON.stringify(before2.active) && after2.active === null, { before: before2.active, after: after2.active });
  assert('baselineChanged.targetCardKept', after2.v1CardCount === 2 && after2.v1CardIds.includes(DELETE_CARD_ID), after2);

  // ================= 场景 3：基线失效（missing）＝确认期间锁定版本被删除 =================
  clearReadonly(); seed();
  ev.fixtureInjections.push({ scenario: 'baseline-missing', method: '直接改写隔离 fixture chains.json：确认挂起期间从链路中移除锁定版本 chainver-cdp-long-1（明确标注的 fixture 注入，非产品路径）' });
  await openDeleteCardFull();
  await installPendingConfirm();
  const logLen3 = (await confirmLog()).length;
  const before3 = disk();
  await clickText('#making-card-panel .making-card-actions', '删除卡片');
  ev.confirmMessages.baselineMissing = (await confirmLog()).slice(logLen3);
  const removed = readLib();
  const rc = removed.chains.find((c) => c.id === CHAIN_ID);
  rc.versions = rc.versions.filter((v) => v.id !== VERSION_ID);
  writeLib(removed);
  ev.stages.push({ name: 'baseline-missing.injection', data: { diskAfterInject: disk() } });
  await resolveConfirm(true);
  await cdp.pause(900);
  const after3 = disk();
  const dom3 = await domState();
  await shot('card-delete-baseline-missing');
  ev.stages.push({ name: 'baseline-missing', data: { before: before3, after: after3, dom: dom3, confirm: ev.confirmMessages.baselineMissing } });
  assert('baselineMissing.confirmWordingRecorded', ev.confirmMessages.baselineMissing.some((m) => m.includes('删除卡片')), ev.confirmMessages.baselineMissing);
  assert('baselineMissing.cancelledWithReconfirmHint', (dom3.statusError ?? '').includes('删除已取消') && (dom3.statusError ?? '').includes('重新'), dom3.statusError);
  assert('baselineMissing.noVersionAppended', after3.versionCount === 0, { before: before3.versionCount, after: after3.versionCount });
  assert('baselineMissing.activeUnchanged', JSON.stringify(after3.active) === JSON.stringify(before3.active) && after3.active === null, { before: before3.active, after: after3.active });

  // ================= 场景 4：失败（受控 I/O 故障注入：隔离 chains.json 置只读）=================
  clearReadonly(); seed();
  await cdp.evaluate(`document.querySelector('#tab-writing')?.click()`); await cdp.pause(200);
  await cdp.evaluate(`document.querySelector('#tab-making')?.click()`); await cdp.pause(500);
  await cdp.evaluate(`document.querySelector('#making-chain-list .making-chain-row[data-chain-id=${JSON.stringify(CHAIN_ID)}]')?.click()`);
  await cdp.pause(400);
  await openDeleteCardFull();
  await installImmediateConfirm(true);
  const logLen4 = (await confirmLog()).length;
  const before4 = disk();
  setReadonly(); // 受控 I/O 故障注入（明确标注，非 mock）
  ev.faultInjections.push({ scenario: 'failure', method: '把隔离 chains.json 置只读，令真实 Rust 原子写（tempfile persist → MoveFileEx）失败', file: CHAINS_FILE });
  await clickText('#making-card-panel .making-card-actions', '删除卡片');
  await cdp.pause(1600);
  const after4 = disk();
  const dom4 = await domState();
  await shot('card-delete-failure');
  ev.confirmMessages.failure = (await confirmLog()).slice(logLen4);
  ev.stages.push({ name: 'failure', data: { before: before4, after: after4, dom: dom4, confirm: ev.confirmMessages.failure } });
  assert('failure.realRustErrorShown', (dom4.statusError ?? '').includes('删除卡片失败'), dom4.statusError);
  assert('failure.noVersionAppended', after4.versionCount === 1, { before: before4.versionCount, after: after4.versionCount });
  assert('failure.activeUnchanged', JSON.stringify(after4.active) === JSON.stringify(before4.active) && after4.active === null, { before: before4.active, after: after4.active });
  assert('failure.targetCardKept', after4.v1CardCount === 2 && after4.v1CardIds.includes(DELETE_CARD_ID), after4);

  // ===== fixture 复位 =====
  clearReadonly();
  seed();
  ev.restoredDisk = disk();
  assert('restore.seedBaselineRestored', ev.restoredDisk.versionCount === 1 && ev.restoredDisk.v1CardCount === 2 && ev.restoredDisk.active === null, ev.restoredDisk);
} catch (error) {
  ev.stages.push({ name: 'fatal', error: String(error?.message ?? error) });
  try { clearReadonly(); seed(); } catch { /* ignore */ }
} finally {
  ev.consoleErrors = cdp.consoleErrors;
  ev.finished = new Date().toISOString();
  writeFileSync(join(outDir, 'evidence-card-delete-cancel-failure.json'), JSON.stringify(ev, null, 2));
  const failed = ev.assertions.filter((a) => !a.pass);
  process.exitCode = failed.length > 0 || ev.stages.some((s) => s.name === 'fatal') ? 1 : 0;
  console.log(JSON.stringify({ passed: ev.assertions.length - failed.length, total: ev.assertions.length, failed, fatal: ev.stages.find((s) => s.name === 'fatal') ?? null, statusErrors: { cancel: null, changed: ev.stages.find(s => s.name === 'baseline-changed')?.data?.dom?.statusError, missing: ev.stages.find(s => s.name === 'baseline-missing')?.data?.dom?.statusError, failure: ev.stages.find(s => s.name === 'failure')?.data?.dom?.statusError } }, null, 2));
  cdp.close();
}
