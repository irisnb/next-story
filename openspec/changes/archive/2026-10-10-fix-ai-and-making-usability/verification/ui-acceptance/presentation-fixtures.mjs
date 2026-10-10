// presentation-fixtures.mjs — 呈现层几何 fixture（真实 WebView + 真实 CSS；仅对隐藏态做 DOM 显隐，
// 明确标注为 fixture，非真实生成/授权端到端）：
//  A. 3.4：materials-toggle 与 stop 显示时的窗口头动作组几何（窄/默认/最大化，长标题）。
//  B. 4.2：补读授权卡在长 body 贴底/上翻时固定可见可操作；且授权卡不在正文滚动区内。
// 说明：materials/stop 的真实显示态需真实生成/材料（本批无模型），故只做显隐 fixture；
//       授权请求的真实端到端不在本批，只验证呈现层布局与滚动可见性。
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { connect } from './cdp-client.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, 'evidence-presentation');
mkdirSync(outDir, { recursive: true });

const cdp = await connect(Number(process.argv[2] ?? 9225));
const ev = { started: new Date().toISOString(), target: cdp.target, stages: [], screenshots: [], assertions: [], consoleErrors: [], fixtureLabel: '呈现层 DOM 显隐 fixture：CSS/布局真实；不代表真实生成/授权端到端' };
const shot = async (name) => { const f = join(outDir, `${name}.png`); await cdp.screenshot(f); ev.screenshots.push(f); return f; };
const assert = (name, pass, detail) => ev.assertions.push({ name, pass: !!pass, detail });

const HELPERS = `
  const R = e => { if (!e) return null; const r = e.getBoundingClientRect(); const s = getComputedStyle(e);
    return { role: e.getAttribute('data-role') || null, cls: (typeof e.className==='string'?e.className:''),
      x:+r.x.toFixed(2), y:+r.y.toFixed(2), w:+r.width.toFixed(2), h:+r.height.toFixed(2), right:+r.right.toFixed(2), bottom:+r.bottom.toFixed(2),
      display:s.display, visibility:s.visibility, whiteSpace:s.whiteSpace, flexWrap:s.flexWrap }; };
  const VIS = e => !!e && e.getBoundingClientRect().width>0 && e.getBoundingClientRect().height>0 && getComputedStyle(e).visibility!=='hidden' && getComputedStyle(e).display!=='none';
  const OV = (a,b) => a&&b ? Math.max(0, Math.min(a.right,b.right)-Math.max(a.x,b.x)) * Math.max(0, Math.min(a.bottom,b.bottom)-Math.max(a.y,b.y)) : 0;
`;
const measureHead = () => cdp.evaluate(`(() => { ${HELPERS}
  const head=document.querySelector('.ai-window-head'); const actions=head?.querySelector('.ai-window-actions'); const title=head?.querySelector('[data-role="title"]');
  const children=actions?[...actions.children].filter(VIS).map(R):[];
  const cy=children.map(c=>c.y+c.h/2); const maxCenterDelta=cy.length?Math.max(...cy)-Math.min(...cy):0;
  const overlap=[]; for(let i=0;i<children.length;i++)for(let j=i+1;j<children.length;j++)if(OV(children[i],children[j])>0.5)overlap.push([children[i].role,children[j].role]);
  const hr=R(head), ar=R(actions), tr=R(title);
  return { head:hr, actions:ar, title:tr, children, roles:children.map(c=>c.role), maxCenterDelta, overlap,
    actionsInsideHead: !!hr&&!!ar&&ar.x>=hr.x-0.5&&ar.right<=hr.right+0.5&&ar.y>=hr.y-0.5&&ar.bottom<=hr.bottom+0.5,
    titleActionsNoOverlap: !tr||!ar||OV(tr,ar)<=0.5,
    actionsWrap: actions?getComputedStyle(actions).flexWrap:null, actionsWhiteSpace: actions?getComputedStyle(actions).whiteSpace:null };
})()`);

try {
  // 准备：写作页 + 面板 + 一个带长标题的讨论窗口。
  await cdp.evaluate(`document.querySelector('#tab-writing')?.click()`); await cdp.pause(200);
  if (!(await cdp.evaluate(`(() => { const d=document.querySelector('#ai-dock'); return !!d && !d.classList.contains('hidden'); })()`))) { await cdp.click('#btn-toggle-ai'); await cdp.pause(300); }
  if (!(await cdp.evaluate(`document.querySelector('.ai-conversation-list')?.classList.contains('hidden')`))) { await cdp.click('#ai-conversation-list-toggle'); await cdp.pause(200); }
  let hasHead = await cdp.evaluate(`!!document.querySelector('.ai-window-head')`);
  if (!hasHead) {
    await cdp.click('#ai-conversation-list-toggle'); await cdp.pause(150);
    await cdp.click('#ai-list-new-conversation');
    for (let i=0;i<15;i++){ if (await cdp.evaluate(`!!document.querySelector('.ai-window-head')`)) break; await cdp.pause(200); }
  }
  // 确保长标题。
  if ((await cdp.evaluate(`(document.querySelector('.ai-window-title')?.textContent||'').length`)) < 20) {
    await cdp.evaluate(`(() => { const ta=document.querySelector('[data-role="direct-question-input"]'); if(!ta) return; ta.value='CDP几何长标题：一二三四五六七八九十甲乙丙丁戊己庚辛壬癸子丑寅卯辰巳午未申酉戌亥'; ta.dispatchEvent(new Event('input',{bubbles:true})); })()`);
    await cdp.pause(400);
    if (!(await cdp.evaluate(`document.querySelector('[data-role="direct-question-send"]')?.disabled`))) { await cdp.click('[data-role="direct-question-send"]'); await cdp.pause(700); }
  }

  // ===== A. 3.4 动作组几何（materials/stop 显示 fixture） =====
  ev.beforeReveal = await cdp.evaluate(`(() => ({ materialsHidden: !!document.querySelector('[data-role="materials-toggle"]')?.classList.contains('hidden'), stopHidden: !!document.querySelector('[data-role="stop"]')?.classList.contains('hidden') }))()`);
  await cdp.evaluate(`(() => {
    document.querySelector('[data-role="materials-toggle"]')?.classList.remove('hidden');
    document.querySelector('[data-role="stop"]')?.classList.remove('hidden');
  })()`);
  await cdp.pause(200);
  ev.revealedRoles = await cdp.evaluate(`[...document.querySelectorAll('.ai-window-actions > *')].filter(e=>e.getBoundingClientRect().width>0).map(e=>e.getAttribute('data-role'))`);
  assert('fixture.materialsAndStopRevealed', ev.revealedRoles.includes('materials-toggle') && ev.revealedRoles.includes('stop'), ev.revealedRoles);

  const modes = {};
  modes.default = await measureHead();
  await shot('action-group-default');
  // 最窄：divider ArrowRight 到 300。
  await cdp.evaluate(`document.querySelector('#ai-dock-divider')?.focus()`);
  for (let i=0;i<25;i++){ const now = await cdp.evaluate(`Number(document.querySelector('#ai-dock-divider')?.getAttribute('aria-valuenow')||9999)`); if (now<=300) break; await cdp.key('ArrowRight','ArrowRight',39); }
  await cdp.pause(200);
  modes.narrow = await measureHead();
  modes.narrowPanelWidth = await cdp.evaluate(`Math.round(document.querySelector('#ai-dock').getBoundingClientRect().width)`);
  await shot('action-group-narrow');
  // 最大化。
  await cdp.click('#ai-dock-maximize'); await cdp.pause(300);
  modes.maximized = await measureHead();
  await shot('action-group-maximized');
  await cdp.click('#ai-dock-maximize'); await cdp.pause(250);
  ev.stages.push({ name: 'action-group', data: modes });
  for (const [name, m] of Object.entries(modes)) {
    if (typeof m !== 'object' || m.narrowPanelWidth !== undefined) continue;
    assert(`actionGroup.${name}.materialsStopPresent`, m.roles.includes('materials-toggle') && m.roles.includes('stop'), m.roles);
    assert(`actionGroup.${name}.noOverlap`, m.overlap.length === 0, m.overlap);
    assert(`actionGroup.${name}.singleRow`, m.maxCenterDelta <= 3, { maxCenterDelta: m.maxCenterDelta, roles: m.roles });
    assert(`actionGroup.${name}.insideHead`, m.actionsInsideHead === true, { head: m.head, actions: m.actions });
    assert(`actionGroup.${name}.titleActionsNoOverlap`, m.titleActionsNoOverlap === true, { title: m.title, actions: m.actions });
    assert(`actionGroup.${name}.nowrap`, m.actionsWrap === 'nowrap' && m.actionsWhiteSpace === 'nowrap', { flexWrap: m.actionsWrap, whiteSpace: m.actionsWhiteSpace });
  }

  // ===== B. 4.2 授权卡呈现（长 body 贴底/上翻固定可见） =====
  const struct = await cdp.evaluate(`(() => {
    const card=document.querySelector('[data-role="reading-request"]');
    const body=document.querySelector('[data-role="body"]');
    return { cardExists: !!card, bodyExists: !!body, cardInsideBody: !!(card && body && body.contains(card)), cardParentIsWindow: !!card && card.parentElement?.classList.contains('ai-window') };
  })()`);
  ev.stages.push({ name: 'authorization-structure', data: struct });
  assert('auth.cardOutsideScrollBody', struct.cardExists && struct.bodyExists && struct.cardInsideBody === false, struct);

  // 显隐 fixture：露出授权卡，并向正文注入长填充以制造滚动（fixture 标注）。
  await cdp.evaluate(`(() => {
    const card=document.querySelector('[data-role="reading-request"]'); card?.classList.remove('hidden');
    const body=document.querySelector('[data-role="body"]');
    let filler=document.getElementById('__cdp_filler');
    if(!filler){ filler=document.createElement('div'); filler.id='__cdp_filler';
      for(let i=0;i<40;i++){ const p=document.createElement('p'); p.textContent='CDP 呈现 fixture 长正文段落 '+i+'：用于制造正文滚动，验证授权卡在滚动区之外固定可见。'; filler.append(p); }
      body.append(filler);
    }
  })()`);
  await cdp.pause(250);
  const readAuth = () => cdp.evaluate(`(() => { ${HELPERS}
    const body=document.querySelector('[data-role="body"]'); const card=document.querySelector('[data-role="reading-request"]');
    const allow=document.querySelector('[data-role="reading-allow"]'); const deny=document.querySelector('[data-role="reading-deny"]');
    const cr=R(card); const ar=allow?allow.getBoundingClientRect():null;
    const hit=ar?document.elementFromPoint(ar.x+ar.width/2, ar.y+ar.height/2):null;
    return { bodyScrollTop: Math.round(body.scrollTop), bodyScrollHeight: body.scrollHeight, bodyClientHeight: body.clientHeight,
      scrollable: body.scrollHeight > body.clientHeight + 1, cardRect: cr, cardVisible: VIS(card), allowVisible: VIS(allow), denyVisible: VIS(deny),
      allowHit: !!allow && hit===allow };
  })()`);
  await cdp.evaluate(`document.querySelector('[data-role="body"]').scrollTop = 0`); await cdp.pause(200);
  const topState = await readAuth();
  await shot('auth-card-body-top');
  await cdp.evaluate(`(() => { const b=document.querySelector('[data-role="body"]'); b.scrollTop = b.scrollHeight; })()`); await cdp.pause(200);
  const bottomState = await readAuth();
  await shot('auth-card-body-bottom');
  ev.stages.push({ name: 'authorization-scroll', data: { top: topState, bottom: bottomState } });
  assert('auth.bodyScrollableFixture', topState.scrollable === true && bottomState.bodyScrollTop > 0, { top: topState.bodyScrollTop, bottom: bottomState.bodyScrollTop, sh: topState.bodyScrollHeight, ch: topState.bodyClientHeight });
  assert('auth.cardVisibleTopAndBottom', topState.cardVisible && bottomState.cardVisible && topState.allowVisible && bottomState.allowVisible && topState.denyVisible && bottomState.denyVisible, { top: topState.cardRect, bottom: bottomState.cardRect });
  assert('auth.cardFixedAcrossScroll', topState.cardRect && bottomState.cardRect && Math.abs(topState.cardRect.y - bottomState.cardRect.y) <= 1, { topY: topState.cardRect?.y, bottomY: bottomState.cardRect?.y });
  assert('auth.allowClickableTopAndBottom', topState.allowHit && bottomState.allowHit, { top: topState.allowHit, bottom: bottomState.allowHit });
} catch (error) {
  ev.stages.push({ name: 'fatal', error: String(error?.message ?? error) });
} finally {
  ev.consoleErrors = cdp.consoleErrors;
  ev.finished = new Date().toISOString();
  writeFileSync(join(outDir, 'evidence-presentation.json'), JSON.stringify(ev, null, 2));
  const failed = ev.assertions.filter(a => !a.pass);
  process.exitCode = failed.length > 0 || ev.stages.some(s => s.name === 'fatal') ? 1 : 0;
  console.log(JSON.stringify({ assertions: ev.assertions, failed, fatal: ev.stages.find(s => s.name === 'fatal') ?? null }, null, 2));
  cdp.close();
}
