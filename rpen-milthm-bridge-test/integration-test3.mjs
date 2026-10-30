// Integration test v3: Milthm event-column dropdowns, panel removal, native export dialog.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const CDP = 9333;
const PAGE = 'http://127.0.0.1:4173/';
const WORK = 'E:\\File\\deepseek harness\\mil';
const OUT = path.join(WORK, 'rpen-milthm-bridge-test', 'integration3');
const DL = path.join(OUT, 'downloads');
const MOD = path.join(WORK, 'rpen-milthm-bridge', 'milthm-fmt2-bridge.rpenmod');
const CHART_ZIP = fs.readdirSync(WORK).filter(name => /^Class.Memories\.zip$/i.test(name)).map(name => path.join(WORK, name))[0];
fs.rmSync(OUT, { recursive: true, force: true }); fs.mkdirSync(DL, { recursive: true });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const events = [];
async function fetchJson(url, options) { const response = await fetch(url, options); return JSON.parse(await response.text()); }
const target = await fetchJson(`http://127.0.0.1:${CDP}/json/new?${encodeURIComponent(PAGE)}`, { method: 'PUT' });
const ws = new WebSocket(target.webSocketDebuggerUrl);
const pending = new Map(); let messageId = 0;
function send(method, params = {}) { return new Promise((resolve, reject) => { const id = ++messageId; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })); }); }
ws.onmessage = event => {
  const message = JSON.parse(event.data);
  if (message.id && pending.has(message.id)) { const entry = pending.get(message.id); pending.delete(message.id); message.error ? entry.reject(new Error(JSON.stringify(message.error))) : entry.resolve(message.result); return; }
  if (message.method === 'Runtime.exceptionThrown') events.push({ kind: 'exception', text: (message.params.exceptionDetails?.exception?.description ?? message.params.exceptionDetails?.text ?? '').slice(0, 600) });
  if (message.method === 'Page.downloadWillBegin') events.push({ kind: 'download', suggested: message.params.suggestedFilename });
};
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = () => reject(new Error('ws error')); });
await send('Runtime.enable'); await send('Log.enable'); await send('Page.enable'); await send('DOM.enable');
await send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: DL });
await send('Emulation.setDeviceMetricsOverride', { width: 1500, height: 900, deviceScaleFactor: 1, mobile: false });
const evaluate = async (expression, awaitPromise = true) => { const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise }); if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text); return result.result?.value; };
const waitFor = async (expression, timeout = 60000, label = 'wait') => { const start = Date.now(); while (Date.now() - start < timeout) { try { const value = await evaluate(expression); if (value) return value; } catch { } await sleep(400); } throw new Error('timeout: ' + label); };
const report = { steps: [], events };
const step = (name, data) => { report.steps.push({ name, data }); console.log('STEP', name, JSON.stringify(data).slice(0, 1200)); };
const readZipChart = file => {
  const buffer = fs.readFileSync(file);
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  let eocd = -1;
  for (let i = buffer.length - 22; i >= 0; i--) if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  const count = view.getUint16(eocd + 10, true); let offset = view.getUint32(eocd + 16, true);
  for (let n = 0; n < count; n++) {
    const method = view.getUint16(offset + 10, true), compressed = view.getUint32(offset + 20, true);
    const nameLength = view.getUint16(offset + 28, true), extraLength = view.getUint16(offset + 30, true), commentLength = view.getUint16(offset + 32, true);
    const localOffset = view.getUint32(offset + 42, true);
    const name = new TextDecoder().decode(buffer.subarray(offset + 46, offset + 46 + nameLength));
    offset += 46 + nameLength + extraLength + commentLength;
    const localNameLength = view.getUint16(localOffset + 26, true), localExtraLength = view.getUint16(localOffset + 28, true);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    let data = buffer.subarray(dataStart, dataStart + compressed);
    if (method === 8) data = zlib.inflateRawSync(data);
    if (name === 'chart.json') return JSON.parse(data.toString('utf8'));
  }
  throw new Error('chart.json missing');
};
const canon = value => Array.isArray(value) ? value.map(canon) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canon(value[key])])) : value;
const sameJson = (a, b) => JSON.stringify(canon(a)) === JSON.stringify(canon(b));
const beatOf = time => Number(time[0]) + Number(time[1]) / Number(time[2]);
const original = readZipChart(CHART_ZIP);
const semanticDiffs = exported => {
  const diffs = [];
  const lines = [...original.lines].sort((a, b) => a.index - b.index);
  if (lines.length !== exported.lines.length) diffs.push('line count');
  for (let i = 0; i < Math.min(lines.length, exported.lines.length); i++) {
    const a = lines[i], b = exported.lines[i];
    const noteKey = note => JSON.stringify([beatOf(note.time), beatOf(note.endTime), note.type, Boolean(note.isFake), Boolean(note.isAlwaysPerfect)]);
    if (!sameJson(a.notes.map(noteKey).sort(), b.notes.map(noteKey).sort())) diffs.push(`line ${i} notes`);
    const animKey = animation => JSON.stringify(canon({ startTime: animation.startTime, endTime: animation.endTime, type: animation.type, start: animation.start, end: animation.end, bearer_type: animation.bearer_type, bearer: animation.bearer, ease: animation.ease }));
    if (!sameJson(a.animations.map(animKey).sort(), b.animations.map(animKey).sort())) diffs.push(`line ${i} animations`);
  }
  return diffs;
};

try {
  await waitFor(`(async () => { if (!window.rpenMods?.manager) return null; await window.rpenMods.manager.ready; return true; })()`, 90000, 'boot');
  const modBase64 = fs.readFileSync(MOD).toString('base64');
  step('mod', await evaluate(`(async () => {
    const manager = window.rpenMods.manager;
    window.confirm = () => true; manager.review = async () => true;
    const bytes = Uint8Array.from(atob(${JSON.stringify(modBase64)}), c => c.charCodeAt(0));
    await manager.importFiles([new File([bytes], 'milthm-fmt2-bridge.rpenmod')]);
    await manager.enable('milthm-fmt2-bridge');
    await new Promise(resolve => setTimeout(resolve, 900));
    return { loaded: manager.runtime.loaded.get('milthm-fmt2-bridge')?.status, version: manager.records.get('milthm-fmt2-bridge')?.manifest?.version };
  })()`));

  const doc = await send('DOM.getDocument', { depth: -1, pierce: true });
  const input = await send('DOM.querySelector', { nodeId: doc.root.nodeId, selector: '#file-input' });
  await send('DOM.setFileInputFiles', { nodeId: input.nodeId, files: [CHART_ZIP] });
  step('import', await waitFor(`(() => {
    const chart = window.rpenMods.editor?.chart;
    const line = chart?.judgeLineList?.[1];
    const stash = line?.['x-milthm'];
    if (!chart?.['x-milthm']?.columns || !stash?.events) return null;
    return { lines: chart.judgeLineList.length, columns: chart['x-milthm'].columns,
      bodyAlpha: stash.events.bodyAlpha.length, flowSpeed: stash.events.flowSpeed.length, x: stash.events.x.length };
  })()`, 90000, 'import + columns init'));
  await waitFor(`(() => window.rpenMods.editor?.audio?.buffer?.duration > 1)()`, 30000, 'audio');

  step('overlay', await evaluate(`(() => {
    const bar = document.querySelector('.milthm-column-bar');
    const selects = bar ? [...bar.querySelectorAll('select')] : [];
    const rect = bar ? bar.getBoundingClientRect() : null;
    return {
      overlay: Boolean(bar), display: bar?.style.display ?? null,
      rect: rect ? { left: Math.round(rect.left), top: Math.round(rect.top), width: Math.round(rect.width), height: Math.round(rect.height) } : null,
      slots: selects.map(select => ({ value: select.value, options: [...select.options].map(option => option.value) })),
      panelRemoved: document.querySelectorAll('.milthm-panel').length === 0,
      oldSelectRemoved: !document.querySelector('#milthm-timeline-select'),
    };
  })()`));

  // switch slot 4 (alpha) to head alpha and back
  step('remap', await evaluate(`(async () => {
    const editor = window.rpenMods.editor;
    const bar = document.querySelector('.milthm-column-bar');
    const select = bar.querySelectorAll('select')[3];
    select.value = 'headAlpha'; select.dispatchEvent(new Event('change'));
    await new Promise(resolve => setTimeout(resolve, 900));
    const afterHead = editor.chart['x-milthm'].columns.slice();
    select.value = 'bodyAlpha'; select.dispatchEvent(new Event('change'));
    await new Promise(resolve => setTimeout(resolve, 900));
    return { afterHead, afterBack: editor.chart['x-milthm'].columns.slice(), displayedValue: select.value };
  })()`));

  // export chart.json through the mod command (semantic export)
  step('export command', await evaluate(`(async () => {
    const command = window.rpenMods.manager.runtime.commands.get('milthm-fmt2-bridge:export-json');
    return await command.run();
  })()`));
  await sleep(2500);
  const jsonFiles = fs.readdirSync(DL).filter(name => name.endsWith('.json'));
  step('json download', { files: jsonFiles });
  const exported = JSON.parse(fs.readFileSync(path.join(DL, jsonFiles.at(-1)), 'utf-8'));
  const diffs = semanticDiffs(exported);
  step('semantic diffs', { count: diffs.length, diffs: diffs.slice(0, 5) });

  // native export dialog should offer the two Milthm formats and export a json
  const before = fs.readdirSync(DL).length;
  await evaluate(`(() => { document.querySelector('#export').click(); return true; })()`);
  const dialogInfo = await waitFor(`(() => {
    const dialog = document.querySelector('dialog[open]');
    if (!dialog) return null;
    const format = [...dialog.querySelectorAll('select')].find(select => [...select.options].some(option => option.value === 'milthm:json'));
    if (!format) return null;
    return { open: true, options: [...format.options].map(option => option.value) };
  })()`, 10000, 'export dialog');
  step('export dialog', dialogInfo);
  await evaluate(`(async () => {
    const dialog = document.querySelector('dialog[open]');
    const format = [...dialog.querySelectorAll('select')].find(select => [...select.options].some(option => option.value === 'milthm:json'));
    format.value = 'milthm:json'; format.dispatchEvent(new Event('change'));
    const apply = dialog.querySelector('#modal-apply');
    apply.click();
    return true;
  })()`);
  await sleep(3500);
  step('export dialog download', { files: fs.readdirSync(DL), added: fs.readdirSync(DL).length - before });

  const shot = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(OUT, 'editor-columns.png'), Buffer.from(shot.data, 'base64'));
  report.ok = diffs.length === 0 && dialogInfo.options.includes('milthm:zip');
} catch (error) {
  step('FAILED', { message: String(error?.message ?? error) });
  report.error = String(error?.stack ?? error);
} finally {
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
  console.log('\nEVENTS', JSON.stringify(events.slice(0, 8)));
  try { await send('Page.close'); } catch { }
  ws.close();
  process.exitCode = report.error || !report.ok ? 1 : 0;
}
