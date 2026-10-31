// Live probe: importing a Milthm chart whose storyboards are text/picture types must turn them into
// editable RPEN special lines (extended.textEvents / custom line Texture) through the real import
// hook (milthm-fmt2-bridge converts them; the special layer keeps RPEN's native editing).
// Requires RPEN on :4173 and headless Edge CDP on :9333.
import fs from 'node:fs';
import path from 'node:path';

const CDP = 9333;
const PAGE = 'http://127.0.0.1:4173/';
const WORK = 'E:\\File\\deepseek harness\\mil';
const OUT = path.join(WORK, 'rpen-milthm-bridge-test', 'storyboard-import');
const MOD = path.join(WORK, 'rpen-milthm-bridge', 'milthm-fmt2-bridge.rpenmod');
fs.rmSync(OUT, { recursive: true, force: true }); fs.mkdirSync(OUT, { recursive: true });

const beat = beatValue => [beatValue, 0, 1];
const ease = { type: 0, press: 0, isValueExp: false, cusValueExp: '', clipLeft: 0, clipRight: 1 };
const animation = (sbIndex, type, startBeat, endBeat, start, end) => ({ startTime: beat(startBeat), endTime: beat(endBeat), type, start, end, bearer_type: 2, bearer: sbIndex, ease });
const white = ((255 << 24) | (255 << 16) | (255 << 8) | 255) >>> 0;
const fixture = {
  fmt: 2,
  meta: { background_dim: 0.6, name: 'Storyboard import test', background_artist: '', music_artist: '', charter: '', difficulty_name: 'Cloudburst', difficulty: 8, offset: 0 },
  bpms: [{ time: [0, 0, 1], bpm: 120 }],
  lines: [{
    index: 0,
    notes: [{ index: 0, time: beat(4), endTime: beat(4), type: 0, isFake: false, isAlwaysPerfect: false }],
    animations: [
      { type: 0, startTime: [0, 0, 1], endTime: [16, 0, 1], start: 0, end: 0, bearer_type: 0, bearer: 0, ease },
      { type: 5, startTime: [0, 0, 1], endTime: [16, 0, 1], start: 1, end: 1, bearer_type: 0, bearer: 0, ease },
    ],
  }],
  storyboards: [
    {
      index: 0, type: 1, layer: 0, data: 'HELLO',
      animations: [animation(0, 0, 4, 8, 100, 100), animation(0, 1, 4, 8, 200, 200), animation(0, 4, 4, 8, 30, 30),
        animation(0, 10, 4, 8, 1.5, 1.5), animation(0, 11, 4, 8, 1.5, 1.5), animation(0, 2, 4, 8, 1, 1), animation(0, 22, 4, 8, white, white)],
    },
    {
      index: 1, type: 0, layer: 2, data: 'res/tex.png',
      animations: [animation(1, 0, 4, 8, -200, -200), animation(1, 1, 4, 8, 120, 120), animation(1, 4, 4, 8, 0, 0),
        animation(1, 10, 4, 8, 2, 2), animation(1, 11, 4, 8, 2, 2)],
    },
    { index: 2, type: 2, layer: 1, data: 'mesh', animations: [] },
  ],
};
const fixturePath = path.join(OUT, 'storyboard-fixture.json');
fs.writeFileSync(fixturePath, JSON.stringify(fixture, null, 2), 'utf8');

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
  if (message.method === 'Runtime.exceptionThrown') exceptions.push((message.params.exceptionDetails?.exception?.description ?? message.params.exceptionDetails?.text ?? '').slice(0, 500));
};
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = () => reject(new Error('ws error')); });
await send('Runtime.enable'); await send('Log.enable'); await send('DOM.enable'); await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 900, deviceScaleFactor: 1, mobile: false });
const evaluate = async expression => { const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text); return r.result?.value; };
const waitFor = async (expression, timeout = 120000, label = 'wait') => { const s = Date.now(); while (Date.now() - s < timeout) { try { const value = await evaluate(expression); if (value) return value; } catch { } await sleep(300); } throw new Error('timeout: ' + label); };
const report = { steps: [], exceptions };
const step = (name, data) => { report.steps.push({ name, data }); console.log('STEP', name, JSON.stringify(data).slice(0, 1800)); };

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
    const record = manager.records.get('milthm-fmt2-bridge');
    return { loaded: manager.runtime.loaded.get('milthm-fmt2-bridge')?.status, version: record?.manifest?.version };
  })()`));

  const doc = await send('DOM.getDocument', { depth: -1, pierce: true });
  const input = await send('DOM.querySelector', { nodeId: doc.root.nodeId, selector: '#file-input' });
  await send('DOM.setFileInputFiles', { nodeId: input.nodeId, files: [fixturePath] });
  await waitFor(`(() => { const chart = window.rpenMods.editor?.chart; return chart?.['x-milthm']?.kind === 'milthm-fmt2' && chart.judgeLineList?.length === 3 ? true : null; })()`, 60000, 'chart import');

  const state = await evaluate(`(() => {
    const chart = window.rpenMods.editor.chart;
    const lines = chart.judgeLineList ?? [];
    return {
      lines: lines.map(line => ({
        name: line.Name, texture: line.Texture,
        kind: line['x-milthm']?.storyboardKind ?? null,
        layer: line['x-milthm']?.storyboardLayer ?? null,
        textEvents: (line.extended?.textEvents ?? []).map(event => ({ start: event.start, end: event.end, startTime: event.startTime })),
        moveX: (line.eventLayers?.[0]?.moveXEvents ?? []).map(event => event.start),
        scaleX: (line.extended?.scaleXEvents ?? []).map(event => event.start),
      })),
      stashedStoryboards: chart['x-milthm']?.storyboards?.length ?? 0,
      columns: chart['x-milthm']?.columns ?? null,
      lineCount: lines.length,
    };
  })()`);
  step('imported-lines', state);
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(OUT, 'storyboard-import.png'), Buffer.from(shot.data, 'base64'));

  const text = state.lines.find(line => line.kind === 'text');
  const picture = state.lines.find(line => line.kind === 'picture');
  const result = {
    version: report.steps.find(entry => entry.name === 'mod')?.data?.version,
    lineCount: state.lineCount,
    columns: state.columns,
    textLine: text ?? null,
    pictureLine: picture ?? null,
    stashedStoryboards: state.stashedStoryboards,
    importedOk: state.lineCount === 3 && Boolean(text) && Boolean(picture),
    textOk: Boolean(text && text.texture === 'line.png' && text.textEvents.length === 1 && text.textEvents[0].start === 'HELLO' && text.textEvents[0].end === 'HELLO'),
    pictureOk: Boolean(picture && picture.texture === 'tex.png' && picture.textEvents.length === 0 && picture.layer === 2),
    transformOk: Boolean(text && Math.abs(Number(text.moveX[0]) - 100 * 0.703125) < 1e-6 && Math.abs(Number(text.scaleX[0]) - 1.5 * (60.75 * 0.703125 / 52)) < 1e-6),
    leftoverStashed: state.stashedStoryboards === 1,
    columnsOk: JSON.stringify(state.columns ?? []) === JSON.stringify(['x', 'y', 'rotate', 'bodyAlpha', 'flowSpeed']),
    exceptions: exceptions.length,
  };
  result.ok = result.importedOk && result.textOk && result.pictureOk && result.transformOk && result.leftoverStashed
    && result.columnsOk && result.exceptions === 0;
  report.result = result;
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
  console.log('RESULT', JSON.stringify(result, null, 1));
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
