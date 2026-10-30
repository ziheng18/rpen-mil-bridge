// Open a fresh RPEN page, import the Class Memories zip and inspect resource binding.
import fs from 'node:fs';
import path from 'node:path';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const WORK = 'E:\\File\\deepseek harness\\mil';
const CHART_FILE = fs.readdirSync(WORK).filter(name => /^Class.Memories\.zip$/i.test(name)).map(name => path.join(WORK, name))[0];
async function fetchJson(url, options) { const response = await fetch(url, options); return JSON.parse(await response.text()); }
const target = await fetchJson(`http://127.0.0.1:9333/json/new?${encodeURIComponent('http://127.0.0.1:4173/')}`, { method: 'PUT' });
const ws = new WebSocket(target.webSocketDebuggerUrl);
const pending = new Map(); let id = 0;
function send(method, params = {}) { return new Promise((resolve, reject) => { const messageId = ++id; pending.set(messageId, { resolve, reject }); ws.send(JSON.stringify({ id: messageId, method, params })); }); }
ws.onmessage = event => { const message = JSON.parse(event.data); if (message.id && pending.has(message.id)) { const entry = pending.get(message.id); pending.delete(message.id); message.error ? entry.reject(new Error(JSON.stringify(message.error))) : entry.resolve(message.result); } };
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = () => reject(new Error('ws error')); });
await send('Runtime.enable'); await send('Page.enable'); await send('DOM.enable');
const evaluate = async (expression, awaitPromise = true) => {
  const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
  return result.result?.value;
};
const waitFor = async (expression, timeout = 30000) => {
  const start = Date.now();
  while (Date.now() - start < timeout) { try { const value = await evaluate(expression); if (value) return value; } catch { } await sleep(400); }
  return null;
};
await waitFor(`(async () => { if (!window.rpenMods?.manager) return null; await window.rpenMods.manager.ready; return true; })()`, 30000);
const mods = await evaluate(`({ enabled: [...(window.rpenMods.manager.runtime.loaded.keys())], records: [...window.rpenMods.manager.records.keys()] })`);
console.log('mods:', JSON.stringify(mods));
const doc = await send('DOM.getDocument', { depth: -1, pierce: true });
const input = await send('DOM.querySelector', { nodeId: doc.root.nodeId, selector: '#file-input' });
await send('DOM.setFileInputFiles', { nodeId: input.nodeId, files: [CHART_FILE] });
const state = await waitFor(`(() => {
  const editor = window.rpenMods.editor;
  if (!editor?.chart?.['x-milthm']) return null;
  const notes = editor.chart.judgeLineList.flatMap(line => line.notes ?? []);
  return { lines: editor.chart.judgeLineList.length, notes: notes.length, nonZeroX: notes.filter(note => note.positionX !== 0).length };
})()`, 60000);
console.log('imported:', JSON.stringify(state));
await sleep(3000);
const probe = await evaluate(`(async () => {
  const editor = window.rpenMods.editor;
  let files = null;
  try { files = await import(new URL('src/platform/files.mjs', location.href).href); } catch (error) { files = { error: String(error) }; }
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
    audioDuration: editor.audio?.buffer?.duration ?? null,
    dirty: editor.dirty,
    statusLine: [...document.querySelectorAll('*')].map(node => node.textContent || '').find(text => /缺少音乐|音乐：/.test(text))?.slice?.(0, 120) ?? null,
  };
})()`);
console.log(JSON.stringify(probe, null, 2).slice(0, 5000));
const shot = await send('Page.captureScreenshot', { format: 'png' });
fs.mkdirSync(path.join(WORK, 'rpen-milthm-bridge-test', 'integration'), { recursive: true });
fs.writeFileSync(path.join(WORK, 'rpen-milthm-bridge-test', 'integration', 'editor-probe.png'), Buffer.from(shot.data, 'base64'));
ws.close();
