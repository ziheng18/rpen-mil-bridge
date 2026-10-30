// Integration test v2: new Milthm features (channel dropdown/editor, ExNote, track preview,
// background-dim global events, dim storyboard migration).
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const CDP_PORT = 9333;
const PAGE = 'http://127.0.0.1:4173/';
const WORK = 'E:\\File\\deepseek harness\\mil';
const OUT = path.join(WORK, 'rpen-milthm-bridge-test', 'integration2');
const DL = path.join(OUT, 'downloads');
const MOD_FILE = path.join(WORK, 'rpen-milthm-bridge', 'milthm-fmt2-bridge.rpenmod');
const CHART_ZIP = fs.readdirSync(WORK).filter(name => /^Class.Memories\.zip$/i.test(name)).map(name => path.join(WORK, name))[0];
fs.mkdirSync(DL, { recursive: true });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const events = [];
async function fetchJson(url, options) { const response = await fetch(url, options); return JSON.parse(await response.text()); }

/* ---------------- zip helpers ---------------- */
function readZip(input) {
  const buffer = input.buffer ? input.buffer.slice(input.byteOffset, input.byteOffset + input.byteLength) : input;
  const view = new DataView(buffer), bytes = new Uint8Array(buffer);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= 0; i--) if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  const count = view.getUint16(eocd + 10, true);
  let offset = view.getUint32(eocd + 16, true);
  const entries = new Map();
  for (let n = 0; n < count; n++) {
    const method = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const size = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localOffset = view.getUint32(offset + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(offset + 46, offset + 46 + nameLength));
    offset += 46 + nameLength + extraLength + commentLength;
    const localNameLength = view.getUint16(localOffset + 26, true);
    const localExtraLength = view.getUint16(localOffset + 28, true);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    let data = bytes.slice(dataStart, dataStart + compressedSize);
    if (method === 8) data = new Uint8Array(zlib.inflateRawSync(data));
    entries.set(name, data.subarray(0, size));
  }
  return entries;
}
const CRC_TABLE = (() => { const table = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; table[n] = c >>> 0; } return table; })();
const crc32 = bytes => { let crc = 0xffffffff; for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8); return (crc ^ 0xffffffff) >>> 0; };
function writeZip(entries) {
  const encoder = new TextEncoder(), chunks = [], central = [];
  let offset = 0;
  for (const [name, data] of entries) {
    const nameBytes = encoder.encode(name), bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
    const local = new Uint8Array(30 + nameBytes.length), lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true); lv.setUint16(4, 20, true); lv.setUint16(6, 0x800, true);
    lv.setUint32(14, crc32(bytes), true); lv.setUint32(18, bytes.length, true); lv.setUint32(22, bytes.length, true);
    lv.setUint16(26, nameBytes.length, true); local.set(nameBytes, 30);
    const dir = new Uint8Array(46 + nameBytes.length), dv = new DataView(dir.buffer);
    dv.setUint32(0, 0x02014b50, true); dv.setUint16(4, 20, true); dir.set(local.subarray(4, 30), 6);
    dv.setUint32(42, offset, true); dir.set(nameBytes, 46);
    chunks.push(local, bytes); central.push(dir); offset += local.length + bytes.length;
  }
  const centralSize = central.reduce((sum, entry) => sum + entry.length, 0);
  const trailer = new Uint8Array(22), tv = new DataView(trailer.buffer);
  tv.setUint32(0, 0x06054b50, true); tv.setUint16(8, entries.size, true); tv.setUint16(10, entries.size, true);
  tv.setUint32(12, centralSize, true); tv.setUint32(16, offset, true);
  return Buffer.concat([...chunks, ...central, trailer].map(chunk => Buffer.from(chunk)));
}
function buildPng(width, height, rgb) {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    const row = y * (width * 3 + 1);
    for (let x = 0; x < width; x++) { raw[row + 1 + x * 3] = rgb[0]; raw[row + 2 + x * 3] = rgb[1]; raw[row + 3 + x * 3] = rgb[2]; }
  }
  const idat = zlib.deflateSync(raw);
  const chunk = (type, data) => {
    const length = Buffer.alloc(4); length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, crc]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

/* ---------------- CDP ---------------- */
const target = await fetchJson(`http://127.0.0.1:${CDP_PORT}/json/new?${encodeURIComponent(PAGE)}`, { method: 'PUT' });
const ws = new WebSocket(target.webSocketDebuggerUrl);
const pending = new Map(); let messageId = 0;
function send(method, params = {}) { return new Promise((resolve, reject) => { const id = ++messageId; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })); }); }
ws.onmessage = event => {
  let message; try { message = JSON.parse(event.data); } catch { return; }
  if (message.id && pending.has(message.id)) { const entry = pending.get(message.id); pending.delete(message.id); message.error ? entry.reject(new Error(JSON.stringify(message.error))) : entry.resolve(message.result); return; }
  const method = message.method, params = message.params;
  if (method === 'Runtime.exceptionThrown') { const details = params.exceptionDetails ?? {}; events.push({ kind: 'exception', text: (details.exception?.description ?? details.text ?? '').slice(0, 800) }); }
  else if (method === 'Log.entryAdded') { const entry = params.entry ?? {}; if (entry.level === 'error') events.push({ kind: 'log', text: (entry.text ?? '').slice(0, 500) }); }
  else if (method === 'Page.downloadWillBegin') events.push({ kind: 'download', suggested: params.suggestedFilename });
};
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = () => reject(new Error('ws error')); });
await send('Runtime.enable'); await send('Log.enable'); await send('Page.enable'); await send('DOM.enable');
await send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: DL });
const evaluate = async (expression, awaitPromise = true) => {
  const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
  return result.result?.value;
};
async function waitFor(expression, timeoutMs = 60000, label = 'condition') {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try { const value = await evaluate(expression); if (value) return value; } catch { /* wait */ }
    await sleep(400);
  }
  throw new Error(`timeout: ${label}`);
}
const report = { steps: [] };
const step = (name, data) => { report.steps.push({ name, data }); console.log('STEP', name, JSON.stringify(data).slice(0, 1000)); };

try {
  await waitFor(`(async () => { if (!window.rpenMods?.manager) return null; await window.rpenMods.manager.ready; return true; })()`, 60000, 'boot');
  const modBase64 = fs.readFileSync(MOD_FILE).toString('base64');
  const installed = await evaluate(`(async () => {
    const manager = window.rpenMods.manager;
    window.confirm = () => true;
    manager.review = async () => true;
    const bytes = Uint8Array.from(atob(${JSON.stringify(modBase64)}), c => c.charCodeAt(0));
    await manager.importFiles([new File([bytes], 'milthm-fmt2-bridge.rpenmod')]);
    await manager.enable('milthm-fmt2-bridge');
    await new Promise(resolve => setTimeout(resolve, 800));
    return { loaded: manager.runtime.loaded.get('milthm-fmt2-bridge')?.status, errors: [...manager.errors.entries()].map(([id, error]) => id + ': ' + String(error).slice(0, 300)) };
  })()`);
  step('mod', installed);

  const doc = await send('DOM.getDocument', { depth: -1, pierce: true });
  const input = await send('DOM.querySelector', { nodeId: doc.root.nodeId, selector: '#file-input' });
  await send('DOM.setFileInputFiles', { nodeId: input.nodeId, files: [CHART_ZIP] });
  const imported = await waitFor(`(() => {
    const chart = window.rpenMods.editor?.chart;
    if (!chart?.['x-milthm']) return null;
    const notes = chart.judgeLineList.flatMap(line => line.notes ?? []);
    return { lines: chart.judgeLineList.length, notes: notes.length, nonZeroX: notes.filter(note => note.positionX !== 0).length };
  })()`, 90000, 'import');
  step('import', imported);
  await waitFor(`(() => window.rpenMods.editor?.chart?.META?.song && window.rpenMods.editor?.chart?.META?.background)()`, 30000, 'media bind');
  await waitFor(`(() => window.rpenMods.editor?.audio?.buffer?.duration > 1)()`, 30000, 'audio');

  const ui = await evaluate(`(() => {
    const timelineSelect = document.querySelector('#milthm-timeline-select');
    const panel = document.querySelector('.milthm-panel');
    const typeSelect = panel?.querySelector('[data-m-role="type"]');
    return {
      timelineSelect: !!timelineSelect, timelineOptions: timelineSelect ? [...timelineSelect.options].map(option => option.value) : [],
      panel: !!panel, panelVisible: panel ? panel.style.display !== 'none' : false,
      panelOptions: typeSelect ? [...typeSelect.options].map(option => option.value) : [],
    };
  })()`);
  step('ui', ui);

  // channel editing: add a line-body-alpha keyframe on the current line
  const channelEdit = await evaluate(`(async () => {
    const editor = window.rpenMods.editor;
    const panel = document.querySelector('.milthm-panel');
    const typeSelect = panel.querySelector('[data-m-role="type"]');
    typeSelect.value = 'line-body-alpha';
    typeSelect.dispatchEvent(new Event('change'));
    await new Promise(resolve => setTimeout(resolve, 300));
    const before = editor.chart.judgeLineList[editor.session.lineIndex]['x-milthm']?.channels?.bodyAlpha?.length ?? 0;
    panel.querySelector('[data-m-action="add-event"]').click();
    await new Promise(resolve => setTimeout(resolve, 800));
    const after = editor.chart.judgeLineList[editor.session.lineIndex]['x-milthm']?.channels?.bodyAlpha?.length ?? 0;
    return { before, after, dirty: editor.dirty };
  })()`);
  step('channel add', channelEdit);

  // ExNote checkbox: select a note and toggle the new field
  await evaluate(`(() => { const editor = window.rpenMods.editor; editor.selectLine(1); editor.session.selection = new Set([0]); editor.session.focus = 'notes'; editor.invalidate?.(); return true; })()`);
  const exField = await waitFor(`(() => {
    const field = document.querySelector('[data-milthm-field="exnote"]');
    if (!field) return null;
    const select = field.querySelector('select');
    select.value = '1';
    select.dispatchEvent(new Event('change'));
    return { found: true, value: select.value };
  })()`, 15000, 'exnote field');
  await sleep(800);
  const exState = await evaluate(`(() => {
    const editor = window.rpenMods.editor;
    const note = editor.chart.judgeLineList[editor.session.lineIndex].notes[0];
    return { isAlwaysPerfect: note['x-milthm']?.isAlwaysPerfect ?? null };
  })()`);
  step('exnote', { ...exField, ...exState });

  // background dim global event + preview
  const dimAdd = await evaluate(`(async () => {
    window.rpenMods.editor.session.selection = new Set();
    await window.rpenMods.apiVersion;
    const api = window.rpenMods;
    // use the same public pathway the mod uses (registered type is available on the host registry)
    const host = api.manager;
    const editor = api.editor;
    const event = { startTime: [0, 0, 1], endTime: [4, 0, 1], start: 0, end: 1, easingType: 1, easingLeft: 0, easingRight: 1, bezier: 0, bezierPoints: [0, 0, 1, 1], inst: 0 };
    // find API through the loaded mod instance is not exposed; write the chart field + commit instead
    const next = structuredClone(editor.chart);
    next.globalEvents = { version: 1, types: { ...(next.globalEvents?.types ?? {}), 'milthm-fmt2-bridge/background-dim': {
      name: 'Milthm 背景明暗',
      source: { kind: 'mod', id: 'milthm-fmt2-bridge', name: 'Milthm fmt=2 Bridge', author: 'prototype', version: '0.1.0' },
      columns: { dim: { name: '明暗', valueType: 'number', events: [event] } },
    } } };
    editor.commit('测试：添加背景明暗全局事件', next);
    await new Promise(resolve => setTimeout(resolve, 600));
    editor.seek(1.2, { pause: true });
    await new Promise(resolve => setTimeout(resolve, 600));
    return { events: editor.chart.globalEvents?.types?.['milthm-fmt2-bridge/background-dim']?.columns?.dim?.events?.length ?? 0, dirty: editor.dirty };
  })()`);
  step('dim global', dimAdd);
  const shotDim = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(OUT, 'preview-dim.png'), Buffer.from(shotDim.data, 'base64'));

  // screenshot with notes visible (track preview)
  await evaluate(`(async () => { const editor = window.rpenMods.editor; editor.seek(8, { pause: true }); editor.setPreview?.(true, { stay: true }); await new Promise(resolve => setTimeout(resolve, 900)); return true; })()`);
  const shotTracks = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(OUT, 'preview-tracks.png'), Buffer.from(shotTracks.data, 'base64'));

  // export zip with dim storyboard
  const exportResult = await evaluate(`(async () => {
    const command = window.rpenMods.manager.runtime.commands.get('milthm-fmt2-bridge:export-zip');
    const result = await command.run();
    return result;
  })()`);
  await sleep(4000);
  step('export', exportResult);
  const downloads = fs.readdirSync(DL).map(name => ({ name, size: fs.statSync(path.join(DL, name)).size }));
  step('downloads', downloads);
  const exportedZip = downloads.filter(file => file.name.toLowerCase().endsWith('.zip')).map(file => path.join(DL, file.name)).at(-1);
  const exportedEntries = readZip(fs.readFileSync(exportedZip));
  const exportedChart = JSON.parse(new TextDecoder().decode(exportedEntries.get('chart.json')));
  step('exported zip', {
    entries: [...exportedEntries.keys()],
    storyboards: exportedChart.storyboards.map(storyboard => ({ index: storyboard.index, type: storyboard.type, layer: storyboard.layer, data: storyboard.data, animations: storyboard.animations.length })),
    blackPng: exportedEntries.has('res/black.png') ? exportedEntries.get('res/black.png').length : 0,
    exNoteFlags: exportedChart.lines.flatMap(line => line.notes).filter(note => note.isAlwaysPerfect).length,
  });

  // migration test: import the exported package again; the black storyboard must become a global dim event
  const secondDoc = await send('DOM.getDocument', { depth: -1, pierce: true });
  const secondInput = await send('DOM.querySelector', { nodeId: secondDoc.root.nodeId, selector: '#file-input' });
  await send('DOM.setFileInputFiles', { nodeId: secondInput.nodeId, files: [exportedZip] });
  const migrated = await waitFor(`(() => {
    const chart = window.rpenMods.editor?.chart;
    if (!chart?.['x-milthm']) return null;
    const dims = chart.globalEvents?.types?.['milthm-fmt2-bridge/background-dim']?.columns?.dim?.events;
    const storyboards = chart['x-milthm'].storyboards ?? [];
    if (!dims?.length) return null;
    return { dimEvents: dims.length, storyboards: storyboards.length, storyboardData: storyboards.map(storyboard => storyboard.data) };
  })()`, 60000, 'dim migration');
  step('dim migration', migrated);
  const shotMigrated = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(OUT, 'after-migration.png'), Buffer.from(shotMigrated.data, 'base64'));
} catch (error) {
  step('FAILED', { message: String(error?.message ?? error) });
  report.error = String(error?.stack ?? error);
} finally {
  report.events = events.slice(0, 100);
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
  console.log('\n=== events ===', JSON.stringify(report.events.slice(0, 12)));
  try { await send('Page.close'); } catch { }
  ws.close();
  process.exitCode = report.error ? 1 : 0;
}

