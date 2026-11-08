// Regression: with the mod enabled a normal RPE chart must not be touched by the Milthm lane
// lock. Before the fix, session:before-commit ran normalizeLaneChart() on every chart, forcing
// note positionX=0 / above=1 / bpmfactor=1 and resetting custom line textures (which is why
// preview ignored a changed judgment-line texture).
import fs from 'node:fs';
import path from 'node:path';

const CDP = 9333;
const PAGE = 'http://127.0.0.1:4173/';
const WORK = 'E:\\File\\deepseek harness\\mil';
const MOD = path.join(WORK, 'rpen-milthm-bridge', 'milthm-fmt2-bridge.rpenmod');
const OUT = path.join(WORK, 'rpen-milthm-bridge-test', 'rpe-passthrough');

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const fetchJson = async (url, options) => JSON.parse(await (await fetch(url, options)).text());
const target = await fetchJson(`http://127.0.0.1:${CDP}/json/new?${encodeURIComponent(PAGE)}`, { method: 'PUT' });
const ws = new WebSocket(target.webSocketDebuggerUrl);
const pending = new Map(); let messageId = 0;
const exceptions = [];
function send(method, params = {}) { return new Promise((resolve, reject) => { const id = ++messageId; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })); }); }
ws.onmessage = event => {
  const message = JSON.parse(event.data);
  if (message.id && pending.has(message.id)) { const entry = pending.get(message.id); pending.delete(message.id); message.error ? entry.reject(new Error(JSON.stringify(message.error))) : entry.resolve(message.result); return; }
  if (message.method === 'Runtime.exceptionThrown') exceptions.push((message.params.exceptionDetails?.exception?.description ?? message.params.exceptionDetails?.text ?? '').slice(0, 400));
};
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = () => reject(new Error('ws error')); });
await send('Runtime.enable'); await send('Page.enable');
const evaluate = async expression => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
  return r.result?.value;
};
const waitFor = async (expression, timeout = 90000, label = 'wait') => {
  const start = Date.now();
  while (Date.now() - start < timeout) { try { const value = await evaluate(expression); if (value) return value; } catch { } await sleep(300); }
  throw new Error('timeout ' + label);
};

fs.mkdirSync(OUT, { recursive: true });
const report = { steps: [], exceptions };
const step = (name, data) => { report.steps.push({ name, data }); console.log('STEP', name, JSON.stringify(data).slice(0, 1400)); };
let ok = false;
try {
  await waitFor(`(async () => { if (!window.rpenMods?.manager) return null; await window.rpenMods.manager.ready; return true; })()`);
  const modBase64 = fs.readFileSync(MOD).toString('base64');
  step('mod', await evaluate(`(async () => {
    const manager = window.rpenMods.manager;
    window.confirm = () => true; manager.review = async () => true;
    if (manager.runtime.loaded.has('milthm-fmt2-bridge')) await manager.disable('milthm-fmt2-bridge');
    const bytes = Uint8Array.from(atob(${JSON.stringify(modBase64)}), c => c.charCodeAt(0));
    await manager.importFiles([new File([bytes], 'milthm-fmt2-bridge.rpenmod')]);
    await manager.enable('milthm-fmt2-bridge');
    await new Promise(resolve => setTimeout(resolve, 1500));
    return { loaded: manager.runtime.loaded.get('milthm-fmt2-bridge')?.status, version: manager.records.get('milthm-fmt2-bridge')?.manifest?.version };
  })()`));

  step('chart', await waitFor(`(() => {
    const editor = window.rpenMods.editor;
    const chart = editor?.chart;
    if (!chart?.judgeLineList?.length) return null;
    return { path: 'editor.chart', lines: chart.judgeLineList.length, milthm: Boolean(chart['x-milthm']), name: chart.META?.name ?? null };
  })()`, 60000, 'chart'));

  const result = await evaluate(`(async () => {
    const editor = window.rpenMods.editor;
    const chart = editor.chart;
    if (chart['x-milthm']) return { skipped: 'Milthm chart is open, expected a normal RPE chart' };
    // A red 32x32 texture, registered as a chart asset so the line can actually use it.
    const canvas = document.createElement('canvas'); canvas.width = 32; canvas.height = 32;
    const context = canvas.getContext('2d'); context.fillStyle = '#ff3b30'; context.fillRect(0, 0, 32, 32);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    editor.addAsset('probe-texture.png', new Uint8Array(await blob.arrayBuffer()));

    const next = structuredClone(chart);
    const line = next.judgeLineList[0];
    line.bpmfactor = 0.75;
    line.Texture = 'probe-texture.png';
    const beat = [0, 0, 1];
    const note = { type: 1, positionX: 123, above: -1, startTime: beat, endTime: beat, speed: 1, size: 1, alpha: 255, visibleTime: 999999, yOffset: 0 };
    line.notes = [...(line.notes ?? []), note];
    await editor.commit('probe: normal RPE chart edit', next);
    await new Promise(resolve => setTimeout(resolve, 500));
    const after = editor.chart.judgeLineList[0];
    const afterNote = (after.notes ?? []).find(item => Number(item.positionX) === 123) ?? (after.notes ?? []).at(-1) ?? {};
    return {
      before: { bpmfactor: chart.judgeLineList[0].bpmfactor, texture: chart.judgeLineList[0].Texture },
      after: { bpmfactor: after.bpmfactor, texture: after.Texture, positionX: afterNote.positionX, above: afterNote.above },
      kept: {
        bpmfactor: Number(after.bpmfactor) === 0.75,
        texture: after.Texture === 'probe-texture.png',
        positionX: Number(afterNote.positionX) === 123,
        above: Number(afterNote.above) === -1,
      },
    };
  })()`);
  step('commit', result);

  await evaluate(`(() => { window.rpenMods.editor.setPreview(true); return true; })()`);
  await sleep(1600);
  const preview = await evaluate(`(() => {
    const preview = window.rpenMods.editor.preview;
    const canvas = preview?.canvas;
    return { visible: Boolean(preview?.visible), width: canvas?.width ?? 0, height: canvas?.height ?? 0 };
  })()`);
  step('preview', preview);
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(OUT, 'preview.png'), Buffer.from(shot.data, 'base64'));
  await evaluate(`(() => { window.rpenMods.editor.setPreview(false); return true; })()`);

  ok = Boolean(result?.kept) && result.kept.bpmfactor && result.kept.texture && result.kept.positionX && result.kept.above;
} catch (error) {
  console.log('FAILED', String(error?.stack ?? error));
  report.error = String(error?.stack ?? error);
} finally {
  report.ok = ok;
  report.result = report.steps.find(item => item.name === 'commit')?.data ?? null;
  report.exceptions = exceptions;
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
  console.log('RESULT', JSON.stringify({ ok, exceptions: exceptions.length, result: report.result }, null, 1));
  try { await send('Page.close'); } catch { }
  ws.close();
}
if (!ok) process.exitCode = 1;
