import { writeFileSync } from 'node:fs';
const OUT = process.env.OUT ?? '/tmp/uranai-colmenu.png';
const list = await (await fetch('http://localhost:9222/json/list')).json();
const target = list.find((t) => t.type === 'page' && /uranai/.test(t.url)) ?? list.find((t) => t.type === 'page');
const ws = new WebSocket(target.webSocketDebuggerUrl.replace('localhost', '127.0.0.1'));
let id = 0; const pending = new Map();
const cmd = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); } });
await new Promise((r) => ws.addEventListener('open', r));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ev = (expr) => cmd('Runtime.evaluate', { expression: expr, returnByValue: true }).then((r) => r?.result?.value);
await cmd('Page.enable');
await cmd('Page.navigate', { url: 'https://dev.graph.tachiiri.com/uranai' });
await sleep(4500);
await ev(`(()=>{const el=[...document.querySelectorAll('.u-person-name')].find(e=>e.textContent.includes('伊藤駿'));if(el)el.click()})()`);
await sleep(3500);
// 出来事タブへ（既定でそこ）。列見出しボタンの一覧
console.log('col names:', await ev(`[...document.querySelectorAll('.u-report .u-col-name')].map(b=>b.textContent).join(' | ')`));
console.log('click col:', await ev(`(()=>{const b=document.querySelector('.u-report .u-col-name');if(b){b.click();return 'clicked '+b.textContent}return 'no-col'})()`));
await sleep(1000);
console.log('col popover:', await ev(`(()=>{const p=document.querySelector('.u-report th .u-db-pop, .u-report .u-col-th .u-db-pop');return p?[...p.querySelectorAll('.u-db-pop-item')].map(b=>b.textContent).join(' / '):'none'})()`));
const shot = await cmd('Page.captureScreenshot', { format: 'png' });
if (shot?.data) { writeFileSync(OUT, Buffer.from(shot.data, 'base64')); console.log('saved', OUT); }
process.exit(0);
