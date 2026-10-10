// ai-panel-geometry.mjs — 真实 WebView 几何验收（AI 面板头动作组 / 讨论列表顶边 / 删除确认与撤销）。
// 断言基于真实 Tauri dev WebView（CDP），非 DOM 注入行为模拟；只在读取/点击真实 UI 元素后测量其矩形。
// 证据写入 verification/ui-acceptance/evidence-ai/。
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { connect } from './cdp-client.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, 'evidence-ai');
mkdirSync(outDir, { recursive: true });

const cdp = await connect(Number(process.argv[2] ?? 9225));
const evidence = {
  started: new Date().toISOString(),
  target: cdp.target,
  viewport: await cdp.evaluate(`[innerWidth, innerHeight]`),
  dpr: await cdp.evaluate(`devicePixelRatio`),
  stages: [],
  screenshots: [],
  assertions: [],
  consoleErrors: [],
};

const HELPERS = `
  const R = e => { if (!e) return null; const r = e.getBoundingClientRect(); const s = getComputedStyle(e);
    return { role: e.getAttribute('data-role') || null, id: e.id || null, cls: (typeof e.className==='string'?e.className:''),
      x: +r.x.toFixed(2), y: +r.y.toFixed(2), w: +r.width.toFixed(2), h: +r.height.toFixed(2), right: +r.right.toFixed(2), bottom: +r.bottom.toFixed(2),
      display: s.display, visibility: s.visibility, whiteSpace: s.whiteSpace, flexWrap: s.flexWrap, position: s.position }; };
  const VIS = e => !!e && e.getBoundingClientRect().width > 0 && e.getBoundingClientRect().height > 0 && getComputedStyle(e).visibility !== 'hidden' && getComputedStyle(e).display !== 'none';
  const OV = (a,b) => a && b ? Math.max(0, Math.min(a.right,b.right)-Math.max(a.x,b.x)) * Math.max(0, Math.min(a.bottom,b.bottom)-Math.max(a.y,b.y)) : 0;
`;

async function measureHead() {
  return cdp.evaluate(`(() => { ${HELPERS}
    const head = document.querySelector('.ai-window-head');
    const actions = head?.querySelector('.ai-window-actions');
    const title = head?.querySelector('[data-role="title"]');
    const doc = head?.querySelector('[data-role="doc"]');
    const children = actions ? [...actions.children].filter(VIS).map(R) : [];
    const centerYs = children.map(c => c.y + c.h/2);
    const maxCenterDelta = centerYs.length ? Math.max(...centerYs) - Math.min(...centerYs) : 0;
    const overlapPairs = [];
    for (let i=0;i<children.length;i++) for (let j=i+1;j<children.length;j++) if (OV(children[i],children[j])>0.5) overlapPairs.push([children[i].role,children[j].role]);
    const hr = R(head), ar = R(actions), tr = R(title);
    return {
      head: hr, actions: ar, title: tr, doc: R(doc),
      actionChildren: children,
      actionChildRoles: children.map(c=>c.role),
      maxCenterDelta,
      overlapPairs,
      actionsInsideHead: !!hr && !!ar && ar.x >= hr.x-0.5 && ar.right <= hr.right+0.5 && ar.y >= hr.y-0.5 && ar.bottom <= hr.bottom+0.5,
      titleActionsNoOverlap: !tr || !ar || OV(tr, ar) <= 0.5,
      titleTruncated: !!title && title.scrollWidth > title.clientWidth + 1,
      titleClientWidth: title?.clientWidth ?? null, titleScrollWidth: title?.scrollWidth ?? null,
      actionsWrap: actions ? getComputedStyle(actions).flexWrap : null,
      actionsWhiteSpace: actions ? getComputedStyle(actions).whiteSpace : null,
      headText: (head?.innerText||'').replace(/\\s+/g,' ').slice(0,140),
    };
  })()`);
}

async function shot(name) {
  const file = join(outDir, `${name}.png`);
  await cdp.screenshot(file);
  evidence.screenshots.push(file);
  return file;
}

function assert(name, pass, detail) {
  evidence.assertions.push({ name, pass: !!pass, detail });
  return pass;
}

try {
  // 准备：写作页、面板展开、聚焦一个带长标题的讨论。
  await cdp.evaluate(`document.querySelector('#tab-writing')?.click()`);
  await cdp.pause(200);
  const panelOpen = await cdp.evaluate(`(() => { const d=document.querySelector('#ai-dock'); return !!d && !d.classList.contains('hidden'); })()`);
  if (!panelOpen) { await cdp.click('#btn-toggle-ai'); await cdp.pause(300); }
  // 确保讨论列表关闭（列表覆盖停靠区，会遮挡窗口头测量）。
  if (!(await cdp.evaluate(`document.querySelector('.ai-conversation-list')?.classList.contains('hidden')`))) {
    await cdp.click('#ai-conversation-list-toggle'); await cdp.pause(200);
  }
  let hasHead = await cdp.evaluate(`!!document.querySelector('.ai-window-head')`);
  if (!hasHead) {
    await cdp.click('#ai-conversation-list-toggle'); await cdp.pause(150);
    await cdp.click('#ai-list-new-conversation');
    for (let i=0;i<15;i++){ if (await cdp.evaluate(`!!document.querySelector('.ai-window-head')`)) break; await cdp.pause(200); }
  }
  let titleLen = await cdp.evaluate(`(document.querySelector('.ai-window-title')?.textContent||'').length`);
  if (titleLen < 20) {
    // 用长问题撑出长标题（隔离实例无模型配置 → configuration_required，不触达模型）。
    await cdp.evaluate(`(() => { const ta=document.querySelector('[data-role="direct-question-input"]'); ta.value='CDP几何验收长标题：一二三四五六七八九十甲乙丙丁戊己庚辛壬癸子丑寅卯辰巳午未申酉戌亥'; ta.dispatchEvent(new Event('input',{bubbles:true})); })()`);
    await cdp.pause(400);
    if (!(await cdp.evaluate(`document.querySelector('[data-role="direct-question-send"]')?.disabled`))) {
      await cdp.click('[data-role="direct-question-send"]');
      await cdp.pause(800);
    }
  }
  evidence.discussionContext = await cdp.evaluate(`(() => ({
    title: document.querySelector('.ai-window-title')?.textContent ?? null,
    visibleRoles: [...document.querySelectorAll('.ai-window-head [data-role]')].filter(e=>e.getBoundingClientRect().width>0).map(e=>e.getAttribute('data-role')),
    hasStop: !!document.querySelector('.ai-window-head [data-role="stop"]') && document.querySelector('.ai-window-head [data-role="stop"]').getBoundingClientRect().width>0,
    hasMaterials: !!document.querySelector('.ai-window-head [data-role="materials-toggle"]') && document.querySelector('.ai-window-head [data-role="materials-toggle"]').getBoundingClientRect().width>0,
  }))()`);

  // ===== 模式 1：默认宽度 =====
  const defaultMode = await measureHead();
  await shot('head-default');
  evidence.stages.push({ name: 'head-default', data: defaultMode });

  // ===== 模式 2：最窄（divider 键盘 → 到最小 300；ArrowRight 收窄） =====
  await cdp.evaluate(`document.querySelector('#ai-dock-divider')?.focus()`);
  for (let i=0;i<25;i++) {
    const now = await cdp.evaluate(`Number(document.querySelector('#ai-dock-divider')?.getAttribute('aria-valuenow')||9999)`);
    if (now <= 300) break;
    await cdp.key('ArrowRight', 'ArrowRight', 39);
  }
  await cdp.pause(200);
  const narrowMode = await measureHead();
  await shot('head-narrow');
  evidence.stages.push({ name: 'head-narrow', panelWidth: await cdp.evaluate(`Math.round(document.querySelector('#ai-dock').getBoundingClientRect().width)`), data: narrowMode });

  // ===== 模式 3：最大化 =====
  await cdp.click('#ai-dock-maximize');
  await cdp.pause(300);
  const maxMode = await measureHead();
  await shot('head-maximized');
  evidence.stages.push({ name: 'head-maximized', data: maxMode });
  // 恢复边栏（保持后续列表/删除测试在同一布局）。
  await cdp.click('#ai-dock-maximize');
  await cdp.pause(250);

  // ===== 断言：头动作组三种模式 =====
  for (const [name, mode] of [['default', defaultMode], ['narrow', narrowMode], ['maximized', maxMode]]) {
    assert(`head.${name}.actionsInsideHead`, mode.actionsInsideHead, { head: mode.head, actions: mode.actions });
    assert(`head.${name}.actionChildrenNoOverlap`, mode.overlapPairs.length === 0, mode.overlapPairs);
    assert(`head.${name}.singleRow`, mode.maxCenterDelta <= 3, { maxCenterDelta: mode.maxCenterDelta, roles: mode.actionChildRoles, children: mode.actionChildren });
    assert(`head.${name}.titleActionsNoOverlap`, mode.titleActionsNoOverlap, { title: mode.title, actions: mode.actions });
    assert(`head.${name}.actionsNotWrap`, mode.actionsWrap === 'nowrap' && mode.actionsWhiteSpace === 'nowrap', { flexWrap: mode.actionsWrap, whiteSpace: mode.actionsWhiteSpace });
  }
  assert('head.longTitle.present', (evidence.discussionContext.title||'').length >= 20, { title: evidence.discussionContext.title });
  assert('head.narrow.titleTruncated', narrowMode.titleTruncated === true, { client: narrowMode.titleClientWidth, scroll: narrowMode.titleScrollWidth });

  // ===== 讨论列表顶边不压面板头（3.1） =====
  const listClosedBefore = await cdp.evaluate(`document.querySelector('.ai-conversation-list')?.classList.contains('hidden')`);
  if (listClosedBefore) { await cdp.click('#ai-conversation-list-toggle'); await cdp.pause(250); }
  const listGeom = await cdp.evaluate(`(() => { ${HELPERS}
    const dock = document.querySelector('#ai-dock');
    const header = dock.querySelector('.ai-dock-header');
    const list = dock.querySelector('.ai-conversation-list');
    const hr = R(header), lr = R(list), dr = R(dock);
    return { header: hr, list: lr, dock: dr, listVisible: VIS(list),
      topEqualsHeaderHeight: !!hr && !!lr && Math.abs((lr.y - dr.y) - hr.h) <= 1.5,
      listBelowHeader: !!hr && !!lr && lr.y >= hr.bottom - 0.5,
      gap: (lr.y - hr.bottom) };
  })()`);
  await shot('list-open');
  evidence.stages.push({ name: 'list-open', data: listGeom });
  assert('list.visible', listGeom.listVisible === true, {});
  assert('list.topEqualsHeaderHeight', listGeom.topEqualsHeaderHeight === true, { headerH: listGeom.header?.h, listTopRelDock: listGeom.list ? listGeom.list.y - listGeom.dock.y : null });
  assert('list.notPressingHeader', listGeom.listBelowHeader === true && listGeom.gap >= -0.5, { gap: listGeom.gap, headerBottom: listGeom.header?.bottom, listTop: listGeom.list?.y });

  // 确保至少一行。
  let rows = await cdp.evaluate(`document.querySelectorAll('.ai-cl-row').length`);
  if (rows < 1) {
    await cdp.click('#ai-list-new-conversation'); await cdp.pause(400);
    await cdp.click('#ai-conversation-list-toggle'); await cdp.pause(200);
    rows = await cdp.evaluate(`document.querySelectorAll('.ai-cl-row').length`);
  }
  evidence.listRows = rows;

  // ===== 删除确认：hover 与键盘下 action 让位、确认可见（3.2） =====
  await cdp.hover('.ai-cl-row');
  const hoverState = await cdp.evaluate(`(() => { ${HELPERS}
    const row = document.querySelector('.ai-cl-row');
    const actions = row.querySelector('.ai-cl-actions');
    const confirm = row.querySelector('.ai-cl-confirm');
    return { actionsPresent: !!actions, actionsVisible: VIS(actions), confirmVisible: VIS(confirm), actionsRect: R(actions), confirmRect: R(confirm), confirming: row.classList.contains('confirming') };
  })()`);
  evidence.stages.push({ name: 'row-hover', data: hoverState });
  assert('delete.hoverShowsActions', hoverState.actionsPresent && hoverState.actionsVisible && !hoverState.confirming, { actionsVisible: hoverState.actionsVisible, confirmVisible: hoverState.confirmVisible });

  // 鼠标点删除图标 → 进入确认。
  await cdp.click('.ai-cl-row .ai-cl-act.del');
  await cdp.pause(250);
  const confirmMouse = await cdp.evaluate(`(() => { ${HELPERS}
    const row = document.querySelector('.ai-cl-row');
    const actions = row.querySelector('.ai-cl-actions');
    const confirm = row.querySelector('.ai-cl-confirm');
    const actionsVisible = VIS(actions);
    return { confirming: row.classList.contains('confirming'), confirmVisible: VIS(confirm), confirmRect: R(confirm),
      actionsPresent: !!actions, actionsVisible, actionsDisplay: actions ? getComputedStyle(actions).display : null,
      overlapConfirmActions: actionsVisible ? OV(R(confirm), R(actions)) : 0 };
  })()`);
  await shot('delete-confirm-mouse');
  evidence.stages.push({ name: 'delete-confirm-mouse', data: confirmMouse });
  assert('delete.confirmShown', confirmMouse.confirming && confirmMouse.confirmVisible, {});
  assert('delete.confirmActionsYielded', !confirmMouse.actionsVisible && confirmMouse.overlapConfirmActions === 0, { actionsVisible: confirmMouse.actionsVisible, display: confirmMouse.actionsDisplay, overlap: confirmMouse.overlapConfirmActions });

  // 取消 → 确认消失、操作组回到 DOM。
  const cancelBtn = await cdp.evaluate(`(() => { const b=[...document.querySelectorAll('.ai-cl-confirm .ai-cl-btn')].find(x=>x.textContent.trim()==='取消'); if(!b)return null; const r=b.getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2}; })()`);
  if (cancelBtn) { for (const type of ['mouseMoved','mousePressed','mouseReleased']) await cdp.send('Input.dispatchMouseEvent',{type,...cancelBtn,button:type==='mouseMoved'?'none':'left',clickCount:1}); await cdp.pause(200); }
  const afterCancel = await cdp.evaluate(`(() => { ${HELPERS} const row=document.querySelector('.ai-cl-row'); const actions=row.querySelector('.ai-cl-actions'); return { confirming: row.classList.contains('confirming'), actionsPresent: !!actions, confirmPresent: !!row.querySelector('.ai-cl-confirm') }; })()`);
  evidence.stages.push({ name: 'delete-cancel', data: afterCancel });
  assert('delete.cancelRestoresActions', !afterCancel.confirming && afterCancel.actionsPresent && !afterCancel.confirmPresent, afterCancel);

  // 键盘路径：焦点进入确认区后，动作组仍隐藏、确认可见（confirm 的删除按钮获焦）。
  // 重新以鼠标进入确认（行尾操作组用 display:none，未悬停时不可获焦，键盘先经确认区按钮）。
  await cdp.hover('.ai-cl-row');
  await cdp.click('.ai-cl-row .ai-cl-act.del');
  await cdp.pause(250);
  const confirmKb = await cdp.evaluate(`(() => { ${HELPERS}
    const row = document.querySelector('.ai-cl-row');
    const actions = row.querySelector('.ai-cl-actions');
    const confirm = row.querySelector('.ai-cl-confirm');
    const del = confirm ? [...confirm.querySelectorAll('.ai-cl-btn')].find(b=>b.textContent.trim()==='删除') : null;
    del?.focus();
    return { confirming: row.classList.contains('confirming'), confirmVisible: VIS(confirm), actionsVisible: VIS(actions),
      delFocused: document.activeElement === del, activeLabel: (document.activeElement?.textContent||'').trim() };
  })()`);
  await shot('delete-confirm-keyboard-focus');
  evidence.stages.push({ name: 'delete-confirm-keyboard', data: confirmKb });
  assert('delete.keyboardConfirmShown', confirmKb.confirming && confirmKb.confirmVisible && !confirmKb.actionsVisible && confirmKb.delFocused, confirmKb);

  // ===== 键盘激活确认删除 → 撤销提示可见可点（3.3） =====
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13, text: '\r', unmodifiedText: '\r' });
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
  await cdp.pause(600);
  const afterKeyDelete = await cdp.evaluate(`(() => ({ rows: document.querySelectorAll('.ai-cl-row').length, confirming: !!document.querySelector('.ai-cl-row.confirming') }))()`);
  evidence.stages.push({ name: 'delete-keyboard-executed', data: afterKeyDelete });
  assert('delete.keyboardActivatesDelete', afterKeyDelete.rows < rows || afterKeyDelete.rows === 0, afterKeyDelete);

  const notice = await cdp.evaluate(`(() => { ${HELPERS}
    const n = document.querySelector('#ai-dock-notice');
    const undo = n?.querySelector('.ai-dock-notice-undo');
    const list = document.querySelector('.ai-conversation-list');
    const ur = undo ? undo.getBoundingClientRect() : null;
    const hit = ur ? document.elementFromPoint(ur.x+ur.width/2, ur.y+ur.height/2) : null;
    return { noticeVisible: VIS(n), noticeRect: R(n), undoPresent: !!undo, undoRect: R(undo), undoDisabled: undo?.disabled ?? null,
      hitIsUndo: !!undo && hit === undo, hitRole: hit?.className ?? null, listVisible: VIS(list),
      noticeZ: n ? getComputedStyle(n).zIndex : null, listZ: list ? getComputedStyle(list).zIndex : null };
  })()`);
  await shot('delete-undo-notice');
  evidence.stages.push({ name: 'delete-undo-notice', data: notice });
  assert('undo.noticeVisible', notice.noticeVisible === true, { rect: notice.noticeRect });
  assert('undo.buttonVisibleClickable', notice.undoPresent && notice.undoDisabled !== true && notice.hitIsUndo === true, { undoRect: notice.undoRect, hitIsUndo: notice.hitIsUndo, hitRole: notice.hitRole, noticeZ: notice.noticeZ, listZ: notice.listZ });

  // 键盘激活撤销（撤销按钮获焦后 Enter）→ 提示消失、行恢复。
  if (notice.undoPresent) {
    await cdp.evaluate(`document.querySelector('#ai-dock-notice .ai-dock-notice-undo')?.focus()`);
    await cdp.pause(120);
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13, text: '\r', unmodifiedText: '\r' });
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
    await cdp.pause(500);
  }
  const afterUndo = await cdp.evaluate(`(() => { const n=document.querySelector('#ai-dock-notice'); return { noticeHidden: n?.classList.contains('hidden') ?? null, rows: document.querySelectorAll('.ai-cl-row').length }; })()`);
  evidence.stages.push({ name: 'delete-undo-applied', data: afterUndo });
  assert('undo.restoresList', afterUndo.noticeHidden === true && afterUndo.rows >= 1, afterUndo);

} catch (error) {
  evidence.stages.push({ name: 'fatal', error: String(error?.message ?? error) });
} finally {
  evidence.consoleErrors = cdp.consoleErrors;
  evidence.finished = new Date().toISOString();
  writeFileSync(join(outDir, 'evidence-ai.json'), JSON.stringify(evidence, null, 2));
  const failed = evidence.assertions.filter(a => !a.pass);
  process.exitCode = failed.length > 0 || evidence.stages.some(s => s.name === 'fatal') ? 1 : 0;
  console.log(JSON.stringify({ assertions: evidence.assertions, failed, stages: evidence.stages.map(s => s.name), fatal: evidence.stages.find(s => s.name === 'fatal') ?? null }, null, 2));
  cdp.close();
}
