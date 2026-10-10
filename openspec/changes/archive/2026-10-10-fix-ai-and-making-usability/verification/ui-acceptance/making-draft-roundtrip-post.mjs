// making-draft-roundtrip-post.mjs — task 6.1 保存全文往返（保存后只读复核）。
// 前置：making-draft-roundtrip.mjs 已真实点击保存并落盘第2版（本脚本不重复保存）。
// 本脚本只读复核：查看对象跟进新版本/active 不变、存储第2版卡逐字、全页完整详情 DOM
// 首/中/尾 + 整体逐字、v1 长卡首中尾对照。不发模型请求、不写存储。
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { connect } from './cdp-client.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, 'evidence-making');
mkdirSync(outDir, { recursive: true });
const CHAINS_FILE = 'C:/Users/Administrator/AppData/Local/com.nextstory.acceptance/making-module/chains.json';
const CHAIN_ID = 'chain-cdp-long-acceptance';

const req = JSON.parse(readFileSync(join(outDir, 'making-draft-request.json'), 'utf8'));
const DRAFT = req.draftFull[0];
const BODY = DRAFT.body;
const WHEN = DRAFT.whenToUse;
const WHEN_NOT = DRAFT.whenNotToUse;
const TITLE = DRAFT.title;
const EXPECT_TRIGGER = `适用：${WHEN}\n不适用：${WHEN_NOT}`;
const head = BODY.slice(0, 20);
const midCenter = Math.floor(BODY.length / 2);
const mid = BODY.slice(midCenter - 10, midCenter + 10);
const tail = BODY.slice(-20);

const cdp = await connect(Number(process.argv[2] ?? 9225));
const ev = { started: new Date().toISOString(), target: cdp.target, phase: 'post-save-verify', assertions: [], stages: [], screenshots: [], consoleErrors: [] };
const shot = async (n) => { const f = join(outDir, `${n}.png`); await cdp.screenshot(f); ev.screenshots.push(f); return f; };
const assert = (name, pass, detail) => ev.assertions.push({ name, pass: !!pass, detail });
async function mouseClick(sel) {
  await cdp.evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(sel)});e&&e.scrollIntoView({block:'center',inline:'nearest'});})()`);
  await cdp.pause(120);
  const p = await cdp.evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(sel)});if(!e)return null;const r=e.getBoundingClientRect();return r.width&&r.height?{x:r.x+r.width/2,y:r.y+r.height/2}:null;})()`);
  if (!p) throw new Error(`鼠标点击目标不可见: ${sel}`);
  for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await cdp.send('Input.dispatchMouseEvent', { type, x: p.x, y: p.y, button: type === 'mouseMoved' ? 'none' : 'left', clickCount: 1 });
  await cdp.pause(200);
}
const disk = () => { const j = JSON.parse(readFileSync(CHAINS_FILE, 'utf8')); const c = j.chains.find((x) => x.id === CHAIN_ID); return { active: j.active, versions: (c?.versions ?? []).map((v) => ({ index: v.index, id: v.id, cards: v.cards.map((k) => ({ id: k.id, title: k.title, trigger_desc: k.trigger_desc, body: k.body, slot_type: k.slot_type })) })) }; };
async function readDetail() {
  return cdp.evaluate(`(() => {
    const sec = (h) => { const s = [...document.querySelectorAll('#making-card-panel .making-card-panel-section')].find(x => x.querySelector('.making-card-panel-heading')?.textContent.trim() === h); return s?.querySelector('.making-card-panel-body')?.textContent ?? null; };
    return {
      fullDetailHidden: document.getElementById('making-full-detail')?.classList.contains('hidden') ?? null,
      cardPanelHidden: document.getElementById('making-card-panel')?.classList.contains('hidden') ?? null,
      headings: [...document.querySelectorAll('#making-card-panel .making-card-panel-heading')].map(x => x.textContent.trim()),
      identity: sec('身份'), whenToUse: sec('何时用'), howTo: sec('怎么做'), change: sec('本版变化'),
      overall: document.getElementById('making-full-detail')?.innerText ?? null,
    };
  })()`);
}
async function openCardFull(cardId) {
  const sel = cardId ? `#making-card-list .making-card-row[data-card-id=${JSON.stringify(cardId)}]` : `#making-card-list .making-card-row`;
  await cdp.evaluate(`document.querySelector(${JSON.stringify(sel)})?.click()`);
  await cdp.pause(300);
  await mouseClick('.making-quick-open');
}

try {
  await cdp.evaluate(`document.querySelector('#tab-making')?.click()`); await cdp.pause(400);
  await cdp.evaluate(`document.querySelector('#making-view-map-btn')?.click()`); await cdp.pause(300);
  for (let i = 0; i < 25; i++) { if (await cdp.evaluate(`document.querySelectorAll('#making-chain-list .making-chain-row').length > 0`)) break; await cdp.pause(200); }
  await cdp.evaluate(`document.querySelector('#making-chain-list .making-chain-row[data-chain-id=${JSON.stringify(CHAIN_ID)}]')?.click()`);
  await cdp.pause(500);
  const inspectorVisible = await cdp.evaluate(`getComputedStyle(document.getElementById('making-inspector')).display !== 'none'`);
  const viewState = await cdp.evaluate(`(() => ({
    options: [...document.querySelectorAll('#making-version-select option')].map(o => o.textContent.trim()),
    selectedIndex: document.querySelector('#making-version-select')?.selectedIndex,
    selectedText: document.querySelector('#making-version-select option:checked')?.textContent?.trim() ?? null,
    using: document.querySelector('.making-version-using')?.textContent ?? null,
    notice: document.getElementById('making-session-notice')?.textContent ?? null,
  }))()`);
  const postDisk = disk();
  const v2 = postDisk.versions[postDisk.versions.length - 1];
  const v1 = postDisk.versions[0];
  ev.stages.push({ name: 'view-and-storage', data: { inspectorVisible, viewState, versions: postDisk.versions.map(v => ({ index: v.index, id: v.id, cardCount: v.cards.length })), active: postDisk.active } });
  assert('view.inspectorVisible', inspectorVisible === true, inspectorVisible);
  assert('view.autoFollowsNewVersion', postDisk.versions.length === 2 && (viewState.selectedText ?? '').includes('第2版'), { selectedIndex: viewState.selectedIndex, selectedText: viewState.selectedText, options: viewState.options });
  assert('view.activeNotAutoChanged', postDisk.active === null, postDisk.active);
  assert('view.usingStillIdle', (viewState.using ?? '').includes('未启用'), viewState.using);
  assert('storage.v2Index2', v2?.index === 2, v2?.index);
  assert('storage.cardTitleVerbatim', v2?.cards[0]?.title === TITLE, { got: v2?.cards[0]?.title, want: TITLE });
  assert('storage.triggerVerbatim', v2?.cards[0]?.trigger_desc === EXPECT_TRIGGER, { equal: v2?.cards[0]?.trigger_desc === EXPECT_TRIGGER });
  assert('storage.bodyVerbatim', v2?.cards[0]?.body === BODY, { equal: v2?.cards[0]?.body === BODY, gotLen: v2?.cards[0]?.body?.length, wantLen: BODY.length });
  assert('storage.slotTypeRequirement', v2?.cards[0]?.slot_type === 'requirement', v2?.cards[0]?.slot_type);
  assert('storage.v1HistoryPreserved', (v1?.cards.length ?? 0) === 2, v1?.cards.length);

  // 全页完整详情：新版本卡（399 字真实草稿）
  await openCardFull(v2.cards[0].id);
  const d2 = await readDetail();
  ev.stages.push({ name: 'detail-new-card', data: d2 });
  await shot('making-draft-rt-04-full-detail');
  assert('detail.fullModeVisible', d2.fullDetailHidden === false && d2.cardPanelHidden === false, { fullDetailHidden: d2.fullDetailHidden, cardPanelHidden: d2.cardPanelHidden });
  assert('detail.headings', JSON.stringify(d2.headings.slice(0, 4)) === JSON.stringify(['身份', '何时用', '怎么做', '本版变化']), d2.headings);
  assert('detail.whenToUseVerbatim', d2.whenToUse === EXPECT_TRIGGER, { equal: d2.whenToUse === EXPECT_TRIGGER, gotLen: d2.whenToUse?.length, wantLen: EXPECT_TRIGGER.length });
  assert('detail.howToVerbatim', d2.howTo === BODY, { equal: d2.howTo === BODY, gotLen: d2.howTo?.length, wantLen: BODY.length });
  assert('detail.bodyHeadMidTailPresent', d2.howTo?.includes(head) && d2.howTo?.includes(mid) && d2.howTo?.includes(tail), { head, mid, tail });
  assert('detail.overallContainsFullBody', (d2.overall ?? '').includes(BODY) && (d2.overall ?? '').includes(EXPECT_TRIGGER), { overallLen: d2.overall?.length });
  assert('detail.notLengthOrStartswithOnly', d2.howTo?.length === BODY.length && d2.howTo === BODY && d2.howTo !== BODY.slice(0, 60), { lengthMatch: d2.howTo?.length === BODY.length, fullEqual: d2.howTo === BODY });

  // 真实长内容：v1 长卡（只读对照首/中/尾）
  const longCard = v1.cards.find((k) => k.title === '长卡首中尾验收卡') ?? v1.cards[0];
  await cdp.evaluate(`(() => { const s = document.querySelector('#making-version-select'); s.value = ${JSON.stringify(v1.id)}; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  await cdp.pause(500);
  await openCardFull(longCard.id);
  const dLong = await readDetail();
  const lb = longCard.body;
  ev.stages.push({ name: 'detail-long-card', data: { title: longCard.title, bodyLen: lb.length, headings: dLong.headings, howToLen: dLong.howTo?.length, whenToUseLen: dLong.whenToUse?.length } });
  await shot('making-draft-rt-05-long-card-detail');
  assert('long.bodyVerbatim', dLong.howTo === lb, { equal: dLong.howTo === lb, gotLen: dLong.howTo?.length, wantLen: lb.length });
  assert('long.triggerVerbatim', dLong.whenToUse === longCard.trigger_desc, { equal: dLong.whenToUse === longCard.trigger_desc });
  assert('long.headMarker', dLong.howTo?.includes('【正文开头】') === true, dLong.howTo?.includes('【正文开头】'));
  assert('long.middleMarker', dLong.howTo?.includes('【正文中段】') === true, dLong.howTo?.includes('【正文中段】'));
  assert('long.tailMarker', dLong.howTo?.includes('【正文结尾】') === true, dLong.howTo?.includes('【正文结尾】'));
} catch (error) {
  ev.stages.push({ name: 'fatal', error: String(error?.message ?? error) });
} finally {
  ev.consoleErrors = cdp.consoleErrors;
  ev.finished = new Date().toISOString();
  writeFileSync(join(outDir, 'making-draft-roundtrip-post.json'), JSON.stringify(ev, null, 2));
  const failed = ev.assertions.filter((a) => !a.pass);
  process.exitCode = failed.length > 0 || ev.stages.some((s) => s.name === 'fatal') ? 1 : 0;
  console.log(JSON.stringify({ total: ev.assertions.length, failed, fatal: ev.stages.find((s) => s.name === 'fatal') ?? null }, null, 2));
  cdp.close();
}
