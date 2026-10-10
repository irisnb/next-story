// bootstrap.mjs — 在隔离验收实例中创建/打开一个隔离测试项目并展开 AI 面板。
// 只使用 UI 的常规路径（除原生文件夹选择器外，本 change 允许把普通表单 location 设为隔离临时目录）。
// 不读写任何用户真实项目；项目落在预批准临时目录下。
import { connect } from './cdp-client.mjs';

const PROJECT_NAME = 'CDP几何验收-隔离';
const PROJECT_DIR = 'C:\\Users\\Administrator\\AppData\\Local\\Temp\\opencode\\acceptance-fix-ai\\project-geometry';

const cdp = await connect(Number(process.argv[2] ?? 9225));
const out = {};

out.before = await cdp.evaluate(`({ welcome: !document.querySelector('#welcome-page')?.classList.contains('hidden'), editor: !document.querySelector('#editor-page')?.classList.contains('hidden'), current: document.querySelector('#current-project-name')?.textContent ?? '' })`);

const alreadyOpen = await cdp.evaluate(`(() => { const e=document.querySelector('#editor-page'); return !!e && !e.classList.contains('hidden'); })()`);

if (!alreadyOpen) {
  // 若已在新建项目表单则直接用；否则进入新建。
  const onForm = await cdp.evaluate(`!document.querySelector('#new-project-page')?.classList.contains('hidden')`);
  if (!onForm) { await cdp.click('#btn-new-project'); }
  await cdp.evaluate(`(() => {
    // 位置字段无独立监听：先写入位置，再触发名称 input 使 validateForm 读到位置值。
    const loc = document.querySelector('#save-location');
    loc.value = ${JSON.stringify(PROJECT_DIR)};
    loc.dispatchEvent(new Event('input', { bubbles: true }));
    loc.dispatchEvent(new Event('change', { bubbles: true }));
    const name = document.querySelector('#project-name');
    name.value = ${JSON.stringify(PROJECT_NAME)};
    name.dispatchEvent(new Event('input', { bubbles: true }));
    name.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  await cdp.click('#btn-create-project');
  for (let i = 0; i < 40; i++) {
    const ready = await cdp.evaluate(`!document.querySelector('#editor-page')?.classList.contains('hidden')`);
    if (ready) break;
    await cdp.pause(200);
  }
  out.afterCreate = await cdp.evaluate(`({ editor: !document.querySelector('#editor-page')?.classList.contains('hidden'), current: document.querySelector('#current-project-name')?.textContent ?? '', nameError: document.querySelector('#name-error')?.textContent, locationError: document.querySelector('#location-error')?.textContent })`);
}

// 打开 AI 面板（写作页顶栏入口）。
await cdp.evaluate(`document.querySelector('#tab-writing')?.click()`);
await cdp.pause(200);
const panelOpen = await cdp.evaluate(`(() => { const d=document.querySelector('#ai-dock'); return !!d && !d.classList.contains('hidden'); })()`);
if (!panelOpen) { await cdp.click('#btn-toggle-ai'); await cdp.pause(300); }

out.panel = await cdp.evaluate(`(() => { const d=document.querySelector('#ai-dock'); const r=d.getBoundingClientRect(); return { open: !d.classList.contains('hidden'), width: Math.round(r.width), rect: {x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height)} }; })()`);

console.log(JSON.stringify(out, null, 2));
cdp.close();
