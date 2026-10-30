// Live probe: Milthm-style judgement head in the preview (v0.6.7: bigger radius, thicker rim,
// pale inner disc + soft glow). Captures the preview and a zoomed crop as evidence.
// Requires RPEN on :4173 and headless Edge CDP on :9333.
import fs from 'node:fs';
import path from 'node:path';

const CDP = 9333;
const PAGE = 'http://127.0.0.1:4173/';
const WORK = 'E:\\File\\deepseek harness\\mil';
const OUT = path.join(WORK, 'rpen-milthm-bridge-test', 'head-preview');
const MOD = path.join(WORK, 'rpen-milthm-bridge', 'milthm-fmt2-bridge.rpenmod');
const CHART_ZIP = fs.readdirSync(WORK).filter(name => /^Class.Memories\.zip$/i.test(name)).map(name => path.join(WORK, name))[0];
fs.mkdirSync(OUT, { recursive: true });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const fetchJson = async (url, options) => JSON.parse(await (await fetch(url, options)).text());
const target = await fetchJson(`http://127.0.0.1:${CDP}/json/new?${encodeURIComponent(PAGE)}`, { method: 'PUT' });
const ws = new WebSocket(target.webSocketDebuggerUrl);
const pending = new Map(); let messageId = 0; const exceptions = [];
function send(method, params = {}) { return new Promise((resolve, reject) => { const id = ++messageId; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })); }); }
ws.onmessage = event => {
  const message = JSON.parse(event.data);
  if (message.id && pending.has(message.id)) { const entry = pending.get(message.id); pending.delete(message.id); message.error ? entry.reject(new Error(JSON.stringify(message.error))) : entry.resolve(message.result); return; }
  if (message.method === 'Runtime.exceptionThrown') exceptions.push((message.params.exceptionDetails?.exception?.description ?? message.params.exceptionDetails?.text ?? '').slice(0, 500));
};
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = () => reject(new Error('ws error')); });
await send('Runtime.enable'); await send('Log.enable'); await send('DOM.enable'); await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1200, height: 800, deviceScaleFactor: 1, mobile: false });
const evaluate = async expression => { const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text); return r.result?.value; };
const waitFor = async (expression, timeout = 90000, label = 'wait') => { const s = Date.now(); while (Date.now() - s < timeout) { try { const value = await evaluate(expression); if (value) return value; } catch { } await sleep(300); } throw new Error('timeout: ' + label); };
const shot = async (name, clip) => {
  const options = { format: 'png' };
  if (clip) options.clip = { ...clip, scale: clip.scale || 1 };
  const result = await send('Page.captureScreenshot', options);
  fs.writeFileSync(path.join(OUT, name), Buffer.from(result.data, 'base64'));
  console.log('saved', name);
};
const report = { steps: [], exceptions };
const step = (name, data) => { report.steps.push({ name, data }); console.log('STEP', name, JSON.stringify(data).slice(0, 900)); };

try {
  await waitFor(`(async () => { if (!window.rpenMods?.manager) return null; await window.rpenMods.manager.ready; return true; })()`);
  const modBase64 = fs.readFileSync(MOD).toString('base64');
  step('mod', await evaluate(`(async () => {
    const manager = window.rpenMods.manager;
    window.confirm = () => true; manager.review = async () => true;
    const bytes = Uint8Array.from(atob(${JSON.stringify(modBase64)}), c => c.charCodeAt(0));
    await manager.importFiles([new File([bytes], 'milthm-fmt2-bridge.rpenmod')]);
    await manager.enable('milthm-fmt2-bridge');
    await new Promise(resolve => setTimeout(resolve, 900));
    const record = manager.records.get('milthm-fmt2-bridge');
    const state = manager.runtime.loaded.get('milthm-fmt2-bridge');
    return { loaded: state?.status, version: record?.manifest?.version };
  })()`));
  const doc = await send('DOM.getDocument', { depth: -1, pierce: true });
  const input = await send('DOM.querySelector', { nodeId: doc.root.nodeId, selector: '#file-input' });
  await send('DOM.setFileInputFiles', { nodeId: input.nodeId, files: [CHART_ZIP] });
  await waitFor(`(() => { const chart = window.rpenMods.editor?.chart; return chart?.['x-milthm']?.columns && chart.judgeLineList?.length === 19 ? true : null; })()`, 90000, 'import');
  await waitFor(`(() => window.rpenMods.editor?.audio?.buffer?.duration > 1)()`, 30000, 'audio');
  await evaluate(`window.rpenMods.editor.setPreview(true)`);
  await waitFor(`(() => { const preview = window.rpenMods.editor.preview; return preview?.visible && preview.canvas.getBoundingClientRect().width > 100; })()`, 30000, 'preview');
  await evaluate(`window.rpenMods.editor.seek(2.4)`);
  await sleep(900);
  step('preview', await evaluate(`(() => {
    const preview = window.rpenMods.editor.preview;
    const rect = preview.canvas.getBoundingClientRect();
    const state = preview.scene.sample(2.4, 1.5)[1] ?? null;
    return { canvas: { width: Math.round(rect.width), height: Math.round(rect.height) }, viewScale: preview.viewScale, line1: state ? { scaleX: state.scaleX, alpha: state.alpha } : null };
  })()`));
  await shot('after.png');
  await shot('after-zoom.png', { x: 174, y: 550, width: 40, height: 52, scale: 12 });
  await shot('after-heads-row.png', { x: 160, y: 540, width: 520, height: 70, scale: 4 });

  const result = { version: report.steps.find(entry => entry.name === 'mod')?.data?.version,
    previewScale: report.steps.find(entry => entry.name === 'preview')?.data?.viewScale ?? null,
    exceptions: exceptions.length };
  result.ok = Boolean(result.version) && result.previewScale > 0 && result.exceptions === 0;
  report.result = result;
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
  console.log('RESULT', JSON.stringify(result));
  if (!result.ok) process.exitCode = 1;
} catch (error) {
  report.error = String(error?.stack ?? error);
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
  console.log('PROBE ERROR', report.error);
  process.exitCode = 1;
} finally {
  ws.close();
}
