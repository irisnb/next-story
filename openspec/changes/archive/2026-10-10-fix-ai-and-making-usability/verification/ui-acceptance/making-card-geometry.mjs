// making-card-geometry.mjs — 制作页真实 WebView 几何/全文验收：
//  (a) 版本操作区集中：启用/停用/版本选择与「正在使用」同处 `.making-version-operations`；
//  (b) 长卡全页详情逐字呈现「何时用」（触发描述全文）与「怎么做」（正文全文）首/中/尾。
// 依赖 seed-chains.mjs 先写入隔离 fixture。证据写入 verification/ui-acceptance/evidence-making/。
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { connect } from './cdp-client.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, 'evidence-making');
mkdirSync(outDir, { recursive: true });

const CHAIN_ID = 'chain-cdp-long-acceptance';
const BODY_MARKERS = ['【正文开头】', '【正文中段】', '【正文结尾】'];
const TRIGGER_MARKERS = ['【触发开头】', '【触发结尾】'];

const cdp = await connect(Number(process.argv[2] ?? 9225));
const evidence = { started: new Date().toISOString(), target: cdp.target, stages: [], screenshots: [], assertions: [], consoleErrors: [] };
const shot = async (name) => { const f = join(outDir, `${name}.png`); await cdp.screenshot(f); evidence.screenshots.push(f); return f; };
const assert = (name, pass, detail) => evidence.assertions.push({ name, pass: !!pass, detail });

try {
  await cdp.evaluate(`document.querySelector('#tab-writing')?.click()`);
  await cdp.pause(250);
  await cdp.evaluate(`document.querySelector('#tab-making')?.click()`);
  // 等待链路库刷新出 fixture 链路。
  let rows = 0;
  for (let i = 0; i < 25; i++) {
    rows = await cdp.evaluate(`document.querySelectorAll('#making-chain-list .making-chain-row').length`);
    if (rows > 0) break;
    await cdp.pause(200);
  }
  evidence.chainRows = rows;
  await shot('making-chain-library');

  // 选择 fixture 链路。
  const clicked = await cdp.evaluate(`(() => { const b=document.querySelector('#making-chain-list .making-chain-row[data-chain-id=${JSON.stringify(CHAIN_ID)}]'); if(!b)return false; b.click(); return true; })()`);
  await cdp.pause(400);
  evidence.chainSelected = clicked;

  // ===== (a) 版本操作区集中 + 几何 =====
  const ops = await cdp.evaluate(`(() => {
    const R = e => { if(!e) return null; const r=e.getBoundingClientRect(); return {x:+r.x.toFixed(1),y:+r.y.toFixed(1),w:+r.width.toFixed(1),h:+r.height.toFixed(1),right:+r.right.toFixed(1),bottom:+r.bottom.toFixed(1)}; };
    const region = document.querySelector('.making-version-operations');
    const inside = (child, parent) => !!child && !!parent && child.x >= parent.x-1 && child.right <= parent.right+1 && child.y >= parent.y-1 && child.bottom <= parent.bottom+1;
    const rr = R(region);
    const items = {
      versionSelect: R(document.querySelector('#making-version-select')),
      enableBtn: R(document.querySelector('#making-enable-btn')),
      deactivateBtn: R(document.querySelector('#making-deactivate-btn')),
      using: R(document.querySelector('.making-version-using')),
      deleteChainBtn: R(document.querySelector('#making-delete-chain-btn')),
    };
    return { regionRect: rr, items,
      allInside: Object.fromEntries(Object.entries(items).map(([k,v]) => [k, inside(v, rr)])),
      usingText: document.querySelector('.making-version-using')?.textContent ?? null,
      versionOptions: [...document.querySelectorAll('#making-version-select option')].map(o=>o.textContent.trim()),
      regionText: (region?.innerText||'').replace(/\\s+/g,' ').slice(0,200) };
  })()`);
  evidence.stages.push({ name: 'version-operations', data: ops });
  assert('versionOps.regionPresent', !!ops.regionRect, { regionText: ops.regionText });
  assert('versionOps.enableDeactivateSameRegion', ops.allInside.enableBtn === true && ops.allInside.deactivateBtn === true && ops.allInside.versionSelect === true && ops.allInside.using === true, ops.allInside);
  assert('versionOps.versionsListed', (ops.versionOptions?.length ?? 0) >= 1, { options: ops.versionOptions });

  // ===== (b) 长卡全文首/中/尾 =====
  // 打开要求卡行 → 快捷小窗 → 打开完整详情。
  const opened = await cdp.evaluate(`(() => { const c=document.querySelector('#making-card-list .making-card-row'); if(!c)return false; c.click(); return true; })()`);
  await cdp.pause(300);
  evidence.cardRowOpened = opened;
  await shot('making-card-quick');
  const openFull = await cdp.evaluate(`(() => { const b=document.querySelector('.making-quick-open'); if(!b)return false; b.click(); return true; })()`);
  await cdp.pause(350);
  evidence.openedFullDetail = openFull;
  const detail = await cdp.evaluate(`(() => {
    const panel = document.querySelector('#making-card-panel');
    const vis = !!panel && !panel.classList.contains('hidden') && panel.getBoundingClientRect().width>0;
    const sections = [...(panel?.querySelectorAll('.making-card-panel-section')||[])].map(s => ({ heading: s.querySelector('.making-card-panel-heading')?.textContent ?? null, body: s.querySelector('.making-card-panel-body')?.textContent ?? null }));
    return { visible: vis, panelText: panel?.innerText ?? '', sections, panelChars: (panel?.innerText||'').length };
  })()`);
  await shot('making-card-full-detail');
  evidence.stages.push({ name: 'full-detail', data: { visible: detail.visible, panelChars: detail.panelChars, sectionHeadings: detail.sections.map(s=>s.heading), sectionLengths: detail.sections.map(s=>(s.body||'').length) } });
  assert('card.fullDetailVisible', detail.visible === true, {});
  const allText = detail.sections.map(s => s.body || '').join('\n') + '\n' + (detail.panelText || '');
  for (const m of BODY_MARKERS) {
    assert(`card.bodyContains(${m})`, allText.includes(m), { marker: m });
  }
  for (const m of TRIGGER_MARKERS) {
    assert(`card.triggerContains(${m})`, allText.includes(m), { marker: m });
  }
  // 「怎么做」段长度应等于正文全长（含首/中/尾标记），证明未摘要/截断。
  const howTo = detail.sections.find(s => s.heading === '怎么做')?.body ?? '';
  const whenTo = detail.sections.find(s => s.heading === '何时用')?.body ?? '';
  assert('card.howToFullLength', howTo.length >= 700 && howTo.includes('【正文开头】') && howTo.includes('【正文中段】') && howTo.includes('【正文结尾】'), { len: howTo.length });
  assert('card.whenToUseFullLength', whenTo.includes('【触发开头】') && whenTo.includes('【触发结尾】'), { len: whenTo.length });
} catch (error) {
  evidence.stages.push({ name: 'fatal', error: String(error?.message ?? error) });
} finally {
  evidence.consoleErrors = cdp.consoleErrors;
  evidence.finished = new Date().toISOString();
  writeFileSync(join(outDir, 'evidence-making.json'), JSON.stringify(evidence, null, 2));
  const failed = evidence.assertions.filter(a => !a.pass);
  process.exitCode = failed.length > 0 || evidence.stages.some(s => s.name === 'fatal') ? 1 : 0;
  console.log(JSON.stringify({ assertions: evidence.assertions, failed, fatal: evidence.stages.find(s=>s.name==='fatal') ?? null }, null, 2));
  cdp.close();
}
