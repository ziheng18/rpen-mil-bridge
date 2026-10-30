// Live probe: RPEN special lines -> Milthm storyboards.
//   - a line with `extended.textEvents` (RPEN text line) -> Milthm text storyboards (type 1)
//   - a line with a custom `Texture` (RPEN judgement-line image) -> Milthm picture storyboard (type 0)
// Both lines have no notes, so they are dropped from the exported `lines`; their transform/alpha/
// colour tracks become storyboard animations. The zip must ship the texture under res/.
// Requires RPEN on :4173 and headless Edge CDP on :9333.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const CDP = 9333;
const PAGE = 'http://127.0.0.1:4173/';
const WORK = 'E:\\File\\deepseek harness\\mil';
const OUT = path.join(WORK, 'rpen-milthm-bridge-test', 'specials');
const MOD = path.join(WORK, 'rpen-milthm-bridge', 'milthm-fmt2-bridge.rpenmod');
fs.rmSync(OUT, { recursive: true, force: true }); fs.mkdirSync(OUT, { recursive: true });
const DOWNLOADS = path.join(OUT, 'downloads');
fs.mkdirSync(DOWNLOADS, { recursive: true });

// ---- zip helpers ----
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
  return Buffer.from([...chunks.flatMap(chunk => [...chunk]), ...central.flatMap(chunk => [...chunk]), ...trailer]);
}
function readZip(buffer) {
  let eocd = -1;
  for (let index = buffer.length - 22; index >= 0; index--) if (buffer.readUInt32LE(index) === 0x06054b50) { eocd = index; break; }
  if (eocd < 0) throw new Error('zip: EOCD not found');
  const count = buffer.readUInt16LE(eocd + 10);
  let offset = buffer.readUInt32LE(eocd + 16);
  const entries = new Map();
  for (let index = 0; index < count; index++) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) throw new Error('zip: bad central directory');
    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const uncompressedSize = buffer.readUInt32LE(offset + 24);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.subarray(offset + 46, offset + 46 + nameLength).toString('utf8');
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const raw = buffer.subarray(dataStart, dataStart + compressedSize);
    const data = method === 0 ? Buffer.from(raw) : zlib.inflateRawSync(raw);
    if (data.length !== uncompressedSize) throw new Error(`zip: size mismatch for ${name}`);
    entries.set(name, data);
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}
function makePng(width, height, [r, g, b]) {
  const rowLength = width * 4 + 1;
  const raw = Buffer.alloc(rowLength * height);
  for (let y = 0; y < height; y++) {
    raw[y * rowLength] = 0;
    for (let x = 0; x < width; x++) {
      const offset = y * rowLength + 1 + x * 4;
      raw[offset] = r; raw[offset + 1] = g; raw[offset + 2] = b; raw[offset + 3] = 255;
    }
  }
  const chunk = (type, data) => {
    const length = Buffer.alloc(4); length.writeUInt32BE(data.length);
    const typeBytes = Buffer.from(type, 'ascii');
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])));
    return Buffer.concat([length, typeBytes, data, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

// ---- crafted Milthm chart with one normal track + two decoration lines ----
const ease = { type: 0, press: 0, isValueExp: false, cusValueExp: '', clipLeft: 0, clipRight: 1 };
const anim = (type, value, bearer, lineIndex) => ({ type, startTime: [0, 0, 1], endTime: [100, 0, 1], start: value, end: value, bearer_type: bearer, bearer: lineIndex, ease });
const colorValue = ((10 << 24) | (20 << 16) | (30 << 8) | 255) >>> 0;
const crafted = {
  fmt: 2,
  meta: { name: 'specials test', background_dim: 0.6, background_artist: '', music_artist: '', charter: '', difficulty_name: '', difficulty: 0, offset: 0 },
  bpms: [{ time: [0, 0, 1], bpm: 120 }],
  lines: [
    { index: 0, notes: [{ index: 0, time: [0, 4, 1], endTime: [0, 4, 1], type: 0, isFake: false, isAlwaysPerfect: false }], animations: [] },
    { index: 1, notes: [], animations: [anim(0, 100, 0, 1), anim(4, 60, 0, 1), anim(2, 0.5, 0, 1)] },
    { index: 2, notes: [], animations: [anim(0, 200, 0, 2), anim(4, 120, 0, 2), anim(22, colorValue, 0, 2)] },
  ],
  storyboards: [],
};
const texturePng = makePng(64, 64, [255, 32, 32]);
const fixtureZip = makeZip([
  ['chart.json', Buffer.from(JSON.stringify(crafted))],
  ['meta.json', Buffer.from(JSON.stringify({ chart_file: 'chart.json', audio_file: '', image_file: '' }))],
  ['res/texture.png', texturePng],
]);
const FIXTURE = path.join(OUT, 'specials-test.zip');
fs.writeFileSync(FIXTURE, fixtureZip);

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const fetchJson = async (url, options) => JSON.parse(await (await fetch(url, options)).text());
const target = await fetchJson(`http://127.0.0.1:${CDP}/json/new?${encodeURIComponent(PAGE)}`, { method: 'PUT' });
const ws = new WebSocket(target.webSocketDebuggerUrl);
const pending = new Map(); let messageId = 0; const exceptions = []; const downloads = [];
function send(method, params = {}) { return new Promise((resolve, reject) => { const id = ++messageId; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })); }); }
ws.onmessage = event => {
  const message = JSON.parse(event.data);
  if (message.id && pending.has(message.id)) { const entry = pending.get(message.id); pending.delete(message.id); message.error ? entry.reject(new Error(JSON.stringify(message.error))) : entry.resolve(message.result); return; }
  if (message.method === 'Runtime.exceptionThrown') exceptions.push((message.params.exceptionDetails?.exception?.description ?? message.params.exceptionDetails?.text ?? '').slice(0, 500));
  if (message.method === 'Page.downloadWillBegin') downloads.push(message.params.suggestedFilename);
};
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = () => reject(new Error('ws error')); });
await send('Runtime.enable'); await send('Log.enable'); await send('DOM.enable'); await send('Page.enable');
await send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: DOWNLOADS });
await send('Emulation.setDeviceMetricsOverride', { width: 1200, height: 800, deviceScaleFactor: 1, mobile: false });
const evaluate = async expression => { const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text); return r.result?.value; };
const waitFor = async (expression, timeout = 90000, label = 'wait') => { const s = Date.now(); while (Date.now() - s < timeout) { try { const value = await evaluate(expression); if (value) return value; } catch { } await sleep(300); } throw new Error('timeout: ' + label); };
const report = { steps: [], exceptions, downloads };
const step = (name, data) => { report.steps.push({ name, data }); console.log('STEP', name, JSON.stringify(data).slice(0, 1400)); };
const near = (actual, expected, tolerance = 1e-6) => Number.isFinite(actual) && Math.abs(actual - expected) <= tolerance;
const beatOf = time => Number(time?.[0] ?? 0) + Number(time?.[1] ?? 0) / (Number(time?.[2]) || 1);

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
  await send('DOM.setFileInputFiles', { nodeId: input.nodeId, files: [FIXTURE] });
  await waitFor(`(() => { const chart = window.rpenMods.editor?.chart; return chart?.['x-milthm']?.columns && chart.judgeLineList?.length === 3 ? true : null; })()`, 90000, 'import');

  // turn line 1 into a text line and give line 2 the crafted judgement-line texture
  step('edit', await evaluate(`(() => {
    const editor = window.rpenMods.editor;
    const next = structuredClone(editor.chart);
    const textEvent = (startBeat, endBeat, value) => ({
      startTime: [startBeat, 0, 1], endTime: [endBeat, 0, 1], start: value, end: value,
      easingType: 1, easingLeft: 0, easingRight: 1, bezier: 0, bezierPoints: [0, 0, 1, 1], linkgroup: 0,
    });
    next.judgeLineList[1].extended = {
      ...(next.judgeLineList[1].extended ?? {}),
      textEvents: [textEvent(0, 4, 'HELLO'), textEvent(4, 8, '')],
    };
    next.judgeLineList[2].Texture = 'texture.png';
    editor.commit('probe specials', next);
    return { textures: next.judgeLineList.map(line => line.Texture), textEvents: next.judgeLineList[1].extended.textEvents.length };
  })()`));
  await evaluate(`window.rpenMods.editor.setPreview(true)`);
  await waitFor(`(() => { const preview = window.rpenMods.editor.preview; return preview?.visible && preview.canvas.getBoundingClientRect().width > 100 && preview.scene?.lines?.length === 3; })()`, 30000, 'preview');
  await evaluate(`window.rpenMods.editor.seek(1)`);
  await sleep(1200);
  step('preview', await evaluate(`(() => ({
    textures: window.rpenMods.editor.chart.judgeLineList.map(line => line.Texture),
    text: window.rpenMods.editor.preview.scene.lines[1].state(1).text,
  }))()`));
  const screenshot = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(OUT, 'preview-specials.png'), Buffer.from(screenshot.data, 'base64'));

  // export the Milthm package zip through the mod command, then inspect the downloaded archive
  step('export', await evaluate(`(async () => {
    const command = window.rpenMods.manager.runtime.commands.get('milthm-fmt2-bridge:export-zip');
    return await command.run();
  })()`));
  const zipName = await (async () => {
    const started = Date.now();
    while (Date.now() - started < 20000) {
      const files = fs.readdirSync(DOWNLOADS).filter(name => name.toLowerCase().endsWith('.zip'));
      if (files.length) return files.at(-1);
      await sleep(300);
    }
    throw new Error('zip download timeout');
  })();
  const archive = readZip(fs.readFileSync(path.join(DOWNLOADS, zipName)));
  const exported = JSON.parse(archive.get('chart.json').toString('utf8'));
  const textStoryboards = exported.storyboards.filter(storyboard => Number(storyboard.type) === 1);
  const pictureStoryboards = exported.storyboards.filter(storyboard => Number(storyboard.type) === 0);
  const text = textStoryboards[0];
  const picture = pictureStoryboards[0];
  const animsOf = (storyboard, type) => (storyboard?.animations ?? []).filter(animation => Number(animation.type) === type);
  const result = {
    version: report.steps.find(entry => entry.name === 'mod')?.data?.version,
    zipName,
    entries: [...archive.keys()],
    exportedLines: exported.lines.length,
    exportedLineIndexes: exported.lines.map(line => line.index),
    exportedLine0Notes: exported.lines[0]?.notes?.length ?? 0,
    textStoryboards: textStoryboards.length,
    textData: text?.data ?? null,
    textLayer: text?.layer ?? null,
    textBearersOk: (text?.animations ?? []).every(animation => Number(animation.bearer_type) === 2 && Number(animation.bearer) === Number(text.index)),
    textPositionX: animsOf(text, 0)[0]?.start ?? null,
    textRotation: animsOf(text, 4)[0]?.start ?? null,
    textWidth: animsOf(text, 10)[0]?.start ?? null,
    textTransparencyStarts: animsOf(text, 2).map(animation => ({ beat: beatOf(animation.startTime), start: animation.start })),
    pictureStoryboards: pictureStoryboards.length,
    pictureData: picture?.data ?? null,
    pictureBearersOk: (picture?.animations ?? []).every(animation => Number(animation.bearer_type) === 2 && Number(animation.bearer) === Number(picture.index)),
    picturePositionX: animsOf(picture, 0)[0]?.start ?? null,
    pictureRotation: animsOf(picture, 4)[0]?.start ?? null,
    pictureWidth: animsOf(picture, 10)[0]?.start ?? null,
    pictureColor: animsOf(picture, 22)[0]?.start ?? null,
    previewText: report.steps.find(entry => entry.name === 'preview')?.data?.text ?? null,
    textureInRes: archive.has('res/texture.png'),
    textureIsPng: archive.has('res/texture.png') && archive.get('res/texture.png')[0] === 0x89 && archive.get('res/texture.png')[1] === 0x50,
    warnings: (report.steps.find(entry => entry.name === 'export')?.data?.warnings ?? []).filter(warning => /文字|贴图|故事板/.test(warning)),
    exceptions: exceptions.length,
  };
  result.ok = Boolean(result.version) && result.exportedLines === 1
    && result.textStoryboards >= 1 && result.textData === 'HELLO' && result.textBearersOk
    && near(result.textPositionX, 100) && near(result.textRotation, 30) && near(result.textWidth, (52 / 0.703125) / 60.75)
    && result.textTransparencyStarts.some(event => near(event.start, 0.5) && event.beat === 0)
    && result.textTransparencyStarts.some(event => near(event.start, 0) && event.beat === 4)
    && result.pictureStoryboards === 1 && result.pictureData === 'texture.png' && result.pictureBearersOk
    && near(result.picturePositionX, 200) && near(result.pictureRotation, -30) && near(result.pictureWidth, 1 / 0.703125)
    && Number(result.pictureColor) >>> 0 === colorValue
    && result.previewText === 'HELLO'
    && result.textureInRes && result.textureIsPng && result.exceptions === 0;
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
