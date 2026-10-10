// making-draft-roundtrip.mjs — task 6.1 保存全文往返（真机 CDP，无模型请求）。
// 只读复用 9225 隔离制作页上既有 turn3 真实草稿：真实 UI 点保存 → 确认对话框展开全文核对
// → 用户式确认保存 → 存储/查看版本/DOM 全页详情逐字对照。不发任何模型请求。
// 不写产品源码/配置/keyring/正式项目；不 commit/archive。证据写入 evidence-making/。
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { connect } from './cdp-client.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, 'evidence-making');
mkdirSync(outDir, { recursive: true });
const CHAINS_FILE = 'C:/Users/Administrator/AppData/Local/com.nextstory.acceptance/making-module/chains.json';
const CHAIN_ID = 'chain-cdp-long-acceptance';

// —— 原始解析草稿字段（来自已存在的 making-draft-request.json 的 draftFull，逐字）——
const req = JSON.parse(readFileSync(join(outDir, 'making-draft-request.json'), 'utf8'));
const DRAFT = req.draftFull[0];
const BODY = DRAFT.body;
const WHEN = DRAFT.whenToUse;
const WHEN_NOT = DRAFT.whenNotToUse;
const TITLE = DRAFT.title;
// 存储口径（源码 draftToCardInput + Rust save_version_in_dir）：trigger 包装，body 原样。
const EXPECT_TRIGGER = `适用：${WHEN}\n不适用：${WHEN_NOT}`;
// 确认对话框 pre 口径（源码 confirmDraftSave 第 143 行）。
const EXPECT_PRE = `卡名：${TITLE}\n何时用：${WHEN}\n何时不用：${WHEN_NOT}\n正文：\n${BODY}`;
const head = BODY.slice(0, 20);
const midCenter = Math.floor(BODY.length / 2);
const mid = BODY.slice(midCenter - 10, midCenter + 10);
const tail = BODY.slice(-20);

const cdp = await connect(Number(process.argv[2] ?? 9225));
const ev = { started: new Date().toISOString(), target: cdp.target, assertions: [], stages: [], screenshots: [], consoleErrors: [] };
const shot = async (n) => { const f = join(outDir, `${n}.png`); await cdp.screenshot(f); ev.screenshots.push(f); return f; };
const assert = (name, pass, detail) => ev.assertions.push({ name, pass: !!pass, detail });
const rectOf = (sel) => cdp.evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(sel)});if(!e)return null;e.scrollIntoView({block:'center',inline:'nearest'});const r=e.getBoundingClientRect();return r.width&&r.height?{x:r.x+r.width/2,y:r.y+r.height/2,w:r.width,h:r.height,inView:r.top>=0&&r.bottom<=innerHeight}:null;})()`);
async function mouseClick(sel) {
  await cdp.evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(sel)});e&&e.scrollIntoView({block:'center',inline:'nearest'});})()`);
  await cdp.pause(120);
  const p = await rectOf(sel);
  if (!p) throw new Error(`鼠标点击目标不可见: ${sel}`);
  for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) {
    await cdp.send('Input.dispatchMouseEvent', { type, x: p.x, y: p.y, button: type === 'mouseMoved' ? 'none' : 'left', clickCount: 1 });
  }
  await cdp.pause(200);
  return p;
}
const disk = () => { const j = JSON.parse(readFileSync(CHAINS_FILE, 'utf8')); const c = j.chains.find((x) => x.id === CHAIN_ID); return { active: j.active, chainName: c?.name, versions: (c?.versions ?? []).map((v) => ({ index: v.index, id: v.id, cards: v.cards.map((k) => ({ id: k.id, title: k.title, trigger_desc: k.trigger_desc, body: k.body, slot_type: k.slot_type })) })) }; };
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
  // —— 到达制作页 + 制作对话标签（只读导航，不改制作对象）——
  await cdp.evaluate(`document.querySelector('#tab-making')?.click()`); await cdp.pause(400);
  for (let i = 0; i < 25; i++) { if (await cdp.evaluate(`document.querySelectorAll('#making-chain-list .making-chain-row').length > 0`)) break; await cdp.pause(200); }
  await cdp.evaluate(`document.querySelector('#making-chain-list .making-chain-row[data-chain-id=${JSON.stringify(CHAIN_ID)}]')?.click()`);
  await cdp.pause(400);
  await cdp.evaluate(`document.querySelector('#making-view-chat-btn')?.click()`); await cdp.pause(400);

  // —— 阶段 0：保存前基线（真实草稿面板 + 磁盘）——
  const preDom = await cdp.evaluate(`(() => {
    const p = document.querySelector('.making-draft-panel[data-draft-turn-index="3"]');
    if (!p) return null;
    const c = p.querySelector('.making-draft-card');
    return {
      heading: p.querySelector('.making-draft-heading')?.textContent ?? null,
      badge: c?.querySelector('.making-draft-type')?.textContent ?? null,
      lines: [...(c?.querySelectorAll('.making-draft-line') ?? [])].map(l => l.textContent),
      draftBody: c?.querySelector('.making-draft-body')?.textContent ?? null,
      draftBodyLen: (c?.querySelector('.making-draft-body')?.textContent ?? '').length,
      saveBtn: (() => { const b = p.querySelector('.making-draft-actions .making-mini-btn.primary'); return b ? { text: b.textContent.trim(), disabled: b.disabled } : null; })(),
    };
  })()`);
  const preDisk = disk();
  ev.stages.push({ name: 'pre-save', data: { preDom, preDiskVersions: preDisk.versions.map(v => ({ index: v.index, cardCount: v.cards.length })), preActive: preDisk.active } });
  await shot('making-draft-rt-00-pre-save');
  assert('pre.draftPanelTurn3Present', !!preDom, preDom);
  assert('pre.draftBodyIsFull399', preDom?.draftBodyLen === BODY.length, { domLen: preDom?.draftBodyLen, draftLen: BODY.length });
  assert('pre.draftBodyVerbatim', preDom?.draftBody === BODY, { equal: preDom?.draftBody === BODY });
  assert('pre.saveButtonEnabled', preDom?.saveBtn?.text === '保存这版草稿' && preDom?.saveBtn?.disabled === false, preDom?.saveBtn);
  assert('pre.versionCount1', preDisk.versions.length === 1 && preDisk.versions[0].cards.length === 2, preDisk.versions.map(v => ({ index: v.index, cardCount: v.cards.length })));
  assert('pre.activeNull', preDisk.active === null, preDisk.active);

  // —— 阶段 1：真实 UI 点「保存这版草稿」→ 出现确认对话框 ——
  await mouseClick('.making-draft-panel[data-draft-turn-index="3"] .making-draft-actions .making-mini-btn.primary');
  let dialogOk = false;
  for (let i = 0; i < 20; i++) { if (await cdp.evaluate(`!!document.querySelector('.making-save-confirm')`)) { dialogOk = true; break; } await cdp.pause(150); }
  const confirmSummary = await cdp.evaluate(`(() => {
    const d = document.querySelector('.making-save-confirm');
    if (!d) return null;
    const det = d.querySelector('details');
    return { isDialog: d.tagName === 'DIALOG', open: d.hasAttribute('open'), heading: d.querySelector('h3')?.textContent ?? null, summary: d.querySelector('.making-save-summary')?.textContent ?? null, detailsOpenBefore: det?.hasAttribute('open') ?? null, toggleText: det?.querySelector('summary')?.textContent ?? null, preCount: det ? det.querySelectorAll('pre').length : 0, buttons: [...d.querySelectorAll('footer button')].map(b => b.textContent.trim()) };
  })()`);
  ev.stages.push({ name: 'confirm-open', data: confirmSummary });
  await shot('making-draft-rt-01-confirm-summary');
  assert('confirm.dialogModal', dialogOk && confirmSummary?.isDialog === true && confirmSummary?.open === true, confirmSummary);
  assert('confirm.summaryIsTruncated', (confirmSummary?.summary ?? '').includes('摘要') && (confirmSummary?.summary ?? '').includes('已截断') && (confirmSummary?.summary ?? '').length < EXPECT_PRE.length, { summaryLen: confirmSummary?.summary?.length });
  assert('confirm.toggleText', confirmSummary?.toggleText === '展开完整原文核对', confirmSummary?.toggleText);
  assert('confirm.detailsClosedInitially', confirmSummary?.detailsOpenBefore === false, confirmSummary?.detailsOpenBefore);

  // —— 阶段 2：真实点击展开全文 → 逐字核对 trigger/body（说明格式包装差异）——
  await mouseClick('.making-save-confirm details > summary');
  await cdp.pause(200);
  const expanded = await cdp.evaluate(`(() => {
    const d = document.querySelector('.making-save-confirm'); const det = d?.querySelector('details');
    return { detailsOpen: det?.hasAttribute('open') ?? null, pres: det ? [...det.querySelectorAll('pre')].map(p => p.textContent) : [] };
  })()`);
  const preText = expanded.pres[0] ?? '';
  ev.stages.push({ name: 'confirm-expanded', data: { detailsOpen: expanded.detailsOpen, preLen: preText.length, preText } });
  await shot('making-draft-rt-02-confirm-expanded');
  assert('expanded.detailsOpen', expanded.detailsOpen === true, expanded.detailsOpen);
  assert('expanded.singlePre', expanded.pres.length === 1, expanded.pres.length);
  assert('expanded.preFullEqualsExpected', preText === EXPECT_PRE, { equal: preText === EXPECT_PRE, gotLen: preText.length, wantLen: EXPECT_PRE.length });
  assert('expanded.triggerVerbatim', preText.includes(`何时用：${WHEN}`) && preText.includes(`何时不用：${WHEN_NOT}`), { hasWhen: preText.includes(WHEN), hasWhenNot: preText.includes(WHEN_NOT) });
  assert('expanded.bodyVerbatimIncludingEdges', preText.endsWith(BODY) && preText.includes(head) && preText.includes(mid) && preText.includes(tail), { head, mid, tail, endsWithBody: preText.endsWith(BODY) });

  // —— 阶段 3：用户式确认保存 ——
  await mouseClick('.making-save-confirm footer button.making-action-btn:nth-of-type(2)');
  let savedOk = false;
  for (let i = 0; i < 40; i++) {
    const st = await cdp.evaluate(`(() => ({ dialog: !!document.querySelector('.making-save-confirm'), options: document.querySelectorAll('#making-version-select option').length }))()`);
    if (!st.dialog && st.options >= 2) { savedOk = true; break; }
    await cdp.pause(200);
  }
  const afterDom = await cdp.evaluate(`(() => ({
    dialogGone: !document.querySelector('.making-save-confirm'),
    versionOptions: [...document.querySelectorAll('#making-version-select option')].map(o => o.textContent.trim()),
    viewedIndex: document.querySelector('#making-version-select')?.selectedIndex,
    viewedValue: document.querySelector('#making-version-select')?.value,
    using: document.querySelector('.making-version-using')?.textContent ?? null,
    inspectorState: document.querySelector('#making-inspector-state')?.textContent ?? null,
    notice: document.getElementById('making-session-notice')?.textContent ?? null,
    noticeHidden: document.getElementById('making-session-notice')?.classList.contains('hidden') ?? null,
    cardCount: document.getElementById('making-card-count')?.textContent ?? null,
    chainRowText: document.querySelector('#making-chain-list .making-chain-row')?.textContent ?? null,
  }))()`);
  const postDisk = disk();
  const v2 = postDisk.versions[postDisk.versions.length - 1];
  ev.stages.push({ name: 'post-save', data: { afterDom, postDiskVersions: postDisk.versions.map(v => ({ index: v.index, id: v.id, cardCount: v.cards.length })), postActive: postDisk.active } });
  await shot('making-draft-rt-03-post-save');
  assert('save.dialogClosed', savedOk && afterDom.dialogGone === true, { savedOk, dialogGone: afterDom.dialogGone });
  assert('save.noticeTruthful', (afterDom.notice ?? '').includes('已保存为「CDP长卡验收链·第2版」草稿') && (afterDom.notice ?? '').includes('尚未启用'), afterDom.notice);
  assert('save.appendedVersion2', postDisk.versions.length === 2 && v2?.index === 2, postDisk.versions.map(v => ({ index: v.index, cardCount: v.cards.length })));
  assert('save.viewAutoFollowsNewVersion', afterDom.viewedIndex === 1 && (afterDom.versionOptions[1] ?? '').includes('第2版'), { viewedIndex: afterDom.viewedIndex, versionOptions: afterDom.versionOptions });
  assert('save.activeNotAutoChanged', postDisk.active === null, postDisk.active);
  assert('save.usingStillIdle', (afterDom.using ?? '').includes('未启用'), afterDom.using);
  assert('save.historyPreserved', (postDisk.versions[0]?.cards.length ?? 0) === 2, postDisk.versions[0]?.cards.length);

  // —— 阶段 4：存储读回逐字比对（真实 Rust 落盘的 chains.json）——
  assert('storage.cardTitleVerbatim', v2?.cards[0]?.title === TITLE, { got: v2?.cards[0]?.title, want: TITLE });
  assert('storage.triggerVerbatim', v2?.cards[0]?.trigger_desc === EXPECT_TRIGGER, { equal: v2?.cards[0]?.trigger_desc === EXPECT_TRIGGER, gotLen: v2?.cards[0]?.trigger_desc?.length, wantLen: EXPECT_TRIGGER.length });
  assert('storage.bodyVerbatim', v2?.cards[0]?.body === BODY, { equal: v2?.cards[0]?.body === BODY, gotLen: v2?.cards[0]?.body?.length, wantLen: BODY.length });
  assert('storage.slotTypeRequirement', v2?.cards[0]?.slot_type === 'requirement', v2?.cards[0]?.slot_type);

  // —— 阶段 5：全页完整详情 DOM（新版本卡）首/中/尾 + 整体逐字 ——
  await openCardFull(v2.cards[0].id);
  const d2 = await readDetail();
  ev.stages.push({ name: 'detail-new-card', data: d2 });
  await shot('making-draft-rt-04-full-detail');
  assert('detail.fullModeVisible', d2.fullDetailHidden === false && d2.cardPanelHidden === false, { fullDetailHidden: d2.fullDetailHidden, cardPanelHidden: d2.cardPanelHidden });
  assert('detail.headings', JSON.stringify(d2.headings) === JSON.stringify(['身份', '何时用', '怎么做', '本版变化']), d2.headings);
  assert('detail.whenToUseVerbatim', d2.whenToUse === EXPECT_TRIGGER, { equal: d2.whenToUse === EXPECT_TRIGGER, gotLen: d2.whenToUse?.length, wantLen: EXPECT_TRIGGER.length });
  assert('detail.howToVerbatim', d2.howTo === BODY, { equal: d2.howTo === BODY, gotLen: d2.howTo?.length, wantLen: BODY.length });
  assert('detail.bodyHeadMidTailPresent', d2.howTo?.includes(head) && d2.howTo?.includes(mid) && d2.howTo?.includes(tail), { head, mid, tail });
  assert('detail.overallContainsFullBody', (d2.overall ?? '').includes(BODY) && (d2.overall ?? '').includes(EXPECT_TRIGGER), { overallLen: d2.overall?.length });
  assert('detail.notLengthOrStartswithOnly', d2.howTo?.length === BODY.length && d2.howTo === BODY && d2.howTo !== BODY.slice(0, 60), { lengthMatch: d2.howTo?.length === BODY.length, fullEqual: d2.howTo === BODY });

  // —— 阶段 6：真实长内容（v1 长卡，只读）首/中/尾对照 ——
  const v1 = postDisk.versions[0];
  const longCard = v1.cards.find((k) => k.title === '长卡首中尾验收卡') ?? v1.cards[0];
  await cdp.evaluate(`(() => { const s = document.querySelector('#making-version-select'); s.value = ${JSON.stringify(v1.id)}; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  await cdp.pause(400);
  await openCardFull(longCard.id);
  const dLong = await readDetail();
  const lb = longCard.body;
  ev.stages.push({ name: 'detail-long-card', data: { title: longCard.title, bodyLen: lb.length, headings: dLong.headings, howToLen: dLong.howTo?.length, whenToUseLen: dLong.whenToUse?.length, longMarkers: { begin: dLong.howTo?.includes('【正文开头】'), middle: dLong.howTo?.includes('【正文中段】'), end: dLong.howTo?.includes('【正文结尾】') } } });
  await shot('making-draft-rt-05-long-card-detail');
  assert('long.bodyVerbatim', dLong.howTo === lb, { equal: dLong.howTo === lb, gotLen: dLong.howTo?.length, wantLen: lb.length });
  assert('long.triggerVerbatim', dLong.whenToUse === longCard.trigger_desc, { equal: dLong.whenToUse === longCard.trigger_desc });
  assert('long.headMiddleTailMarkers', dLong.howTo?.includes('【正文开头】') && dLong.howTo?.includes('【正文中段】') && dLong.howTo?.includes('【正文结尾】'), { begin: dLong.howTo?.includes('【正文开头】'), middle: dLong.howTo?.includes('【正文中段】'), end: dLong.howTo?.includes('【正文结尾】') });
} catch (error) {
  ev.stages.push({ name: 'fatal', error: String(error?.message ?? error) });
} finally {
  ev.consoleErrors = cdp.consoleErrors;
  ev.finished = new Date().toISOString();
  writeFileSync(join(outDir, 'making-draft-roundtrip.json'), JSON.stringify(ev, null, 2));
  const failed = ev.assertions.filter((a) => !a.pass);
  process.exitCode = failed.length > 0 || ev.stages.some((s) => s.name === 'fatal') ? 1 : 0;
  console.log(JSON.stringify({ total: ev.assertions.length, failed, fatal: ev.stages.find((s) => s.name === 'fatal') ?? null, notice: ev.stages.find((s) => s.name === 'post-save')?.data?.afterDom?.notice ?? null }, null, 2));
  cdp.close();
}
