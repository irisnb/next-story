// making-draft-shot.mjs — 只读：把草稿卡片滚动到可见并截图（不点保存、不输入）。
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { connect } from './cdp-client.mjs';
const here = dirname(fileURLToPath(import.meta.url));
const cdp = await connect(Number(process.argv[2] ?? 9225));
const ok = await cdp.evaluate(`(() => { const p=document.querySelector('.making-draft-panel'); if(!p) return false; p.scrollIntoView({block:'center'}); return true; })()`);
await cdp.pause(400);
const box = await cdp.evaluate(`(() => { const p=document.querySelector('.making-draft-panel'); if(!p) return null; const r=p.getBoundingClientRect(); return {x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height)}; })()`);
const file = join(here, 'evidence-making', 'making-draft-04-card-visible.png');
await cdp.screenshot(file);
console.log(JSON.stringify({ ok, box, file }, null, 2));
cdp.close();
