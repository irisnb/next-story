// 呈现 fixture：真实 WebView、长理由、用户式 CDP 点击；不发模型请求或授权接口。
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { connect } from './cdp-client.mjs';
const here=dirname(fileURLToPath(import.meta.url));
const c=await connect(9225);
const phase=process.argv[2] ?? 'after';
const ev={fixture:true,phase,measurements:[],assertions:[],screenshots:[]};
const check=(name,pass)=>ev.assertions.push({name,pass:!!pass});
try {
  if(await c.evaluate(`!document.querySelector('#welcome-page').classList.contains('hidden')`)) {
    if(!await c.evaluate(`document.querySelector('#recent-works-list').textContent.includes('acceptance-fix-ai')`)) throw Error('Isolated recent project required');
    await c.click('#recent-works-list button');await c.pause(600);
  }
  if(!await c.evaluate(`document.querySelector('#current-project-name').textContent==='CDP几何验收-隔离'`)) throw Error('Isolated project required');
  await c.click('#tab-writing');
  if(await c.evaluate(`document.querySelector('#ai-dock').classList.contains('hidden')`)) await c.click('#btn-toggle-ai');
  if(!await c.evaluate(`!!document.querySelector('.ai-window')`)) {
    if(await c.evaluate(`document.querySelector('.ai-conversation-list').classList.contains('hidden')`)) await c.click('#ai-conversation-list-toggle');
    await c.click('.ai-cl-row');await c.pause(300);
  }
  if(!await c.evaluate(`document.querySelector('.ai-conversation-list').classList.contains('hidden')`)) await c.click('#ai-conversation-list-toggle');
  if(!await c.evaluate(`!!document.querySelector('.ai-window')`)) throw Error('Open completed discussion required');
  await c.evaluate(`document.querySelector('#ai-dock-divider').focus()`);
  for(let i=0;i<30;i++){if(await c.evaluate(`document.querySelector('#ai-dock-divider').getAttribute('aria-valuenow')==='300'`))break;await c.key('ArrowRight','ArrowRight',39);}
  await c.evaluate(`(() => {
    const original=document.querySelector('[data-role="reading-request"]');
    if(!original.classList.contains('hidden')) throw Error('Real pending request present: do not replace');
    const card=original.cloneNode(true); original.replaceWith(card);
    window.__authLayout={card:original,clicks:[]};
    card.classList.remove('hidden');
    card.querySelector('[data-role="reading-request-title"]').textContent='AI 希望围绕这个问题补充阅读你的作品文档';
    card.querySelector('[data-role="reading-request-reason"]').textContent='【长理由呈现夹具，非真实待授权请求】'+('您要求读取另一篇文档的完整正文，但目前只有检索片段，需要补充阅读才能确认细节。\\n'.repeat(30));
    card.querySelector('[data-role="reading-request-notes"]').textContent='仅本讨论、只读、不修改文档；可随时关闭。'.repeat(20);
    for(const role of ['reading-allow','reading-deny']) card.querySelector('[data-role="'+role+'"]').addEventListener('click',e=>{e.stopImmediatePropagation();e.preventDefault();window.__authLayout.clicks.push(role);},true);
    const filler=document.createElement('div');filler.id='__authLayoutFiller';filler.textContent='长消息呈现夹具\\n'.repeat(300);filler.style.whiteSpace='pre-wrap';document.querySelector('[data-role="body"]').append(filler);
  })()`);
  for(const height of [670,540]) {
    await c.send('Emulation.setDeviceMetricsOverride',{width:1024,height,deviceScaleFactor:1,mobile:false});
    await c.pause(250);
    for(const pos of ['top','bottom']) {
      await c.evaluate(`(() => {const b=document.querySelector('[data-role="body"]');b.scrollTop=${pos==='top'?'0':'b.scrollHeight'};})()`);
      const m=await c.evaluate(`(() => {
        const card=document.querySelector('[data-role="reading-request"]'), body=document.querySelector('[data-role="body"]'), content=card.querySelector('.ai-reading-request-content');
        const R=e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height,bottom:r.bottom}};
        const buttons=['reading-allow','reading-deny'].map(role=>{const b=card.querySelector('[data-role="'+role+'"]'),r=b.getBoundingClientRect();return {role,rect:R(b),hit:document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)===b};});
        return {panelWidth:document.querySelector('#ai-dock').getBoundingClientRect().width,card:R(card),body:R(body),bodyScroll:body.scrollTop,buttons,
          window:R(document.querySelector('.ai-window')),title:R(card.querySelector('.ai-reading-request-title')),content:content?R(content):null,
          children:Array.from(document.querySelector('.ai-window').children).map(e=>({role:e.dataset.role,rect:R(e)})),
          contentScrollable:!!content && content.scrollHeight>content.clientHeight && content.clientHeight>=32,cardOverflow:getComputedStyle(card).overflowY};
      })()`);
      ev.measurements.push({height,pos,...m});
      check(height+' '+pos+' buttons hit',m.buttons.every(b=>b.hit));
      check(height+' '+pos+' message area retained',m.body.h>=60);
      check(height+' '+pos+' only content scrolls',m.contentScrollable && m.cardOverflow==='hidden');
      check(height+' '+pos+' title retained',m.title.y>=m.card.y && m.title.bottom<=m.card.bottom);
      check(height+' '+pos+' input inside window',m.children.find(x=>x.role==='input').rect.bottom<=m.window.bottom);
      const file=join(here,'evidence-reading-auth',`layout-${phase}-${height}-${pos}.png`);await c.screenshot(file);ev.screenshots.push(file);
    }
    const content=ev.measurements.at(-1).content;
    if(content) {
      await c.send('Input.dispatchMouseEvent',{type:'mouseWheel',x:content.x+content.w/2,y:content.y+content.h/2,deltaY:10000,deltaX:0});await c.pause(200);
      check(height+' reason scroll reaches boundary notes',await c.evaluate(`(() => {const e=document.querySelector('.ai-reading-request-content');return e.scrollTop>0 && e.scrollTop+e.clientHeight>=e.scrollHeight-2})()`));
      check(height+' buttons retained after reason scroll',await c.evaluate(`['reading-allow','reading-deny'].every(role=>{const b=document.querySelector('[data-role="'+role+'"]'),r=b.getBoundingClientRect();return document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)===b})`));
      const file=join(here,'evidence-reading-auth',`layout-${phase}-${height}-reason-bottom.png`);await c.screenshot(file);ev.screenshots.push(file);
      await c.evaluate(`document.querySelector('.ai-reading-request-content').scrollTop=0`);
    }
    for(const role of ['reading-allow','reading-deny']) {
      const hit=ev.measurements.at(-1).buttons.find(b=>b.role===role).hit;
      if(hit) await c.click('[data-role="'+role+'"]');
      check(height+' user click '+role,await c.evaluate(`window.__authLayout.clicks.includes('${role}')`));
    }
    await c.evaluate(`window.__authLayout.clicks=[]`);
  }
} catch(e){ev.error=String(e);}
finally {
  await c.evaluate(`(() => {const f=window.__authLayout;if(f){document.querySelector('[data-role="reading-request"]').replaceWith(f.card);document.querySelector('#__authLayoutFiller')?.remove();delete window.__authLayout;}})()`);
  await c.send('Emulation.clearDeviceMetricsOverride');
  ev.consoleErrors=c.consoleErrors;
  writeFileSync(join(here,'evidence-reading-auth',`layout-${phase}.json`),JSON.stringify(ev,null,2));
  console.log(JSON.stringify({phase,assertions:ev.assertions,error:ev.error,consoleErrors:ev.consoleErrors},null,2));c.close();
  if(ev.error||ev.assertions.some(a=>!a.pass))process.exitCode=1;
}
