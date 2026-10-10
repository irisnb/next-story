// making-storage-and-versions.mjs — 无凭据可做的真实制作页存储/版本验收（真实 WebView + 真实 Rust 链路库）。
// 覆盖：卡直接删除追加新版本（历史保持、查看跟进）、最后一张卡禁删、保存不等于启用、
// 启用/停用经确认才改指针、全局单条；真实读取隔离实例 on-disk chains.json 佐证。
// 确认对话框：沿归档 change 的既有验证方法，经 devtools 通道改写 globalThis.confirm 并
//   记录真实确认文案（原生对话框无法自动点击；这不是模型 mock，也不伪造业务结果——
//   业务结果仍由真实 Rust 命令产生，只在应用层记录真实文案并判定接受/取消）。
// 依赖 seed-chains.mjs（隔离 fixture，2 张要求卡）。证据写入 evidence-making/。
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { connect } from './cdp-client.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, 'evidence-making');
mkdirSync(outDir, { recursive: true });
const CHAINS_FILE = 'C:/Users/Administrator/AppData/Local/com.nextstory.acceptance/making-module/chains.json';
const CHAIN_ID = 'chain-cdp-long-acceptance';

const cdp = await connect(Number(process.argv[2] ?? 9225));
const ev = { started: new Date().toISOString(), target: cdp.target, stages: [], screenshots: [], assertions: [], consoleErrors: [], confirmMessages: [] };
const shot = async (name) => { const f = join(outDir, `${name}.png`); await cdp.screenshot(f); ev.screenshots.push(f); return f; };
const assert = (name, pass, detail) => ev.assertions.push({ name, pass: !!pass, detail });

// 安装 confirm 改写：accepted=true 返回 Promise.resolve(true) 并记录文案；false 返回拒绝。
async function installConfirm(accepted) {
  await cdp.evaluate(`(() => {
    window.__confirmLog = window.__confirmLog || [];
    window.__confirmAccept = ${accepted};
    globalThis.confirm = (msg) => { window.__confirmLog.push(String(msg)); return Promise.resolve(window.__confirmAccept); };
    return { type: typeof globalThis.confirm };
  })()`);
}
const confirmLog = () => cdp.evaluate(`(window.__confirmLog||[]).slice()`);

async function clickText(scope, text) {
  const p = await cdp.evaluate(`(() => { const root=document.querySelector(${JSON.stringify(scope)}); if(!root) return null; const el=[...root.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(text)}); if(!el) return null; el.scrollIntoView({ block: 'center', inline: 'nearest' }); return true; })()`);
  if (!p) throw new Error(`clickText 未找到: ${scope} 「${text}」`);
  await cdp.pause(250);
  const pos = await cdp.evaluate(`(() => { const root=document.querySelector(${JSON.stringify(scope)}); const el=[...root.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(text)}); if(!el) return null; const r=el.getBoundingClientRect(); return r.width&&r.height?{x:r.x+r.width/2,y:r.y+r.height/2,inView: r.top>=0 && r.bottom<=innerHeight}:null; })()`);
  if (!pos) throw new Error(`clickText 目标不可见: ${scope} 「${text}」`);
  for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await cdp.send('Input.dispatchMouseEvent', { type, x: pos.x, y: pos.y, button: type === 'mouseMoved' ? 'none' : 'left', clickCount: 1 });
  await cdp.pause(200);
  return pos;
}
const opsState = () => cdp.evaluate(`(() => ({
  versions: [...document.querySelectorAll('#making-version-select option')].map(o=>o.textContent.trim()),
  viewedIndex: document.querySelector('#making-version-select')?.selectedIndex,
  using: document.querySelector('.making-version-using')?.textContent ?? null,
  inspectorState: document.querySelector('#making-inspector-state')?.textContent ?? null,
  cardCount: document.querySelector('#making-card-count')?.textContent ?? null,
  enable: { hidden: document.getElementById('making-enable-btn')?.hidden, text: document.getElementById('making-enable-btn')?.textContent.trim(), disabled: document.getElementById('making-enable-btn')?.disabled },
  deactivate: { text: document.getElementById('making-deactivate-btn')?.textContent.trim(), disabled: document.getElementById('making-deactivate-btn')?.disabled },
}))()`);
const diskState = () => { const j = JSON.parse(readFileSync(CHAINS_FILE, 'utf8')); const c = j.chains.find(x => x.id === CHAIN_ID); return { active: j.active, versionCount: c?.versions.length ?? 0, versionCardCounts: (c?.versions ?? []).map(v => ({ index: v.index, cards: v.cards.length, ids: v.cards.map(k => k.id) })) }; };
const openCardFull = async (cardId) => {
  const sel = cardId
    ? `#making-card-list .making-card-row[data-card-id=${JSON.stringify(cardId)}]`
    : `#making-card-list .making-card-row`;
  await cdp.evaluate(`document.querySelector(${JSON.stringify(sel)})?.click()`);
  await cdp.pause(250);
  await cdp.evaluate(`document.querySelector('.making-quick-open')?.click()`);
  await cdp.pause(300);
};

try {
  await cdp.evaluate(`document.querySelector('#tab-writing')?.click()`); await cdp.pause(200);
  await cdp.evaluate(`document.querySelector('#tab-making')?.click()`); await cdp.pause(400);
  for (let i = 0; i < 25; i++) { if (await cdp.evaluate(`document.querySelectorAll('#making-chain-list .making-chain-row').length > 0`)) break; await cdp.pause(200); }
  await cdp.evaluate(`document.querySelector('#making-chain-list .making-chain-row[data-chain-id=${JSON.stringify(CHAIN_ID)}]')?.click()`);
  await cdp.pause(400);
  ev.confirmTypeBefore = await cdp.evaluate(`typeof globalThis.confirm`);
  await installConfirm(true);
  ev.initial = await opsState();
  ev.initialDisk = diskState();
  assert('initial.noActive', ev.initialDisk.active === null && ev.initial.inspectorState.includes('尚未启用'), { disk: ev.initialDisk.active, state: ev.initial.inspectorState });
  assert('initial.twoCards', ev.initial.cardCount.includes('2'), ev.initial.cardCount);

  // ===== 启用经确认才改指针 =====
  const logBeforeEnable = (await confirmLog()).length;
  await cdp.click('#making-enable-btn');
  await cdp.pause(900);
  ev.confirmMessages.enable = (await confirmLog()).slice(logBeforeEnable);
  ev.afterEnable = await opsState();
  ev.afterEnableDisk = diskState();
  ev.stages.push({ name: 'enable', data: { afterEnable: ev.afterEnable, disk: ev.afterEnableDisk, confirm: ev.confirmMessages.enable } });
  await shot('versions-after-enable');
  assert('enable.confirmMessageRecorded', ev.confirmMessages.enable.length >= 1, ev.confirmMessages.enable);
  assert('enable.activeSetSingle', ev.afterEnableDisk.active !== null && ev.afterEnableDisk.active.version_id != null, ev.afterEnableDisk.active);
  assert('enable.usingLabelShown', (ev.afterEnable.using ?? '').includes('正在使用') && !(ev.afterEnable.using ?? '').includes('未启用'), ev.afterEnable.using);

  // ===== 保存（删除卡追加新版本）不等于启用 =====
  await openCardFull('card-cdp-second-2');
  ev.deleteBeforeDisk = diskState();
  const logBeforeDelete = (await confirmLog()).length;
  await clickText('#making-card-panel .making-card-actions', '删除卡片');
  await cdp.pause(1100);
  ev.confirmMessages.cardDelete = (await confirmLog()).slice(logBeforeDelete);
  ev.afterDelete = await opsState();
  ev.afterDeleteDisk = diskState();
  await shot('versions-after-card-delete');
  ev.stages.push({ name: 'card-delete', data: { afterDelete: ev.afterDelete, disk: ev.afterDeleteDisk, confirm: ev.confirmMessages.cardDelete } });
  assert('cardDelete.confirmWording', ev.confirmMessages.cardDelete.some(m => m.includes('新版本') && m.includes('历史版本保持不变') && m.includes('不自动启用') && m.includes('下一轮')), ev.confirmMessages.cardDelete);
  assert('cardDelete.appendsVersion', ev.afterDeleteDisk.versionCount === ev.deleteBeforeDisk.versionCount + 1, { before: ev.deleteBeforeDisk.versionCount, after: ev.afterDeleteDisk.versionCount });
  assert('cardDelete.historyPreserved', (ev.afterDeleteDisk.versionCardCounts.find(v => v.index === 1)?.cards ?? 0) === 2, ev.afterDeleteDisk.versionCardCounts);
  assert('cardDelete.newVersionHasOneCard', (ev.afterDeleteDisk.versionCardCounts.find(v => v.index === 2)?.cards ?? -1) === 1, ev.afterDeleteDisk.versionCardCounts);
  assert('cardDelete.viewFollowsNewVersion', (ev.afterDelete.versions[ev.afterDelete.viewedIndex] ?? '').includes('第2版'), { viewedIndex: ev.afterDelete.viewedIndex, versions: ev.afterDelete.versions });
  assert('cardDelete.activeUnchanged', ev.afterDeleteDisk.active?.version_id === ev.afterEnableDisk.active?.version_id, { before: ev.afterEnableDisk.active, after: ev.afterDeleteDisk.active });
  assert('cardDelete.usingStillOld', (ev.afterDelete.using ?? '').includes('第1版'), ev.afterDelete.using);

  // ===== 最后一张卡禁删 + 说明 =====
  await openCardFull();
  ev.lastCard = await cdp.evaluate(`(() => {
    const footer = document.querySelector('#making-card-panel .making-card-actions');
    const del = footer ? [...footer.querySelectorAll('button')].find(b=>b.textContent.trim()==='删除卡片') : null;
    const note = footer ? [...footer.querySelectorAll('.making-readonly-note')].map(p=>p.textContent.trim()) : [];
    return { delDisabled: del?.disabled ?? null, delTitle: del?.title ?? null, notes: note };
  })()`);
  await shot('last-card-disabled');
  ev.stages.push({ name: 'last-card', data: ev.lastCard });
  assert('lastCard.deleteDisabledWithNote', ev.lastCard.delDisabled === true && ev.lastCard.notes.some(n => n.includes('至少保留一张卡')), ev.lastCard);

  // ===== 停用经确认改指针 =====
  const logBeforeDeact = (await confirmLog()).length;
  await cdp.click('#making-deactivate-btn');
  await cdp.pause(900);
  ev.confirmMessages.deactivate = (await confirmLog()).slice(logBeforeDeact);
  ev.afterDeactivate = await opsState();
  ev.afterDeactivateDisk = diskState();
  await shot('versions-after-deactivate');
  ev.stages.push({ name: 'deactivate', data: { afterDeactivate: ev.afterDeactivate, disk: ev.afterDeactivateDisk, confirm: ev.confirmMessages.deactivate } });
  assert('deactivate.confirmMessageRecorded', ev.confirmMessages.deactivate.length >= 1, ev.confirmMessages.deactivate);
  assert('deactivate.activeCleared', ev.afterDeactivateDisk.active === null, ev.afterDeactivateDisk.active);
  assert('deactivate.usingLabelIdle', (ev.afterDeactivate.using ?? '').includes('未启用'), ev.afterDeactivate.using);

  // ===== 不经确认不改指针：取消启用 =====
  await cdp.evaluate(`(() => { const s=document.querySelector('#making-version-select'); s.selectedIndex=s.options.length-1; s.dispatchEvent(new Event('change',{bubbles:true})); })()`);
  await cdp.pause(350);
  const beforeCancel = diskState();
  await installConfirm(false); // 取消
  const enableAvailable = !(await cdp.evaluate(`document.getElementById('making-enable-btn')?.hidden`));
  if (enableAvailable) { await cdp.click('#making-enable-btn'); await cdp.pause(700); }
  const afterCancel = diskState();
  ev.stages.push({ name: 'enable-cancel', data: { enableAvailable, beforeCancel: beforeCancel.active, afterCancel: afterCancel.active } });
  assert('enable.cancelKeepsPointer', JSON.stringify(beforeCancel.active) === JSON.stringify(afterCancel.active), { before: beforeCancel.active, after: afterCancel.active });
} catch (error) {
  ev.stages.push({ name: 'fatal', error: String(error?.message ?? error) });
} finally {
  ev.consoleErrors = cdp.consoleErrors;
  ev.finished = new Date().toISOString();
  writeFileSync(join(outDir, 'evidence-making-storage-versions.json'), JSON.stringify(ev, null, 2));
  const failed = ev.assertions.filter(a => !a.pass);
  process.exitCode = failed.length > 0 || ev.stages.some(s => s.name === 'fatal') ? 1 : 0;
  console.log(JSON.stringify({ assertions: ev.assertions, failed, fatal: ev.stages.find(s => s.name === 'fatal') ?? null }, null, 2));
  cdp.close();
}
