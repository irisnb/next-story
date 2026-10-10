import { connect } from './cdp-client.mjs';
const cdp = await connect(Number(process.argv[2] ?? 9225));
await cdp.evaluate(`document.querySelector('#tab-writing')?.click()`); await cdp.pause(200);
await cdp.evaluate(`document.querySelector('#tab-making')?.click()`); await cdp.pause(500);
for (let i = 0; i < 25; i++) { if (await cdp.evaluate(`document.querySelectorAll('#making-chain-list .making-chain-row').length > 0`)) break; await cdp.pause(200); }
await cdp.evaluate(`document.querySelector('#making-chain-list .making-chain-row[data-chain-id="chain-cdp-long-acceptance"]')?.click()`);
await cdp.pause(400);
const s = await cdp.evaluate(`(() => {
  const R = e => { if(!e) return null; const r=e.getBoundingClientRect(); const cs=getComputedStyle(e); return {x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height),display:cs.display,visibility:cs.visibility}; };
  const btn = id => document.getElementById(id);
  return {
    chainRows: document.querySelectorAll('#making-chain-list .making-chain-row').length,
    versionOptions: [...document.querySelectorAll('#making-version-select option')].map(o=>({v:o.value, t:o.textContent.trim()})),
    enableBtn: { rect: R(btn('making-enable-btn')), hidden: btn('making-enable-btn')?.hidden, text: btn('making-enable-btn')?.textContent.trim(), disabled: btn('making-enable-btn')?.disabled },
    deactivateBtn: { rect: R(btn('making-deactivate-btn')), text: btn('making-deactivate-btn')?.textContent.trim(), disabled: btn('making-deactivate-btn')?.disabled },
    deleteChainBtn: { text: btn('making-delete-chain-btn')?.textContent.trim() },
    usingText: document.querySelector('.making-version-using')?.textContent ?? null,
    inspectorState: document.querySelector('#making-inspector-state')?.textContent ?? null,
    cardRows: [...document.querySelectorAll('#making-card-list .making-card-row')].map(b=>({cardId:b.dataset.cardId, text:b.textContent.trim().slice(0,40)})),
    postureRows: document.querySelectorAll('#making-posture-card-list .making-card-row').length,
    cardCount: document.querySelector('#making-card-count')?.textContent ?? null,
  };
})()`);
console.log(JSON.stringify(s, null, 2));
cdp.close();
