// probe-editor.mjs — 打开隔离验收项目并侦察笔记本编辑器 DOM（只读）。
import { connect } from './cdp-client.mjs';

const PROJECT_NAME = 'CDP几何验收-隔离';
const cdp = await connect(Number(process.argv[2] ?? 9225));
const out = {};

const welcome = await cdp.evaluate(`!document.querySelector('#welcome-page')?.classList.contains('hidden')`);
out.welcome = welcome;
if (welcome) {
  const clicked = await cdp.evaluate(`(() => {
    const items=[...document.querySelectorAll('.recent-work-item')];
    const it=items.find(e=>(e.querySelector('.recent-work-name')?.textContent||'').includes(${JSON.stringify(PROJECT_NAME)}));
    if(!it) return { found:false, names: items.map(e=>e.querySelector('.recent-work-name')?.textContent) };
    it.click(); return { found:true };
  })()`);
  out.clicked = clicked;
  for (let i=0;i<60;i++){ if (await cdp.evaluate(`!document.querySelector('#editor-page')?.classList.contains('hidden')`)) break; await cdp.pause(200); }
  await cdp.pause(500);
}
await cdp.evaluate(`document.querySelector('#tab-writing')?.click()`);
await cdp.pause(300);

out.editor = await cdp.evaluate(`(() => {
  const root=document.querySelector('#editor-textarea');
  const pm=document.querySelector('#editor-textarea .ProseMirror') || document.querySelector('.ProseMirror');
  const selEntry=document.querySelector('#ai-selection-entry');
  const vis=e=>!!e&&e.getBoundingClientRect().width>0&&getComputedStyle(e).visibility!=='hidden'&&!e.classList.contains('hidden');
  return {
    editorVisible: vis(root),
    rootClass: root?.className ?? null,
    pmExists: !!pm,
    pmClass: pm?.className ?? null,
    pmEditable: pm?.getAttribute('contenteditable') ?? null,
    pmText: (pm?.innerText||'').slice(0,300),
    pmChildren: pm ? [...pm.children].map(c=>c.tagName+'.'+c.className) : null,
    selEntryExists: !!selEntry, selEntryHidden: selEntry?.classList.contains('hidden') ?? null,
    boldBtn: !!document.getElementById('btn-bold'),
    currentDoc: document.querySelector('#current-doc-toggle')?.textContent?.trim() ?? document.querySelector('.current-doc-name')?.textContent ?? null,
  };
})()`);
console.log(JSON.stringify(out, null, 2));
cdp.close();
