// setup-docs.mjs — 在隔离项目准备两篇文档（用户式 UI 操作；不 AI 写作品）。
// Doc A（当前/关注）与 Doc B（另一篇，含唯一标记），供 4.4 真实补读授权。
import { connect } from './cdp-client.mjs';

const PROJECT_NAME = 'CDP几何验收-隔离';
const DOC_A = '雾岭车站的第七封信：主角把信收进外套，决定明天再拆开。';
const DOC_B_NAME = '钟表铺';
const DOC_B = '南旧巷的钟表铺里停着一只蓝色乌鸦，钟摆停在凌晨三点七分。';
const B_MARKERS = ['钟表铺', '蓝色乌鸦', '凌晨三点七分'];

const cdp = await connect(Number(process.argv[2] ?? 9225));
const out = {};
const typeIntoEditor = async (text) => {
  await cdp.evaluate(`(() => { const pm=document.querySelector('#editor-textarea .ProseMirror'); pm.focus(); })()`);
  await cdp.pause(120);
  await cdp.send('Input.dispatchKeyEvent', { type:'keyDown', key:'a', code:'KeyA', windowsVirtualKeyCode:65, modifiers:2 });
  await cdp.send('Input.dispatchKeyEvent', { type:'keyUp', key:'a', code:'KeyA', windowsVirtualKeyCode:65, modifiers:2 });
  await cdp.key('Delete','Delete',46);
  await cdp.pause(120);
  await cdp.insertText(text);
  await cdp.pause(200);
};

// 1) 打开项目
const welcome = await cdp.evaluate(`!document.querySelector('#welcome-page')?.classList.contains('hidden')`);
if (welcome) {
  await cdp.evaluate(`(() => { const it=[...document.querySelectorAll('.recent-work-item')].find(e=>(e.querySelector('.recent-work-name')?.textContent||'').includes(${JSON.stringify(PROJECT_NAME)})); it?.click(); })()`);
  for (let i=0;i<60;i++){ if (await cdp.evaluate(`!document.querySelector('#editor-page')?.classList.contains('hidden')`)) break; await cdp.pause(200); }
}
await cdp.evaluate(`document.querySelector('#tab-writing')?.click()`); await cdp.pause(300);
out.before = await cdp.evaluate(`({ current: document.querySelector('#current-document-name')?.textContent ?? '', pmText: (document.querySelector('#editor-textarea .ProseMirror')?.innerText||'').slice(0,120) })`);

// 2) 写 Doc A（当前文档）
await typeIntoEditor(DOC_A);
out.docA = await cdp.evaluate(`({ current: document.querySelector('#current-document-name')?.textContent ?? '', pmText: (document.querySelector('#editor-textarea .ProseMirror')?.innerText||'').slice(0,160) })`);

// 3) 新建第二篇文档
await cdp.evaluate(`document.querySelector('#tab-files')?.click()`); await cdp.pause(400);
const docCountBefore = await cdp.evaluate(`document.querySelectorAll('#fm-file-tree [data-node-id]').length`);
await cdp.click('#fm-new-document');
await cdp.pause(700);
out.afterNew = await cdp.evaluate(`(() => {
  const rows=[...document.querySelectorAll('#fm-file-tree [data-node-id]')];
  return { count: rows.length, rows: rows.map(r=>({ id:r.getAttribute('data-node-id'), text:(r.innerText||'').replace(/\\s+/g,' ').slice(0,80), actions:[...r.querySelectorAll('.file-actions button, .file-actions [title]')].map(b=>b.getAttribute('title')||b.textContent.trim()).slice(0,6) })) };
})()`);
out.docCountBefore = docCountBefore;

// 4) 重命名新建文档为 DOC_B_NAME（override window.prompt，沿归档既有方法）
await cdp.evaluate(`(() => { globalThis.prompt = () => ${JSON.stringify(DOC_B_NAME)}; return true; })()`);
// 找最近新增的文档行（名称未命名文档且非第一个）→ 点重命名
const renamed = await cdp.evaluate(`(() => {
  const rows=[...document.querySelectorAll('#fm-file-tree [data-node-id]')];
  // 新文档通常是 id 最大的一个
  const target = rows[rows.length-1];
  if(!target) return { ok:false };
  const btn=[...target.querySelectorAll('button')].find(b=>/重命名|改名|\u91cd\u547d\u540d/.test(b.getAttribute('title')||b.textContent||''));
  if(!btn) return { ok:false, reason:'rename btn not found', buttons:[...target.querySelectorAll('button')].map(b=>({t:b.getAttribute('title'),x:b.textContent.trim()})) };
  btn.click(); return { ok:true };
})()`);
await cdp.pause(700);
out.renamed = renamed;
out.afterRename = await cdp.evaluate(`[...document.querySelectorAll('#fm-file-tree [data-node-id]')].map(r=>({ id:r.getAttribute('data-node-id'), text:(r.innerText||'').replace(/\\s+/g,' ').slice(0,60) }))`);

// 5) 打开 Doc B（双击行）并写入内容
await cdp.evaluate(`(() => {
  const rows=[...document.querySelectorAll('#fm-file-tree [data-node-id]')];
  const target=[...rows].reverse().find(r=>(r.innerText||'').includes(${JSON.stringify(DOC_B_NAME)})) || rows[rows.length-1];
  target?.dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));
  return { opened: !!target };
})()`);
await cdp.pause(900);
await cdp.evaluate(`document.querySelector('#tab-writing')?.click()`); await cdp.pause(300);
out.afterOpenB = await cdp.evaluate(`document.querySelector('#current-document-name')?.textContent ?? ''`);
await typeIntoEditor(DOC_B);
out.docB = await cdp.evaluate(`({ current: document.querySelector('#current-document-name')?.textContent ?? '', pmText: (document.querySelector('#editor-textarea .ProseMirror')?.innerText||'').slice(0,160), hasMarkers: ${JSON.stringify(B_MARKERS)}.every(m=>(document.querySelector('#editor-textarea .ProseMirror')?.innerText||'').includes(m)) })`);

// 6) 回到 Doc A
await cdp.evaluate(`(() => {
  const rows=[...document.querySelectorAll('#fm-file-tree [data-node-id]')];
  const a=rows.find(r=>!(r.innerText||'').includes(${JSON.stringify(DOC_B_NAME)})) || rows[0];
  a?.dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));
})()`);
await cdp.pause(800);
await cdp.evaluate(`document.querySelector('#tab-writing')?.click()`); await cdp.pause(300);
out.backToA = await cdp.evaluate(`({ current: document.querySelector('#current-document-name')?.textContent ?? '', pmText: (document.querySelector('#editor-textarea .ProseMirror')?.innerText||'').slice(0,160) })`);

console.log(JSON.stringify(out, null, 2));
cdp.close();
