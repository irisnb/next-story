import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const directory = dirname(fileURLToPath(import.meta.url));
const out = join(directory, 'v5-parity-screens');
mkdirSync(out, { recursive: true });
const evidence = { started: new Date().toISOString(), stages: [], screenshots: [], errors: [] };
const targets = await fetch('http://127.0.0.1:9223/json/list', { signal: AbortSignal.timeout(5000) }).then(r => r.json());
const target = targets.find(t => t.type === 'page' && t.title.includes('Next Story'));
if (!target) throw new Error('No real Next Story page');
const ws = new WebSocket(target.webSocketDebuggerUrl);
const pending = new Map(); let sequence = 0;
ws.addEventListener('message', event => {
  const message = JSON.parse(event.data);
  const entry = pending.get(message.id);
  if (entry) { clearTimeout(entry.timer); pending.delete(message.id); message.error ? entry.reject(new Error(JSON.stringify(message.error))) : entry.resolve(message.result); }
  if (message.method === 'Runtime.exceptionThrown') evidence.errors.push(message.params.exceptionDetails.text);
});
await new Promise((resolve, reject) => { ws.addEventListener('open', resolve, { once: true }); ws.addEventListener('error', reject, { once: true }); });
function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`${method}: timeout`)); }, 8000);
    pending.set(id, { resolve, reject, timer }); ws.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expression) {
  const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
  return result.result.value;
}
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function click(selector) {
  const point = await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});const r=e?.getBoundingClientRect();return r?.width&&r.height?{x:r.x+r.width/2,y:r.y+r.height/2}:null})()`);
  if (!point) throw new Error(`Not visible: ${selector}`);
  for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type, ...point, button: type === 'mouseMoved' ? 'none' : 'left', clickCount: 1 });
  await pause(180);
}
async function metrics() {
  return evaluate(`(()=>{const ids=['format-toolbar','ai-dock','ai-conversation-list-toggle','ai-dock-maximize','ai-dock-collapse','writing-tool-options'];const visible=e=>!!e&&!!e.getClientRects().length;const rect=e=>{const r=e.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height}};return{viewport:[innerWidth,innerHeight],dpr:devicePixelRatio,controls:ids.map(id=>{const e=document.getElementById(id);return{id,visible:visible(e),rect:e?rect(e):null,expanded:e?.getAttribute('aria-expanded'),pressed:e?.getAttribute('aria-pressed')}}),rail:[...document.querySelectorAll('#format-toolbar>.tool-button,#format-toolbar>.ol-style-row')].map(e=>e.id||'number'),overflow:[...document.querySelector('#toolbar-overflow-menu').children].map(e=>e.id||'number'),rules:document.querySelectorAll('#format-toolbar>.tool-rule').length,projection:document.querySelectorAll('#ai-dock-body>.ai-window').length,overflowing:[...document.querySelectorAll('#format-toolbar button,#ai-dock-header button,.ai-dock-header button')].filter(visible).filter(e=>{const r=e.getBoundingClientRect();return r.right>innerWidth+1||r.bottom>innerHeight+1||r.left<0}).map(e=>e.id)}})()`);
}
async function shot(name) {
  const image = await send('Page.captureScreenshot', { format: 'png' });
  const path = join(out, `${name}.png`);
  writeFileSync(path, Buffer.from(image.data, 'base64')); evidence.screenshots.push(path);
}
try {
  await send('Runtime.enable'); await send('Page.enable');
  await send('Emulation.clearDeviceMetricsOverride');
  await send('Page.reload'); await pause(1200);
  const home = await evaluate(`!document.getElementById('welcome-page').classList.contains('hidden')`);
  if (!home) {
    if (await evaluate(`!document.getElementById('new-project-page').classList.contains('hidden')`)) await click('#btn-cancel-new');
    else throw new Error('Expected home; refuse unknown project content');
  }
  await click('#btn-new-project'); await click('#project-name');
  const name = `UI-v5-toolbar-AI-${Date.now()}`;
  evidence.projectName = name;
  await send('Input.insertText', { text: name });
  await evaluate(`(()=>{const e=document.getElementById('save-location');e.value='C:/Users/Administrator/AppData/Local/Temp/opencode';e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));document.getElementById('project-name').dispatchEvent(new Event('input',{bubbles:true}));})()`);
  await click('#btn-create-project');
  for (let i = 0; i < 30; i++) {
    if (await evaluate(`document.getElementById('current-project-name').textContent===${JSON.stringify(name)}&&!document.getElementById('editor-page').classList.contains('hidden')`)) break;
    await pause(200);
  }
  if (!await evaluate(`document.getElementById('current-project-name').textContent===${JSON.stringify(name)}`)) {
    evidence.creationDiagnostic = await evaluate(`({nameError:document.getElementById('name-error')?.textContent,locationError:document.getElementById('location-error')?.textContent,currentName:document.getElementById('current-project-name')?.textContent,pages:['welcome-page','new-project-page','editor-page'].filter(id=>!document.getElementById(id)?.classList.contains('hidden'))})`);
    throw new Error('Temporary project create failed');
  }
  await click('#btn-toggle-ai');
  await click('#ai-conversation-list-toggle');
  await click('#ai-list-new-conversation');
  const draft = 'UI 验证草稿，保留不发送';
  await click('#ai-dock [data-role="direct-question-input"]');
  await send('Input.insertText', { text: draft });
  for (const [width, height] of [[1024, 670], [1280, 720], [1440, 900]]) {
    const native = JSON.parse(execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', join(directory, 'v5-parity-resize.ps1'), '-ClientWidth', String(width), '-ClientHeight', String(height)], { encoding: 'utf8', timeout: 10000 }));
    await pause(250);
    // WebView2 can retain its previous viewport despite the native client resize.
    // Explicit CDP viewport is recorded separately from the native window result.
    await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
    const viewport = await evaluate('[innerWidth,innerHeight]');
    if (viewport[0] !== width || viewport[1] !== height) throw new Error(`Viewport mismatch: expected ${width}x${height}, got ${viewport.join('x')}`);
    await shot(`sidebar-${width}x${height}`);
    const sidebar = await metrics();
    await click('#ai-dock-maximize'); await shot(`maximized-${width}x${height}`);
    const maximized = await metrics();
    maximized.content = await evaluate(`(()=>{const rect=e=>{const r=e.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height}};const icon=document.querySelector('#ai-dock-maximize svg.panelicon');return{nodes:[...document.querySelectorAll('#ai-dock .ai-window-head,#ai-dock .ai-window-body,#ai-dock .ai-window-input')].map(e=>({class:e.className,...rect(e)})),icon:icon?{...rect(icon),path:icon.querySelector('path')?.getAttribute('d'),label:document.querySelector('#ai-dock-maximize span')?.textContent}:null}})()`);
    if(maximized.content.icon?.width!==16||maximized.content.icon?.height!==16||maximized.content.icon?.label!=='恢复边栏'||maximized.content.icon?.path!=='M8 4h12v12h-4M4 8h12v12H4ZM4 12h12')throw new Error('Restore panelicon mismatch: '+JSON.stringify(maximized.content.icon));
    if (maximized.controls.find(c=>c.id==='format-toolbar').visible || maximized.controls.find(c=>c.id==='ai-dock').rect.x!==0) throw new Error('Maximized dock must occupy the full width without the writing rail');
    for (const node of maximized.content.nodes) if (Math.abs(node.width-760)>1 || Math.abs(node.x-(width-760)/2)>1) throw new Error('Maximized content must be 760px and centered');
    await click('#ai-dock-maximize'); await shot(`restored-${width}x${height}`);
    const restored = await metrics();
    restored.icon=await evaluate(`(()=>{const icon=document.querySelector('#ai-dock-maximize svg.panelicon'),r=icon?.getBoundingClientRect();return{width:r?.width,height:r?.height,path:icon?.querySelector('path')?.getAttribute('d'),label:document.querySelector('#ai-dock-maximize span')?.textContent}})()`);
    if(restored.icon.width!==16||restored.icon.height!==16||restored.icon.label!=='最大化'||restored.icon.path!=='M4 4h16v16H4ZM4 8h16')throw new Error('Maximize panelicon did not restore its correct state');
    await click('#ai-dock-collapse'); await shot(`writing-${width}x${height}`);
    const hidden = await metrics();
    hidden.root = await evaluate(`(()=>{const e=document.getElementById('module-writing');return{client:e.clientWidth,scroll:e.scrollWidth}})()`);
    if(hidden.root.scroll>hidden.root.client+1) throw new Error('Collapsed writing module has horizontal overflow');
    await click('#btn-toggle-ai');
    const preserved = await evaluate(`document.querySelector('#ai-dock [data-role="direct-question-input"]').value===${JSON.stringify(draft)}`);
    evidence.stages.push({ size: [width, height], native, sidebar, maximized, restored, hidden, draftPreserved: preserved });
    if (!preserved) throw new Error('Hidden panel lost unsent draft');
  }
  evidence.limitations = ['Isolated empty project; no user document body read or changed, no model request.', 'Native folder picker bypassed only by ordinary form location input.', 'Viewport explicitly set with CDP; native resize alone did not update WebView viewport, so native resize behavior remains unverified.', 'DPI reported by verified native window; additional DPI and human visual comparison remain separate.'];
} catch (error) { evidence.errors.push(String(error.message)); process.exitCode = 1; }
finally { evidence.finished = new Date().toISOString(); writeFileSync(join(out, 'evidence.json'), JSON.stringify(evidence, null, 2)); console.log(JSON.stringify({ stages: evidence.stages.map(s => ({ size: s.size, dpi: s.native.dpi, draftPreserved: s.draftPreserved, overflowing: s.sidebar.overflowing, maximize: s.sidebar.controls.find(c => c.id === 'ai-dock-maximize').rect })), screenshots: evidence.screenshots, errors: evidence.errors }, null, 2)); ws.close(); }
