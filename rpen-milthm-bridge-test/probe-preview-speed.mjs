// Live probe: preview fall speed follows Milthm's formula:
//   Speed(12) 积分 × 120 × FLOW_SPEED(1.66) × 线 FlowSpeed(5) × 音符 FlowSpeed(5) × (675/960)
// The bridge bakes Speed × 线FlowSpeed into the injected preview speed track and applies the
// note-level FlowSpeed per note; export is untouched. Uses a crafted 4-line fmt=2 chart:
//   line 0: Speed(12)=2 + FlowSpeed(5)=3, plain note
//   line 1: same tracks, note-level FlowSpeed(5)=2
//   line 2: only FlowSpeed(5)=3 (Speed defaults to 1)
//   line 3: only Speed(12)=2 (FlowSpeed defaults to 1)
// Requires RPEN on :4173 and headless Edge CDP on :9333.
import fs from 'node:fs';
import path from 'node:path';
const CDP = 9333;
const PAGE = 'http://127.0.0.1:4173/';
const WORK = 'E:\\File\\deepseek harness\\mil';
const OUT = path.join(WORK, 'rpen-milthm-bridge-test', 'preview-speed');
const MOD = path.join(WORK, 'rpen-milthm-bridge', 'milthm-fmt2-bridge.rpenmod');
const SPEED_SCALE = 1.1671875;
const FLOW_SPEED = 1.66;
fs.rmSync(OUT, { recursive: true, force: true }); fs.mkdirSync(OUT, { recursive: true });

// ---- store-only zip writer for the crafted chart fixture ----
const crcTable = (() => { const table = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; table[n] = c >>> 0; } return table; })();
const crc32 = bytes => { let crc = 0xffffffff; for (const byte of bytes) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8); return (crc ^ 0xffffffff) >>> 0; };
function makeZip(entries) {
  const encoder = new TextEncoder(); const chunks = []; const central = []; let offset = 0;
  for (const [name, data] of entries) {
    const nameBytes = encoder.encode(name); const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
    const crc = crc32(bytes);
    const local = new Uint8Array(30 + nameBytes.length); const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true); lv.setUint16(4, 20, true); lv.setUint16(6, 0x800, true);
    lv.setUint32(14, crc, true); lv.setUint32(18, bytes.length, true); lv.setUint32(22, bytes.length, true);
    lv.setUint16(26, nameBytes.length, true); local.set(nameBytes, 30);
    const dir = new Uint8Array(46 + nameBytes.length); const dv = new DataView(dir.buffer);
    dv.setUint32(0, 0x02014b50, true); dv.setUint32(4, 20, true); dir.set(local.subarray(4, 30), 6);
    dv.setUint32(42, offset, true); dir.set(nameBytes, 46);
    chunks.push(local, bytes); central.push(dir); offset += local.length + bytes.length;
  }
  const centralSize = central.reduce((sum, entry) => sum + entry.length, 0);
  const trailer = new Uint8Array(22); const tv = new DataView(trailer.buffer);
  tv.setUint32(0, 0x06054b50, true); tv.setUint16(8, entries.length, true); tv.setUint16(10, entries.length, true);
  tv.setUint32(12, centralSize, true); tv.setUint32(16, offset, true);
  return new Uint8Array([...chunks.flatMap(chunk => [...chunk]), ...central.flatMap(chunk => [...chunk]), ...trailer]);
}
const ease = { type: 0, press: 0, isValueExp: false, cusValueExp: '', clipLeft: 0, clipRight: 1 };
const longEvent = (type, value, bearerType = 0, bearer = 0) => ({ type, startTime: [0, 0, 1], endTime: [100, 0, 1], start: value, end: value, bearer_type: bearerType, bearer, ease });
const note = (index, extraAnimations = []) => ({ index, time: [0, 16, 1], endTime: [0, 16, 1], type: 0, isFake: false, isAlwaysPerfect: false, animations: extraAnimations });
const crafted = {
  fmt: 2,
  meta: { name: 'preview speed test', background_dim: 0.6, background_artist: '', music_artist: '', charter: '', difficulty_name: '', difficulty: 0, offset: 0 },
  bpms: [{ time: [0, 0, 1], bpm: 120 }],
  lines: [
    { index: 0, notes: [note(0)], animations: [longEvent(12, 2, 0, 0), longEvent(5, 3, 0, 0)] },
    { index: 1, notes: [note(0)], animations: [longEvent(12, 2, 0, 1), longEvent(5, 3, 0, 1), longEvent(5, 2, 1, 0)] },
    { index: 2, notes: [note(0)], animations: [longEvent(5, 3, 0, 2)] },
    { index: 3, notes: [note(0)], animations: [longEvent(12, 2, 0, 3)] },
    // line 4: only line Size(3)=2 -> note distance doubles (RPU noteFlowSpeed *= lineSize)
    { index: 4, notes: [note(0)], animations: [longEvent(3, 2, 0, 4)] },
    // line 5: no animations at all -> default Speed/FlowSpeed/Size = 1
    { index: 5, notes: [note(0)], animations: [] },
  ],
  storyboards: [],
};
const zipBytes = makeZip([
  ['chart.json', new TextEncoder().encode(JSON.stringify(crafted))],
  ['meta.json', new TextEncoder().encode(JSON.stringify({ chart_file: 'chart.json', audio_file: '', image_file: '' }))],
]);
const CHART_ZIP = path.join(OUT, 'preview-speed-test.zip');
fs.writeFileSync(CHART_ZIP, zipBytes);

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
const report = { steps: [], exceptions };
const step = (name, data) => { report.steps.push({ name, data }); console.log('STEP', name, JSON.stringify(data).slice(0, 1200)); };

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
  await waitFor(`(() => { const chart = window.rpenMods.editor?.chart; return chart?.['x-milthm']?.columns && chart.judgeLineList?.length === 6 ? true : null; })()`, 90000, 'import');
  await evaluate(`window.rpenMods.editor.setPreview(true)`);
  await waitFor(`(() => { const preview = window.rpenMods.editor.preview; return preview?.visible && preview.canvas.getBoundingClientRect().width > 100 && preview.scene?.lines?.length === 6; })()`, 30000, 'preview');
  await evaluate(`window.rpenMods.editor.seek(1)`);
  await sleep(900);
  const readPreview = () => evaluate(`(() => {
    const preview = window.rpenMods.editor.preview;
    const readLine = index => {
      const runtime = preview.scene.lines[index];
      const state = runtime.state(1);
      const entry = runtime.notes[0];
      const noteState = entry ? runtime.noteState(entry, state, 1) : null;
      return { floor1: runtime.floor(1), noteFloor: entry?.floor ?? null, noteY: noteState?.y ?? null, size: state.scaleX ?? null };
    };
    return [0, 1, 2, 3, 4, 5].map(readLine);
  })()`);
  const data = await readPreview();
  step('preview', data);
  const expectedFloor = [2 * 3 * SPEED_SCALE * 120, 2 * 3 * SPEED_SCALE * 120, 3 * SPEED_SCALE * 120, 2 * SPEED_SCALE * 120, SPEED_SCALE * 120, SPEED_SCALE * 120];
  const near = (value, expected) => Number.isFinite(value) && Math.abs(value - expected) <= Math.max(1e-6, Math.abs(expected) * 1e-9);

  // global FLOW_SPEED (renderer setting): same number = same falling speed; the bridge baked
  // 1.66 into speed-scale, so setting 2.0 must scale floor/note distance by 2.0/1.66.
  step('global-flow-speed', await evaluate(`(async () => {
    const manager = window.rpenMods.manager;
    const state = manager.runtime.loaded.get('milthm-fmt2-bridge');
    await state.api.settings.set('renderer-flow-speed', 2);
    await new Promise(resolve => setTimeout(resolve, 1200));
    return { value: state.api.settings.get('renderer-flow-speed') };
  })()`));
  const globalData = await readPreview();
  step('preview-global-2', globalData);
  await evaluate(`(async () => {
    const manager = window.rpenMods.manager;
    const state = manager.runtime.loaded.get('milthm-fmt2-bridge');
    await state.api.settings.set('renderer-flow-speed', 1.66);
    await new Promise(resolve => setTimeout(resolve, 900));
    return true;
  })()`);
  const ratio = (a, b) => (Number.isFinite(a) && Number.isFinite(b) && b !== 0 ? a / b : null);
  const result = {
    version: report.steps.find(entry => entry.name === 'mod')?.data?.version,
    floors: data.map(line => line.floor1),
    expectedFloors: expectedFloor,
    floorsMatchComposition: data.every((line, index) => near(line.floor1, expectedFloor[index])),
    noteY: data.map(line => line.noteY),
    noteFlowRatio: ratio(data[1].noteY, data[0].noteY),
    speedRatio: ratio(data[0].noteY, data[2].noteY),
    lineFlowRatio: ratio(data[0].noteY, data[3].noteY),
    lineSizeRatio: ratio(data[4].noteY, data[5].noteY),
    basicLineSize: data[4].size,
    globalFlowFloorRatio: ratio(globalData[5].floor1, data[5].floor1),
    globalFlowNoteRatio: ratio(globalData[5].noteY, data[5].noteY),
    exceptions: exceptions.length,
  };
  result.ok = Boolean(result.version) && result.floorsMatchComposition
    && near(result.noteFlowRatio, 2) && near(result.speedRatio, 2) && near(result.lineFlowRatio, 3)
    && near(result.lineSizeRatio, 2)
    && near(result.globalFlowFloorRatio, 2 / 1.66) && near(result.globalFlowNoteRatio, 2 / 1.66)
    && result.exceptions === 0;
  const screenshot = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(OUT, 'preview-speed.png'), Buffer.from(screenshot.data, 'base64'));
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
