// 真实隔离 Tauri UI：300px 长标题删除提示与鼠标/键盘撤销。
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { connect } from './cdp-client.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const c = await connect(Number(process.argv[2] ?? 9225));
const evidence = { target: c.target, assertions: [], measurements: [], screenshots: [] };
const check = (name, pass) => { evidence.assertions.push({ name, pass: !!pass }); if (!pass) throw new Error(name); };
try {
  const welcome = await c.evaluate(`!document.querySelector('#welcome-page').classList.contains('hidden')`);
  if (welcome) {
    const safeRecent = await c.evaluate(`(() => { const e=document.querySelector('#recent-works-list'); return e.textContent.includes('acceptance-fix-ai') && e.textContent.includes('CDP几何验收-隔离'); })()`);
    check('isolated recent project', safeRecent);
    await c.click('#recent-works-list button');
    await c.pause(600);
  }
  check('isolated project open', await c.evaluate(`document.querySelector('#current-project-name').textContent === 'CDP几何验收-隔离'`));
  await c.click('#tab-writing');
  if (await c.evaluate(`document.querySelector('#ai-dock').classList.contains('hidden')`)) await c.click('#btn-toggle-ai');
  if (await c.evaluate(`document.querySelector('#ai-dock').classList.contains('ai-panel-maximized')`)) await c.click('#ai-dock-maximize');
  await c.evaluate(`document.querySelector('#ai-dock-divider').focus()`);
  for (let i=0;i<60;i++) {
    if (await c.evaluate(`document.querySelector('#ai-dock-divider').getAttribute('aria-valuenow') === '300'`)) break;
    await c.key('ArrowRight','ArrowRight',39);
  }
  await c.pause(400);
  evidence.panel = await c.evaluate(`({width:document.querySelector('#ai-dock').getBoundingClientRect().width, value:document.querySelector('#ai-dock-divider').getAttribute('aria-valuenow'),cls:document.querySelector('#ai-dock').className})`);
  check('actual panel width 300px', Math.abs(evidence.panel.width-300)<1);
  if (await c.evaluate(`document.querySelector('.ai-conversation-list').classList.contains('hidden')`)) await c.click('#ai-conversation-list-toggle');
  if (await c.evaluate(`!!document.querySelector('.ai-dock-notice-undo')`)) await c.click('.ai-dock-notice-undo');
  if (!(await c.evaluate(`(document.querySelector('.ai-cl-row .ai-cl-title')?.textContent.length ?? 0)>=40`))) {
    await c.click('#ai-list-new-conversation');
    await c.pause(300);
    await c.evaluate(`(() => {const e=document.querySelector('[data-role="direct-question-input"]');e.value='撤销提示真实验收长标题一二三四五六七八九十甲乙丙丁戊己庚辛壬癸子丑寅卯辰巳午未申酉戌亥';e.dispatchEvent(new Event('input',{bubbles:true}))})()`);
    await c.click('[data-role="direct-question-send"]');
    await c.pause(600);
    if (await c.evaluate(`document.querySelector('.ai-conversation-list').classList.contains('hidden')`)) await c.click('#ai-conversation-list-toggle');
  }
  check('long title fixture present', await c.evaluate(`(document.querySelector('.ai-cl-row .ai-cl-title')?.textContent.length ?? 0)>=40`));
  const initialRows = await c.evaluate(`document.querySelectorAll('.ai-cl-row').length`);
  for (const mode of ['mouse','keyboard']) {
    await c.hover('#ai-conversation-list-toggle');
    await c.hover('.ai-cl-row');
    await c.click('.ai-cl-row .ai-cl-act.del');
    await c.click('.ai-cl-row .ai-cl-confirm .danger');
    await c.pause(300);
    const geometry = await c.evaluate(`(() => {
      const n=document.querySelector('#ai-dock-notice'), t=n.querySelector('.ai-dock-notice-text'), b=n.querySelector('.ai-dock-notice-undo');
      if (!t || !b) throw new Error('Updated notice not rendered');
      const rect=e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom}};
      const nr=rect(n), tr=rect(t), br=rect(b), bs=getComputedStyle(b), ts=getComputedStyle(t);
      const range=document.createRange();range.selectNodeContents(b);
      const lineRects=[...range.getClientRects()].map(r=>({y:r.y,height:r.height,width:r.width}));
      return {notice:nr,text:tr,button:br,buttonText:b.textContent,copy:t.textContent,title:t.title,
        flexShrink:bs.flexShrink,whiteSpace:bs.whiteSpace,lineRects,
        textOverflow:ts.textOverflow,truncated:t.scrollWidth>t.clientWidth,
        hitIsUndo:document.elementFromPoint(br.x+br.width/2,br.y+br.height/2)===b,
        noOverlap:tr.right<=br.x,inside:br.right<=nr.right && br.bottom<=nr.bottom,
        listVisible:!document.querySelector('.ai-conversation-list').classList.contains('hidden')};
    })()`);
    evidence.measurements.push({ mode, ...geometry });
    check(`${mode}: button not shrinking and single line`, geometry.flexShrink==='0' && geometry.whiteSpace==='nowrap' && geometry.lineRects.length===1 && geometry.button.width>=48);
    check(`${mode}: title ellipsis without overlap`, geometry.truncated && geometry.textOverflow==='ellipsis' && geometry.noOverlap && geometry.inside);
    check(`${mode}: short copy and complete title tooltip`, geometry.copy.startsWith('已删除：') && geometry.title.length>=40);
    check(`${mode}: list open and undo hit unobscured`, geometry.listVisible && geometry.hitIsUndo);
    const screenshot=join(here,'evidence-ai',`undo-notice-300-${mode}.png`);
    await c.screenshot(screenshot); evidence.screenshots.push(screenshot);
    if (mode==='mouse') await c.click('.ai-dock-notice-undo');
    else {
      await c.evaluate(`document.querySelector('.ai-dock-notice-undo').focus()`);
      await c.send('Input.dispatchKeyEvent', { type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13,nativeVirtualKeyCode:13,text:'\r',unmodifiedText:'\r' });
      await c.send('Input.dispatchKeyEvent', { type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13,nativeVirtualKeyCode:13 });
    }
    await c.pause(350);
    check(`${mode}: undo restores discussion and clears notice`, await c.evaluate(`document.querySelectorAll('.ai-cl-row').length===${initialRows} && document.querySelector('#ai-dock-notice').classList.contains('hidden')`));
  }
  check('no console errors', c.consoleErrors.length===0);
} catch (error) { evidence.error=String(error); process.exitCode=1; }
finally {
  evidence.consoleErrors=c.consoleErrors;
  writeFileSync(join(here,'evidence-ai','undo-notice-300.json'), JSON.stringify(evidence,null,2));
  console.log(JSON.stringify(evidence,null,2)); c.close();
}
