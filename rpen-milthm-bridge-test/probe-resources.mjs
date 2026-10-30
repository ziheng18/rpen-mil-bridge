// Probe resource inference state of the currently open RPEN page (headless Edge on 9333).
import fs from 'node:fs';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function fetchJson(url, options) { const response = await fetch(url, options); return JSON.parse(await response.text()); }
const targets = await fetchJson('http://127.0.0.1:9333/json/list');
const page = targets.find(target => target.type === 'page' && target.url.includes('127.0.0.1:4173'));
if (!page) { console.log('no RPEN page'); process.exit(1); }
const ws = new WebSocket(page.webSocketDebuggerUrl);
const pending = new Map(); let id = 0;
function send(method, params = {}) { return new Promise((resolve, reject) => { const messageId = ++id; pending.set(messageId, { resolve, reject }); ws.send(JSON.stringify({ id: messageId, method, params })); }); }
ws.onmessage = event => { const message = JSON.parse(event.data); if (message.id && pending.has(message.id)) { const entry = pending.get(message.id); pending.delete(message.id); message.error ? entry.reject(new Error(JSON.stringify(message.error))) : entry.resolve(message.result); } };
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = () => reject(new Error('ws error')); });
await send('Runtime.enable');
await sleep(500);
const result = await send('Runtime.evaluate', { returnByValue: true, awaitPromise: true, expression: `(async () => {
  const editor = window.rpenMods.editor;
  const files = await window.rpenMods.apiVersion ? await (async () => { try { return await import(new URL('src/platform/files.mjs', location.href).href); } catch { return null; } })() : null;
  const references = files?.resourceReferences ? files.resourceReferences(editor.chart, editor.assets, editor.chartName) : null;
  const images = editor.images;
  return {
    chartName: editor.chartName,
    meta: { song: editor.chart.META?.song ?? null, background: editor.chart.META?.background ?? null, offset: editor.chart.META?.offset },
    assetNames: [...(editor.assets ?? new Map()).keys()],
    references,
    imageRecords: [...(images?.records?.keys?.() ?? [])],
    backgroundName: images?.backgroundName ?? null,
    backgroundReady: !!images?.records?.get?.(images?.backgroundName)?.image,
    audio: { duration: editor.audio?.buffer?.duration ?? null, playbackBuffer: !!editor.audio?.playbackBuffer },
    dirty: editor.dirty,
  };
})()` });
console.log(JSON.stringify(result.result?.value ?? result, null, 2).slice(0, 4000));
ws.close();
