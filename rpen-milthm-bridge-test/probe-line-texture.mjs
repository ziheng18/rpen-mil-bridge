// Live probe (RPEN 0.14.0): judgement-line textures on Milthm charts.
//   - the lane lock must keep a custom `line.Texture` on a track line (v0.7.20);
//   - the patched preview.drawLine must paint that image natively (checked on a scratch canvas
//     through the real runtime + patched method, independent of fullscreen preview timing);
//   - export JSON must turn it into a Milthm picture storyboard (type 0, data = texture name)
//     while the line still exports as a track with its notes;
//   - export ZIP must ship the image under res/.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const CDP = 9333;
const PAGE = 'http://127.0.0.1:4173/';
const WORK = 'E:\\File\\deepseek harness\\mil';
const MOD = path.join(WORK, 'rpen-milthm-bridge', 'milthm-fmt2-bridge.rpenmod');
const CHART_ZIP = fs.readdirSync(WORK).filter(name => /^Class.Memories\.zip$/i.test(name)).map(name => path.join(WORK, name))[0];
const OUT = path.join(WORK, 'rpen-milthm-bridge-test', 'line-texture');
const DOWNLOADS = path.join(OUT, 'downloads');
const TEXTURE = 'probe-line.png';

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(DOWNLOADS, { recursive: true });

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
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.subarray(offset + 46, offset + 46 + nameLength).toString('utf8');
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const raw = buffer.subarray(dataStart, dataStart + compressedSize);
    entries.set(name, method === 0 ? Buffer.from(raw) : zlib.inflateRawSync(raw));
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

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
const evaluate = async expression => { const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text); return r.result?.value; };
const waitFor = async (expression, timeout = 90000, label = 'wait') => { const start = Date.now(); while (Date.now() - start < timeout) { try { const value = await evaluate(expression); if (value) return value; } catch { } await sleep(300); } throw new Error('timeout: ' + label); };
const report = { steps: [], exceptions, downloads };
const step = (name, data) => { report.steps.push({ name, data }); console.log('STEP', name, JSON.stringify(data).slice(0, 1400)); };
const listFiles = extension => fs.readdirSync(DOWNLOADS).filter(name => name.toLowerCase().endsWith(extension));
const waitFile = async (extension, before, timeout = 60000) => {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const fresh = listFiles(extension).filter(name => !before.includes(name));
    if (fresh.length) {
      const file = path.join(DOWNLOADS, fresh[0]);
      const first = fs.statSync(file).size;
      await sleep(350);
      if (fs.statSync(file).size === first && first > 0) return file;
    }
    await sleep(250);
  }
  throw new Error('timeout waiting for ' + extension);
};

const result = { ok: false };
try {
  await waitFor(`(async () => { if (!window.rpenMods?.manager) return null; await window.rpenMods.manager.ready; return true; })()`);
  const modBase64 = fs.readFileSync(MOD).toString('base64');
  step('mod', await evaluate(`(async () => {
    const manager = window.rpenMods.manager;
    window.confirm = () => true; manager.review = async () => true;
    const bytes = Uint8Array.from(atob(${JSON.stringify(modBase64)}), c => c.charCodeAt(0));
    await manager.importFiles([new File([bytes], 'milthm-fmt2-bridge.rpenmod')]);
    await manager.enable('milthm-fmt2-bridge');
    await new Promise(resolve => setTimeout(resolve, 1000));
    return { loaded: manager.runtime.loaded.get('milthm-fmt2-bridge')?.status, version: manager.records.get('milthm-fmt2-bridge')?.manifest?.version };
  })()`));

  const doc = await send('DOM.getDocument', { depth: -1, pierce: true });
  const fileInput = await send('DOM.querySelector', { nodeId: doc.root.nodeId, selector: '#file-input' });
  await send('DOM.setFileInputFiles', { nodeId: fileInput.nodeId, files: [CHART_ZIP] });
  await waitFor(`(() => { const chart = window.rpenMods.editor?.chart; return chart?.['x-milthm']?.columns && chart.judgeLineList?.length > 0 ? true : null; })()`, 120000, 'import');
  await evaluate(`(() => { window.rpenMods.editor.pause?.(); return true; })()`);

  // Commit the texture through the same route the native line panel uses (the panel commits the
  // chart, then asks the image loader to reload chart textures: `afterTexture`).
  step('commit', await evaluate(`(async () => {
    const editor = window.rpenMods.editor;
    const canvas = document.createElement('canvas'); canvas.width = 400; canvas.height = 400;
    const context = canvas.getContext('2d'); context.fillStyle = '#ff3b30'; context.fillRect(0, 0, 400, 400);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    const bytes = new Uint8Array(await blob.arrayBuffer());
    editor.addAsset(${JSON.stringify(TEXTURE)}, bytes);
    const chart = editor.chart;
    const lineIndex = chart.judgeLineList.findIndex(line => (line.notes ?? []).length > 0);
    const next = structuredClone(chart);
    next.judgeLineList[lineIndex].Texture = ${JSON.stringify(TEXTURE)};
    const noteCount = next.judgeLineList[lineIndex].notes.length;
    await editor.commit('probe: custom line texture', next);
    await editor.images.load(editor.chart, editor.assets, editor.chartName ?? '');
    await new Promise(resolve => setTimeout(resolve, 500));
    const after = editor.chart.judgeLineList[lineIndex];
    const descriptor = editor.images.describe(${JSON.stringify(TEXTURE)});
    return { lineIndex, noteCount, texture: after.Texture, kept: after.Texture === ${JSON.stringify(TEXTURE)},
      descriptor: descriptor ? { width: descriptor.naturalWidth ?? descriptor.width, height: descriptor.naturalHeight ?? descriptor.height } : null };
  })()`));

  // Exercise the patched preview.drawLine directly: compile the real scene on the preview instance,
  // then paint the line onto a scratch canvas with the culling-time texture override active.
  step('drawLine', await evaluate(`(async () => {
    const editor = window.rpenMods.editor;
    const preview = editor.realtimePreview ?? editor.preview;
    if (!preview) return { error: 'no preview instance' };
    preview.scene.compile(editor.chart, editor.tempo);
    const lineIndex = editor.chart.judgeLineList.findIndex(line => (line.notes ?? []).length > 0);
    const runtime = preview.scene.lines?.[lineIndex];
    if (!runtime) return { error: 'no line runtime', lines: preview.scene.lines?.length ?? 0 };
    const line = runtime.line;
    const images = preview.images;
    const originalDescribe = images.describe;
    const realTexture = line.Texture;
    // Warm the asynchronous texture decode (the live preview requests it on the first frame).
    images.texture(realTexture, globalThis.devicePixelRatio || 1);
    const record = images.describe(realTexture);
    if (record?.pending) await record.pending;
    for (let attempt = 0; attempt < 40 && !images.texture(realTexture, 1); attempt++) await new Promise(resolve => setTimeout(resolve, 50));
    preview.__milthmLineTextures = new Map([[line, realTexture]]);
    preview.__milthmLineDescribe = originalDescribe;
    preview.__milthmSeconds = 0;
    images.describe = () => ({ naturalWidth: 80, naturalHeight: 7200 });
    line.Texture = '__milthm_track__';
    const canvas = document.createElement('canvas'); canvas.width = 900; canvas.height = 900;
    const context = canvas.getContext('2d');
    context.fillStyle = '#000'; context.fillRect(0, 0, 900, 900);
    const state = { x: 0, y: 0, rotation: 0, alpha: 255, color: [255, 255, 255], scaleX: 1, scaleY: 1, text: '' };
    let error = null;
    try { preview.drawLine(context, line, state, 1); } catch (thrown) { error = String(thrown?.stack ?? thrown); }
    images.describe = originalDescribe;
    line.Texture = realTexture;
    preview.__milthmLineTextures = null;
    preview.__milthmLineDescribe = undefined;
    const data = context.getImageData(0, 0, 900, 900).data;
    let red = 0;
    for (let index = 0; index < data.length; index += 4) if (data[index] > 180 && data[index + 1] < 100 && data[index + 2] < 100) red += 1;
    const previewKind = preview === editor.realtimePreview ? 'realtimePreview' : 'preview';
    return { previewKind, lineIndex, texture: realTexture, error, redPixels: red };
  })()`));

  // Preview smoke: open the fullscreen preview and screenshot it for the evidence folder.
  await evaluate(`(() => { window.rpenMods.editor.setPreview(true); return true; })()`);
  await sleep(1500);
  step('preview', await evaluate(`(() => {
    const preview = window.rpenMods.editor.preview;
    const canvas = preview?.canvas;
    return { visible: Boolean(preview?.visible), width: canvas?.width ?? 0, height: canvas?.height ?? 0 };
  })()`));
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(OUT, 'preview.png'), Buffer.from(shot.data, 'base64'));

  // Export JSON through the mod command and inspect the downloaded chart.
  const jsonBefore = listFiles('.json');
  const exportJson = await evaluate(`(async () => {
    const command = window.rpenMods.manager.runtime.commands.get('milthm-fmt2-bridge:export-json');
    return await command.run();
  })()`);
  const jsonFile = await waitFile('.json', jsonBefore);
  const exported = JSON.parse(fs.readFileSync(jsonFile, 'utf8'));
  const picture = (exported.storyboards ?? []).filter(storyboard => Number(storyboard.type) === 0 && String(storyboard.data ?? '') === TEXTURE);
  const commitStep = report.steps.find(item => item.name === 'commit')?.data ?? {};
  const exportedTrack = (exported.lines ?? []).find(line => (line.notes ?? []).length === Number(commitStep.noteCount ?? -1));
  step('export-json', {
    file: path.basename(jsonFile),
    warnings: exportJson?.warnings?.filter(warning => warning.includes('故事板') || warning.includes('轨道导出')),
    pictureStoryboards: picture.length,
    pictureAnimations: picture[0]?.animations?.length ?? 0,
    trackStillExported: Boolean(exportedTrack),
    storyboardTotal: (exported.storyboards ?? []).length,
  });

  // Export ZIP and confirm the texture is shipped under res/.
  const zipBefore = listFiles('.zip');
  const exportZip = await evaluate(`(async () => {
    const command = window.rpenMods.manager.runtime.commands.get('milthm-fmt2-bridge:export-zip');
    return await command.run();
  })()`);
  const zipFile = await waitFile('.zip', zipBefore);
  const archive = readZip(fs.readFileSync(zipFile));
  const textureEntry = archive.get('res/' + TEXTURE);
  step('export-zip', {
    file: path.basename(zipFile),
    entries: [...archive.keys()].length,
    textureInRes: Boolean(textureEntry),
    textureIsPng: Boolean(textureEntry) && textureEntry[0] === 0x89 && textureEntry[1] === 0x50,
    warnings: exportZip?.warnings?.filter(warning => warning.includes('缺少')),
  });

  const drawStep = report.steps.find(item => item.name === 'drawLine')?.data ?? {};
  const jsonStep = report.steps.find(item => item.name === 'export-json')?.data ?? {};
  const zipStep = report.steps.find(item => item.name === 'export-zip')?.data ?? {};
  result.textureKept = Boolean(commitStep.kept);
  result.descriptor = commitStep.descriptor ?? null;
  result.drawLineError = drawStep.error ?? null;
  result.drawLineRedPixels = Number(drawStep.redPixels ?? 0);
  result.pictureStoryboards = Number(jsonStep.pictureStoryboards ?? 0);
  result.trackStillExported = Boolean(jsonStep.trackStillExported);
  result.textureInRes = Boolean(zipStep.textureInRes);
  result.textureIsPng = Boolean(zipStep.textureIsPng);
  result.ok = result.textureKept && Boolean(result.descriptor) && !result.drawLineError && result.drawLineRedPixels > 0
    && result.pictureStoryboards === 1 && result.trackStillExported
    && result.textureInRes && result.textureIsPng && exceptions.length === 0;
  result.steps = report.steps;
} catch (error) {
  console.log('FAILED', String(error?.stack ?? error));
  result.error = String(error?.stack ?? error);
} finally {
  try { await evaluate(`(() => { window.rpenMods.editor.setPreview(false); return true; })()`); } catch { }
  report.result = result;
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
  console.log('RESULT', JSON.stringify({ ok: result.ok, exceptions: exceptions.length, result: { ...result, steps: undefined } }, null, 1));
  try { await send('Page.close'); } catch { }
  ws.close();
}
if (!result.ok) process.exitCode = 1;
