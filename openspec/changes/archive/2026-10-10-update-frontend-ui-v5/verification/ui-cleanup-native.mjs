import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const dir=dirname(fileURLToPath(import.meta.url)),out=join(dir,'ui-cleanup-screens');
mkdirSync(out,{recursive:true});
const owned=JSON.parse(readFileSync('C:/Users/Administrator/AppData/Local/Temp/opencode/ui-v5-app-owned.json','utf8'));
const evidence={owned,started:new Date().toISOString(),stages:[],errors:[],limits:['No model request; draft only. No user body/secret read or global chain write. Observer owns visual review.']};
const target=(await(await fetch('http://127.0.0.1:9223/json/list')).json()).find(t=>t.type==='page'&&t.title==='Next Story');
if(!target)throw new Error('No Next Story page');
const ws=new WebSocket(target.webSocketDebuggerUrl),pending=new Map();let sequence=0;
await new Promise(r=>ws.addEventListener('open',r,{once:true}));
ws.addEventListener('message',e=>{const m=JSON.parse(e.data),p=pending.get(m.id);if(p){clearTimeout(p.timer);pending.delete(m.id);m.error?p.reject(new Error(JSON.stringify(m.error))):p.resolve(m.result);}});
const send=(method,params={})=>new Promise((resolve,reject)=>{const id=++sequence,timer=setTimeout(()=>reject(new Error(method+' timeout')),8000);pending.set(id,{resolve,reject,timer});ws.send(JSON.stringify({id,method,params}));});
const ev=async expression=>{const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw new Error(r.exceptionDetails.exception?.description??r.exceptionDetails.text);return r.result.value;};
const settle=()=>new Promise(r=>setTimeout(r,700));
async function click(selector){const p=await ev(`(()=>{const r=document.querySelector(${JSON.stringify(selector)})?.getBoundingClientRect();return r?.width&&r.height?{x:r.x+r.width/2,y:r.y+r.height/2}:null})()`);if(!p)throw new Error('Not visible '+selector);for(const type of ['mouseMoved','mousePressed','mouseReleased'])await send('Input.dispatchMouseEvent',{type,...p,button:type==='mouseMoved'?'none':'left',clickCount:1});await settle();}
const win=(action,w=0,h=0)=>JSON.parse(execFileSync('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',join(dir,'v5-parity-resize.ps1'),'-Action',action,'-ClientWidth',String(w),'-ClientHeight',String(h)],{encoding:'utf8',timeout:10000}));
async function shot(name){const r=await send('Page.captureScreenshot',{format:'png'});writeFileSync(join(out,name+'.png'),Buffer.from(r.data,'base64'));}
const mark=()=>ev(`(()=>{const e=document.querySelector('#ai-dock [data-role="direct-question-send"]'),s=getComputedStyle(e),p=getComputedStyle(e,'::after'),r=e.getBoundingClientRect();return{name:e.getAttribute('aria-label'),disabled:e.disabled,button:[r.width,r.height],background:s.backgroundColor,outline:[s.outlineStyle,s.outlineWidth],focused:document.activeElement===e,focusVisible:e.matches(':focus-visible'),image:{width:p.width,height:p.height,ratio:p.aspectRatio,filter:p.filter,opacity:p.opacity}}})()`);
try{
  await send('Emulation.clearDeviceMetricsOverride');await send('Page.reload');await settle();
  if(await ev(`!document.getElementById('welcome-page').classList.contains('hidden')`)){
    await click('#btn-new-project');await click('#project-name');const name='UI-v5-cleanup-'+Date.now();await send('Input.insertText',{text:name});
    await ev(`(()=>{const e=document.getElementById('save-location');e.value='C:/Users/Administrator/AppData/Local/Temp/opencode';e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));document.getElementById('project-name').dispatchEvent(new Event('input',{bubbles:true}));})()`);
    await click('#btn-create-project');evidence.projectName=name;
  }
  if(!await ev(`/^UI-v5-/.test(document.getElementById('current-project-name').textContent)`))throw new Error('Refuse unknown project');
  await click('#tab-writing');await click('#btn-toggle-ai');await click('#ai-conversation-list-toggle');await click('#ai-list-new-conversation');
  for(const [w,h] of [[1024,670],[1440,900]]){
    await send('Emulation.clearDeviceMetricsOverride');win('Resize',w,h);await settle();const native=win('Inspect'),viewport=await ev('[innerWidth,innerHeight]');
    if(native.client[0]!==w||native.client[1]!==h||viewport[0]!==w||viewport[1]!==h)throw new Error('Native mismatch');
    const input='#ai-dock [data-role="direct-question-input"]';await ev(`(()=>{const e=document.querySelector(${JSON.stringify(input)});e.value='';e.dispatchEvent(new Event('input',{bubbles:true}));})()`);await settle();
    const disabled=await mark();await shot('disabled-'+w+'x'+h);
    await click(input);await send('Input.insertText',{text:'UI 显示验证草稿，保留不发送'});await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Tab',code:'Tab',windowsVirtualKeyCode:9});await send('Input.dispatchKeyEvent',{type:'keyUp',key:'Tab',code:'Tab',windowsVirtualKeyCode:9});await settle();
    const enabled=await mark();await shot('enabled-focus-'+w+'x'+h);
    if(disabled.name!=='提问'||!disabled.disabled||disabled.background!=='rgb(228, 228, 228)'||enabled.disabled||enabled.button[0]!==72||enabled.button[1]!==32||Math.abs(parseFloat(enabled.image.height)-28*789/988)>.05||!enabled.focusVisible||enabled.outline[1]!=='2px')throw new Error('Send mark presentation mismatch');
    evidence.stages.push({size:[w,h],native,viewport,disabled,enabled,projection:await ev(`document.querySelectorAll('#ai-dock-body>.ai-window').length`)});
  }
}catch(e){evidence.errors.push(e.message);process.exitCode=1;}
finally{await send('Emulation.clearDeviceMetricsOverride').catch(()=>{});writeFileSync(join(out,'evidence.json'),JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence,null,2));ws.close();}
