// Probe v0.4: preview tracks + zip export + new Milthm chart flow.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
const CDP = 9333;
const PAGE = 'http://127.0.0.1:4173/';
const WORK = 'E:\\File\\deepseek harness\\mil';
const OUT = path.join(WORK, 'rpen-milthm-bridge-test', 'probe4');
const DL = path.join(OUT, 'downloads');
const MOD = path.join(WORK, 'rpen-milthm-bridge', 'milthm-fmt2-bridge.rpenmod');
const CHART_ZIP = fs.readdirSync(WORK).filter(name => /^Class.Memories\.zip$/i.test(name)).map(name => path.join(WORK, name))[0];
fs.rmSync(OUT, { recursive: true, force: true }); fs.mkdirSync(DL, { recursive: true });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function fetchJson(url, options) { const response = await fetch(url, options); return JSON.parse(await response.text()); }
const target = await fetchJson(`http://127.0.0.1:${CDP}/json/new?${encodeURIComponent(PAGE)}`, { method: 'PUT' });
const ws = new WebSocket(target.webSocketDebuggerUrl);
const pending = new Map(); let messageId = 0;
function send(method, params = {}) { return new Promise((resolve, reject) => { const id = ++messageId; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })); }); }
ws.onmessage = event => { const message = JSON.parse(event.data); if (message.id && pending.has(message.id)) { const entry = pending.get(message.id); pending.delete(message.id); message.error ? entry.reject(new Error(JSON.stringify(message.error))) : entry.resolve(message.result); } };
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = () => reject(new Error('ws')); });
await send('Runtime.enable'); await send('Page.enable'); await send('DOM.enable');
await send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: DL });
await send('Emulation.setDeviceMetricsOverride', { width: 1500, height: 900, deviceScaleFactor: 1, mobile: false });
const evaluate = async (expression, awaitPromise = true) => { const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise }); if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text); return result.result?.value; };
const waitFor = async (expression, timeout = 90000, label = 'wait') => { const start = Date.now(); while (Date.now() - start < timeout) { try { const value = await evaluate(expression); if (value) return value; } catch { } await sleep(400); } throw new Error('timeout ' + label); };
const shot = async name => { const data = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(OUT, name), Buffer.from(data.data, 'base64')); };
try {
  await waitFor(`(async () => { if (!window.rpenMods?.manager) return null; await window.rpenMods.manager.ready; return true; })()`, 90000, 'boot');
  const modBase64 = fs.readFileSync(MOD).toString('base64');
  await evaluate(`(async () => {
    const manager = window.rpenMods.manager; window.confirm = () => true; manager.review = async () => true;
    const bytes = Uint8Array.from(atob(${JSON.stringify(modBase64)}), c => c.charCodeAt(0));
    await manager.importFiles([new File([bytes], 'milthm-fmt2-bridge.rpenmod')]);
    await manager.enable('milthm-fmt2-bridge');
    await new Promise(resolve => setTimeout(resolve, 800));
    return true;
  })()`);
  // 1) import Class Memories and capture the preview
  const doc = await send('DOM.getDocument', { depth: -1, pierce: true });
  const input = await send('DOM.querySelector', { nodeId: doc.root.nodeId, selector: '#file-input' });
  await send('DOM.setFileInputFiles', { nodeId: input.nodeId, files: [CHART_ZIP] });
  await waitFor(`(() => window.rpenMods.editor?.chart?.['x-milthm']?.columns && window.rpenMods.editor?.audio?.buffer?.duration > 1)()`, 90000, 'import');
  await sleep(1200);
  await evaluate(`(async () => { const editor = window.rpenMods.editor; editor.selectLine(1); editor.setPreview(true, { stay: true }); editor.seek(2.2, { pause: true }); await new Promise(resolve => setTimeout(resolve, 900)); return true; })()`);
  await shot('preview-tracks-v04.png');
  console.log('preview state', JSON.stringify(await evaluate(`(() => ({ preview: window.rpenMods.editor.preview.visible, sceneLines: window.rpenMods.editor.preview.scene?.lines?.length, seconds: 2.2 }))()`)));
  // 2) zip export
  console.log('zip', JSON.stringify(await evaluate(`(async () => { const command = window.rpenMods.manager.runtime.commands.get('milthm-fmt2-bridge:export-zip'); return await command.run(); })()`)));
  await sleep(3000);
  const zipFile = fs.readdirSync(DL).find(name => name.endsWith('.zip'));
  console.log('zip file', zipFile);
  if (zipFile) {
    const buffer = fs.readFileSync(path.join(DL, zipFile));
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    let eocd = -1; for (let i = buffer.length - 22; i >= 0; i--) if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    const count = view.getUint16(eocd + 10, true); let offset = view.getUint32(eocd + 16, true);
    const names = [];
    let chartJson = null;
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
      names.push(name);
      if (name === 'chart.json') chartJson = JSON.parse(data.toString('utf8'));
    }
    console.log('zip entries', JSON.stringify(names), 'chart lines', chartJson?.lines?.length, 'animations', chartJson?.lines?.reduce((sum, line) => sum + line.animations.length, 0));
  }
  // 3) new Milthm chart through the dialog
  await evaluate(`(() => { document.querySelector('#new')?.click(); return true; })()`);
  await waitFor(`(() => !!document.querySelector('#milthm-new-chart-dialog'))()`, 10000, 'new chart dialog');
  await evaluate(`(() => { [...document.querySelectorAll('#milthm-new-chart-dialog button')].find(button => button.textContent.includes('Milthm'))?.click(); return true; })()`);
  await sleep(1500);
  console.log('new chart', JSON.stringify(await evaluate(`(() => { const editor = window.rpenMods.editor; const chart = editor.chart; return { marker: chart?.['x-milthm']?.kind ?? null, columns: chart?.['x-milthm']?.columns, lines: chart?.judgeLineList?.length, overlay: !!document.querySelector('.milthm-column-bar'), panelRemoved: document.querySelectorAll('.milthm-panel').length === 0 }; })()`)));
  await shot('new-chart-v04.png');
} catch (error) { console.log('FAILED', String(error?.stack ?? error)); process.exitCode = 1; }
finally { try { await send('Page.close'); } catch { } ws.close(); }
