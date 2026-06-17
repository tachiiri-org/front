import WebSocket from 'ws';
import * as fs from 'fs';
import './load-dev-vars.ts';

const CDP_PORT = 9222;
const BASE_URL = (process.env.BASE_URL ?? 'https://front-dev.tachiiri.workers.dev');
const targetUrl = process.argv[2] ?? BASE_URL + '/graph-editor';
const outPath = process.argv[3] ?? '/tmp/graph-editor-screenshot.png';
const clickFirst = process.argv[4] === 'click';

async function cdpRequest(ws: WebSocket, method: string, params: Record<string, unknown> = {}): Promise<unknown> {
  return new Promise((resolve) => {
    const id = Date.now() + Math.floor(Math.random() * 10000);
    const handler = (data: WebSocket.RawData) => {
      const msg = JSON.parse(data.toString());
      if (msg.id === id) { ws.off('message', handler); resolve(msg.result); }
    };
    ws.on('message', handler);
    ws.send(JSON.stringify({ id, method, params }));
  });
}

const versionsRes = await fetch(`http://localhost:${CDP_PORT}/json`);
const targets = await versionsRes.json() as Array<{ webSocketDebuggerUrl: string; type: string }>;
const page = targets.find((t) => t.type === 'page');
if (!page) throw new Error('no page target');

const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => ws.once('open', r));

await cdpRequest(ws, 'Page.navigate', { url: targetUrl });
await new Promise((r) => setTimeout(r, 4000));

if (clickFirst) {
  await cdpRequest(ws, 'Runtime.evaluate', {
    expression: `
      (() => {
        const textareas = document.querySelectorAll('[data-col-index="0"] textarea[data-node-id]');
        if (textareas.length > 0) { textareas[0].focus(); return 'focused: ' + textareas[0].dataset.nodeId; }
        return 'none';
      })()
    `,
    awaitPromise: false,
  });
  await new Promise((r) => setTimeout(r, 2500));
}

const screenshot = await cdpRequest(ws, 'Page.captureScreenshot', { format: 'png' }) as { data: string };
fs.writeFileSync(outPath, Buffer.from(screenshot.data, 'base64'));
ws.close();
console.log('saved:', outPath);
