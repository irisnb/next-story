import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const out = join(dirname(fileURLToPath(import.meta.url)), 'ui-screens');
mkdirSync(out, { recursive: true });
const evidence = { started: new Date().toISOString(), consoleErrors: [], stages: [], screenshots: [], limitations: [] };
const targets = await fetch('http://127.0.0.1:9223/json/list', { signal: AbortSignal.timeout(5000) }).then(r => r.json());
const target = targets.find(t => t.type === 'page' && t.title.includes('Next Story'));
if (!target) throw new Error('No real Next Story CDP page');
evidence.target = { id: target.id, url: target.url, title: target.title };
const ws = new WebSocket(target.webSocketDebuggerUrl);
const pending = new Map();
let seq = 0;
ws.addEventListener('message', event => {
  const message = JSON.parse(event.data);
  if (message.id && pending.has(message.id)) {
    const p = pending.get(message.id); clearTimeout(p.timer); pending.delete(message.id);
    message.error ? p.reject(new Error(JSON.stringify(message.error))) : p.resolve(message.result);
  }
  if (message.method === 'Runtime.exceptionThrown') evidence.consoleErrors.push(message.params.exceptionDetails.text);
  if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') evidence.consoleErrors.push(message.params.args.map(a => a.description ?? a.value ?? a.type).join(' ').slice(0, 600));
});
await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('WebSocket connect timeout')), 5000);
  ws.addEventListener('open', () => { clearTimeout(timer); resolve(); });
  ws.addEventListener('error', reject);
});
function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++seq;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`${method}: 8s timeout`)); }, 8000);
    pending.set(id, { resolve, reject, timer }); ws.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expression) {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
  return r.result?.value;
}
async function metrics() {
  return evaluate(`(() => {
    const visible = e => !!e && e.getBoundingClientRect().width > 0 && e.getBoundingClientRect().height > 0 && getComputedStyle(e).visibility !== 'hidden';
    const rect = e => { const r=e.getBoundingClientRect(); return {x:r.x,y:r.y,width:r.width,height:r.height}; };
    return {inner:[innerWidth,innerHeight],outer:[outerWidth,outerHeight],dpr:devicePixelRatio,
      pages:[...document.querySelectorAll('#welcome-page,#editor-page,.module-page')].filter(visible).map(e=>e.id),
      homeVisible:visible(document.querySelector('#welcome-page')),
      recentNames:[...document.querySelectorAll('.recent-work-name')].map(e=>e.textContent.trim()),
      overflow:[...document.querySelectorAll('button,input,select,[role=separator],.app-header,.ai-dock')].filter(visible).filter(e=>{const r=e.getBoundingClientRect();return r.left < -1 || r.right > innerWidth+1 || r.top < -1 || r.bottom > innerHeight+1;}).map(e=>({id:e.id,role:e.getAttribute('role'),rect:rect(e)})),
      ai:['ai-dock','ai-dock-maximize','ai-dock-divider'].map(id=>{const e=document.getElementById(id);return {id,visible:visible(e),rect:e?rect(e):null};}),
      labels:['making-zone-custom','making-zone-scroll'].map(id=>({id,label:document.getElementById(id)?.getAttribute('aria-label')}))};
  })()`);
}
async function shot(name) {
  // Mask secret controls before capture without reading their values.
  await evaluate(`document.querySelectorAll('input[type=password]').forEach(e=>e.style.visibility='hidden')`);
  const image = await send('Page.captureScreenshot', { format: 'png' });
  const path = join(out, `${name}.png`); writeFileSync(path, Buffer.from(image.data, 'base64')); evidence.screenshots.push(path);
}
const pause = ms => new Promise(resolve=>setTimeout(resolve,ms));
async function click(selector) {
  const p=await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)return null;const r=e.getBoundingClientRect();return r.width&&r.height?{x:r.x+r.width/2,y:r.y+r.height/2}:null;})()`);
  if(!p)throw new Error(`Click target not visible: ${selector}`);
  for(const type of ['mouseMoved','mousePressed','mouseReleased'])await send('Input.dispatchMouseEvent',{type,...p,button:type==='mouseMoved'?'none':'left',clickCount:1});
  await pause(180);
}
async function stage(name,fn) {
  try {const result=await fn();evidence.stages.push({name,result});}
  catch(error){evidence.stages.push({name,error:String(error.message)});}
}
async function resize(width,height){
  const native=JSON.parse(execFileSync('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',join(dirname(fileURLToPath(import.meta.url)),'ui-native-resize.ps1'),'-ClientWidth',String(width),'-ClientHeight',String(height)],{encoding:'utf8',timeout:10000}));
  await pause(200);return native;
}
try {
  await send('Runtime.enable'); await send('Page.enable');
  const initial = await metrics(); evidence.stages.push({ name:'initial-real-webview', metrics:initial });
  await shot('ui-initial');
  if (initial.homeVisible || await evaluate(`!document.querySelector('#new-project-page')?.classList.contains('hidden')`)) {
    if(initial.homeVisible){await click('#btn-new-project');await click('#project-name');await send('Input.insertText',{text:'UI-v5-验收-临时'});}
    // Location field is read-only: use its ordinary form state/input validation path, bypassing only the native folder picker.
    await evaluate(`(()=>{const e=document.querySelector('#save-location');e.value='C:\\\\Users\\\\Administrator\\\\AppData\\\\Local\\\\Temp\\\\opencode\\\\ui-v5-isolated-project';e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));})()`);
    await evaluate(`document.querySelector('#project-name').dispatchEvent(new Event('input',{bubbles:true}))`);
    await click('#btn-create-project');
    for(let i=0;i<25;i++){if(await evaluate(`document.querySelector('#current-project-name')?.textContent.includes('UI-v5-验收-临时') && !document.querySelector('#editor-page')?.classList.contains('hidden')`))break;await pause(200);}
    evidence.stages.push({name:'isolated-create-ui',metrics:await metrics()});
  }
  const isolated=await evaluate(`document.querySelector('#current-project-name')?.textContent.includes('UI-v5-验收-临时') && !document.querySelector('#editor-page')?.classList.contains('hidden')`);
  if(!isolated){evidence.formDiagnostic=await evaluate(`({nameError:document.querySelector('#name-error')?.textContent,locationError:document.querySelector('#location-error')?.textContent,location:document.querySelector('#save-location')?.value,currentName:document.querySelector('#current-project-name')?.textContent})`);await shot('ui-create-blocked');throw new Error('Isolated project not opened; refuse other project actions');}
  await click('#tab-writing');
  await stage('AI-open',async()=>{await click('#btn-toggle-ai');return metrics();});
  const draft='UI-v5 临时输入草稿，不发送';
  await stage('AI-draft',async()=>{await click('#ai-dock [data-role="direct-question-input"]');await send('Input.insertText',{text:draft});return {entered:true};});
  await stage('AI-maximize',async()=>{await click('#ai-dock-maximize');await shot('ui-ai-maximized');return metrics();});
  await stage('AI-restore',async()=>{await click('#ai-dock-maximize');return metrics();});
  await stage('AI-hide-reopen-draft',async()=>{await click('#ai-dock-collapse');const hidden=await metrics();await click('#btn-toggle-ai');return {hidden,reopened:await metrics(),draftPreserved:await evaluate(`document.querySelector('#ai-dock [data-role="direct-question-input"]')?.value===${JSON.stringify(draft)}`)};});
  await stage('divider-keyboard',async()=>{await click('#ai-dock-divider');const before=await metrics();for(const type of ['keyDown','keyUp'])await send('Input.dispatchKeyEvent',{type,key:'ArrowLeft',code:'ArrowLeft',windowsVirtualKeyCode:37});return {before,after:await metrics()};});
  await stage('divider-mouse',async()=>{const p=await evaluate(`(()=>{const r=document.querySelector('#ai-dock-divider').getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2};})()`);const before=await metrics();await send('Input.dispatchMouseEvent',{type:'mousePressed',...p,button:'left',clickCount:1});await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:p.x-35,y:p.y,button:'left',buttons:1});await send('Input.dispatchMouseEvent',{type:'mouseReleased',x:p.x-35,y:p.y,button:'left',clickCount:1});return{before,after:await metrics()};});
  for (const [width,height] of [[1024,670],[1280,720],[1440,900]]) {
    try {
      if (width === 1024) {
        evidence.tauriResizeAttempt = await evaluate(`(async()=>{try {const {getCurrentWindow}=await import('/node_modules/@tauri-apps/api/window.js');const {LogicalSize}=await import('/node_modules/@tauri-apps/api/dpi.js');await getCurrentWindow().setSize(new LogicalSize(1024,670));return {ok:true};} catch(e) {return {ok:false,error:String(e)};}})()`);
      }
      const native = await resize(width,height);
      await new Promise(resolve=>setTimeout(resolve,250));
      evidence.stages.push({ name:`client-${width}x${height}`, native, metrics:await metrics() });
      await click('#tab-writing');await shot(`ui-writing-${width}x${height}`);
      await click('#tab-making');await shot(`ui-making-${width}x${height}`);evidence.stages.push({name:`making-${width}x${height}`,metrics:await metrics()});
    } catch(error) { evidence.stages.push({name:`client-${width}x${height}`,error:String(error.message)}); break; }
  }
  for(const [page,selector] of [['manage','#tab-files'],['settings','#tab-settings']])await stage(page,async()=>{await click(selector);await shot(`ui-${page}-1440x900`);return metrics();});
  await click('#tab-writing');
  evidence.limitations.push('No document body input, model request or global chain/config modification. Native folder picker alone bypassed by setting ordinary form location and dispatching input/change. DPI 96/DPR1 only. Human click verification remains.');
} catch(error) { evidence.stages.push({name:'fatal',error:String(error.message)}); }
finally {
  evidence.finished = new Date().toISOString();
  writeFileSync(join(out,'ui-evidence.json'),JSON.stringify(evidence,null,2));
  console.log(JSON.stringify(evidence,null,2)); ws.close();
}
