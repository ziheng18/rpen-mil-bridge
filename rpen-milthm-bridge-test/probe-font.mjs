// Live probe: the mod replaces RPEN's bundled RPE / RPEGame text fonts with ChillRoundF on enable.
// Checks: font ships in the mod package, RPE/RPEGame measurements change to the bundled font,
// preview line-text layout uses it, setting toggle restores RPEN's own font, 0 JS exceptions.
// Requires RPEN on :4173 and headless Edge CDP on :9333.
import fs from 'node:fs';
import path from 'node:path';

const CDP = 9333;
const PAGE = 'http://127.0.0.1:4173/';
const WORK = 'E:\\File\\deepseek harness\\mil';
const OUT = path.join(WORK, 'rpen-milthm-bridge-test', 'editor-font');
const MOD = path.join(WORK, 'rpen-milthm-bridge', 'milthm-fmt2-bridge.rpenmod');
const SAMPLE = '字体测试 ABC 123';
fs.rmSync(OUT, { recursive: true, force: true }); fs.mkdirSync(OUT, { recursive: true });

// ---- store-only zip writer for the crafted text-line fixture ----
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
const ease = { type: 0, press: 0, isValueExp: false, cusValueExp: '', clipLeft: 0, clipRight: 1 };
const chart = {
  fmt: 2,
  meta: { name: 'editor font test', background_dim: 0.6, background_artist: '', music_artist: '', charter: '', difficulty_name: '', difficulty: 0, offset: 0 },
  bpms: [{ time: [0, 0, 1], bpm: 120 }],
  lines: [{
    index: 0, notes: [],
    animations: [{ type: 4, startTime: [0, 0, 1], endTime: [100, 0, 1], start: 90, end: 90, bearer_type: 0, bearer: 0, ease }],
  }],
  storyboards: [],
};
const textEvent = value => ({ startTime: [0, 0, 1], endTime: [100, 0, 1], start: value, end: value, easingType: 1, easingLeft: 0, easingRight: 1, bezier: 0, bezierPoints: [0, 0, 1, 1], linkgroup: 0 });
const CHART_ZIP = path.join(OUT, 'editor-font-test.zip');
fs.writeFileSync(CHART_ZIP, makeZip([
  ['chart.json', new TextEncoder().encode(JSON.stringify(chart))],
  ['meta.json', new TextEncoder().encode(JSON.stringify({ chart_file: 'chart.json', audio_file: '', image_file: '' }))],
]));

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
const screenshot = async name => { const shot = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(OUT, name), Buffer.from(shot.data, 'base64')); };
const report = { steps: [], exceptions };
const step = (name, data) => { report.steps.push({ name, data }); console.log('STEP', name, JSON.stringify(data).slice(0, 1200)); };
const measureExpr = `(font, text) => { const canvas = document.createElement('canvas').getContext('2d'); canvas.font = font; return Math.round(canvas.measureText(text).width * 100) / 100; }`;

try {
  await waitFor(`(async () => { if (!window.rpenMods?.manager) return null; await window.rpenMods.manager.ready; await document.fonts.ready; return true; })()`);
  const before = await evaluate(`(async () => {
    const manager = window.rpenMods.manager;
    const wasLoaded = manager.runtime.loaded.has('milthm-fmt2-bridge');
    // the mod may still be enabled from a previous probe page (same browser profile)
    if (wasLoaded) { await manager.disable('milthm-fmt2-bridge'); await new Promise(resolve => setTimeout(resolve, 700)); }
    const measure = ${measureExpr};
    return { wasLoaded, loadedAfterDisable: manager.runtime.loaded.has('milthm-fmt2-bridge'),
      rpe13: measure('13px RPE', ${JSON.stringify(SAMPLE)}), rpe52: measure('52px RPE', ${JSON.stringify(SAMPLE)}), game30: measure('30px RPEGame', ${JSON.stringify(SAMPLE)}),
      rpe13Hello: measure('52px RPE', 'HELLO') }; })()`);
  step('before', before);
  await screenshot('ui-before.png');

  const modBase64 = fs.readFileSync(MOD).toString('base64');
  step('mod', await evaluate(`(async () => {
    const manager = window.rpenMods.manager;
    window.confirm = () => true; manager.review = async () => true;
    const bytes = Uint8Array.from(atob(${JSON.stringify(modBase64)}), c => c.charCodeAt(0));
    await manager.importFiles([new File([bytes], 'milthm-fmt2-bridge.rpenmod')]);
    await manager.enable('milthm-fmt2-bridge');
    await new Promise(resolve => setTimeout(resolve, 1500));
    const record = manager.records.get('milthm-fmt2-bridge');
    const state = manager.runtime.loaded.get('milthm-fmt2-bridge');
    const files = state?.api?.package?.files?.() ?? [];
    return { loaded: state?.status, version: record?.manifest?.version, files,
      fontSetting: record?.manifest?.settings?.['editor-font'] ?? null,
      current: state?.settings?.['editor-font'] ?? null };
  })()`));

  step('font', await evaluate(`(async () => {
    const state = window.rpenMods.manager.runtime.loaded.get('milthm-fmt2-bridge');
    const url = state.api.package.url('fonts/ChillRoundF.ttf', 'font/ttf');
    if (![...document.fonts].some(face => face.family === 'ChillRoundFDirect')) {
      const direct = new FontFace('ChillRoundFDirect', 'url(' + url + ')');
      await direct.load(); document.fonts.add(direct);
    }
    await document.fonts.load('52px RPE'); await document.fonts.load('30px RPEGame'); await document.fonts.load('13px RPE');
    const measure = ${measureExpr};
    return { rpe13: measure('13px RPE', ${JSON.stringify(SAMPLE)}), rpe52: measure('52px RPE', ${JSON.stringify(SAMPLE)}),
      game30: measure('30px RPEGame', ${JSON.stringify(SAMPLE)}), direct52: measure('52px ChillRoundFDirect', ${JSON.stringify(SAMPLE)}),
      rpe52Hello: measure('52px RPE', 'HELLO'), direct52Hello: measure('52px ChillRoundFDirect', 'HELLO') };
  })()`));
  await screenshot('ui-after.png');
  step('dom-fonts', await evaluate(`(() => {
    const family = element => element ? getComputedStyle(element).fontFamily : null;
    const host = document.createElement('div');
    host.innerHTML = '<div class="batch-script">x</div><div class="field"><select><option>a</option></select><textarea>t</textarea></div>';
    document.body.append(host);
    const kbd = document.createElement('kbd'); kbd.textContent = 'K'; host.append(kbd);
    const values = {
      body: family(document.body), root: family(document.documentElement),
      button: family(document.querySelector('button')),
      select: family(host.querySelector('select')),
      textarea: family(host.querySelector('textarea')),
      batchScript: family(host.querySelector('.batch-script')),
      kbd: family(kbd),
    };
    host.remove();
    return values;
  })()`));

  // setting toggle restores / re-applies RPEN's own font
  step('toggle', await evaluate(`(async () => {
    const manager = window.rpenMods.manager;
    const state = manager.runtime.loaded.get('milthm-fmt2-bridge');
    const measure = ${measureExpr};
    const family = element => element ? getComputedStyle(element).fontFamily : null;
    const select = document.querySelector('select');
    await state.api.settings.set('editor-font', false);
    await new Promise(resolve => setTimeout(resolve, 700));
    await document.fonts.load('52px RPE');
    const off = { rpe52: measure('52px RPE', ${JSON.stringify(SAMPLE)}), rpe13: measure('13px RPE', ${JSON.stringify(SAMPLE)}) };
    const offDom = { body: family(document.body), select: family(select) };
    await state.api.settings.set('editor-font', true);
    await new Promise(resolve => setTimeout(resolve, 900));
    await document.fonts.load('52px RPE');
    const on = { rpe52: measure('52px RPE', ${JSON.stringify(SAMPLE)}), rpe13: measure('13px RPE', ${JSON.stringify(SAMPLE)}) };
    const onDom = { body: family(document.body), select: family(select) };
    return { off, on, offDom, onDom };
  })()`));

  // preview line text must use the same font (RPEN measures line text with '52px RPE')
  const doc = await send('DOM.getDocument', { depth: -1, pierce: true });
  const input = await send('DOM.querySelector', { nodeId: doc.root.nodeId, selector: '#file-input' });
  await send('DOM.setFileInputFiles', { nodeId: input.nodeId, files: [CHART_ZIP] });
  await waitFor(`(() => { const chart = window.rpenMods.editor?.chart; return chart?.['x-milthm']?.columns && chart.judgeLineList?.length === 1 ? true : null; })()`, 90000, 'import');
  step('text-edit', await evaluate(`(() => {
    const editor = window.rpenMods.editor;
    const next = structuredClone(editor.chart);
    next.judgeLineList[0].extended = { ...(next.judgeLineList[0].extended ?? {}), textEvents: [${JSON.stringify(textEvent(SAMPLE))}] };
    editor.commit('probe editor font', next);
    return { textEvents: next.judgeLineList[0].extended.textEvents.length };
  })()`));
  await evaluate(`window.rpenMods.editor.setPreview(true)`);
  await waitFor(`(() => { const preview = window.rpenMods.editor.preview; return preview?.visible && preview.canvas.getBoundingClientRect().width > 100 && preview.scene?.lines?.length === 1; })()`, 30000, 'preview');
  await evaluate(`window.rpenMods.editor.seek(1)`);
  await sleep(1500);
  step('preview-text', await evaluate(`(() => {
    const editor = window.rpenMods.editor;
    const preview = editor.preview;
    const measure = ${measureExpr};
    const context = document.createElement('canvas').getContext('2d');
    const layout = preview.lineTextLayout(${JSON.stringify(SAMPLE)}, context);
    return { text: preview.scene.lines[0].state(1).text, layoutWidth: Math.round(layout.width * 100) / 100,
      directWidth: measure('52px ChillRoundFDirect', ${JSON.stringify(SAMPLE)}) };
  })()`));
  await screenshot('preview-text.png');

  const before13 = report.steps.find(entry => entry.name === 'before')?.data?.rpe13;
  const before52 = report.steps.find(entry => entry.name === 'before')?.data?.rpe52;
  const beforeGame = report.steps.find(entry => entry.name === 'before')?.data?.game30;
  const after = report.steps.find(entry => entry.name === 'font')?.data ?? {};
  const toggle = report.steps.find(entry => entry.name === 'toggle')?.data ?? {};
  const preview = report.steps.find(entry => entry.name === 'preview-text')?.data ?? {};
  const near = (a, b, tolerance = 0.5) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= tolerance;
  const changed = (a, b) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) > 1;
  const result = {
    version: report.steps.find(entry => entry.name === 'mod')?.data?.version,
    fontInPackage: (report.steps.find(entry => entry.name === 'mod')?.data?.files ?? []).includes('fonts/ChillRoundF.ttf'),
    licenseInPackage: ['fonts/OFL.txt', 'fonts/FONT-NOTICE.txt'].every(file => (report.steps.find(entry => entry.name === 'mod')?.data?.files ?? []).includes(file)),
    defaultSetting: report.steps.find(entry => entry.name === 'mod')?.data?.current ?? null,
    before: { rpe13: before13, rpe52: before52, game30: beforeGame },
    after: { rpe13: after.rpe13, rpe52: after.rpe52, game30: after.game30, direct52: after.direct52 },
    rpeReplaced: changed(before13, after.rpe13) && near(after.rpe13, after.direct52 / 4),
    gameReplaced: near(after.game30, after.direct52 * 30 / 52),
    toggleOffRestores: near(toggle.off?.rpe52, before52, 1) && near(toggle.off?.rpe13, before13, 1),
    toggleOnReapplies: near(toggle.on?.rpe52, after.direct52, 1),
    previewUsesFont: preview.text === SAMPLE && near(preview.layoutWidth, preview.directWidth, 0.5) && changed(before52, preview.layoutWidth),
    domFonts: report.steps.find(entry => entry.name === 'dom-fonts')?.data ?? null,
    domFontsAllChillRound: Object.values(report.steps.find(entry => entry.name === 'dom-fonts')?.data ?? {}).every(value => typeof value === 'string' && value.includes('ChillRoundF')),
    domReverts: report.steps.find(entry => entry.name === 'toggle')?.data?.offDom && !String(report.steps.find(entry => entry.name === 'toggle').data.offDom.body).includes('ChillRoundF'),
    domReapplies: report.steps.find(entry => entry.name === 'toggle')?.data?.onDom && String(report.steps.find(entry => entry.name === 'toggle').data.onDom.body).includes('ChillRoundF'),
    exceptions: exceptions.length,
  };
  result.ok = Boolean(result.version) && result.fontInPackage && result.licenseInPackage && result.defaultSetting === true
    && result.rpeReplaced && result.gameReplaced && result.toggleOffRestores && result.toggleOnReapplies
    && result.previewUsesFont && result.domFontsAllChillRound && result.domReverts && result.domReapplies && result.exceptions === 0;
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
