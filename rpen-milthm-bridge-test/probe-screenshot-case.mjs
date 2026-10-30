// Reproduce the screenshot case: Class Memories, slot4 = 轨道整体不透明度, add a 0-opacity
// event at 8:3/4..8:7/8 on line 1, seek to 8.75 beat and inspect the scene alpha.
import fs from 'node:fs';
import path from 'node:path';
const CDP = 9333;
const PAGE = 'http://127.0.0.1:4173/';
const WORK = 'E:\\File\\deepseek harness\\mil';
const MOD = path.join(WORK, 'rpen-milthm-bridge', 'milthm-fmt2-bridge.rpenmod');
const CHART_ZIP = fs.readdirSync(WORK).filter(name => /^Class.Memories\.zip$/i.test(name)).map(name => path.join(WORK, name))[0];
const OUT = path.join(WORK, 'rpen-milthm-bridge-test', 'screenshot-case');
fs.rmSync(OUT, { recursive: true, force: true }); fs.mkdirSync(OUT, { recursive: true });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function fetchJson(url, options) { const response = await fetch(url, options); return JSON.parse(await response.text()); }
const target = await fetchJson(`http://127.0.0.1:${CDP}/json/new?${encodeURIComponent(PAGE)}`, { method: 'PUT' });
const ws = new WebSocket(target.webSocketDebuggerUrl);
const pending = new Map(); let messageId = 0;
function send(method, params = {}) { return new Promise((resolve, reject) => { const id = ++messageId; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })); }); }
ws.onmessage = event => { const message = JSON.parse(event.data); if (message.id && pending.has(message.id)) { const entry = pending.get(message.id); pending.delete(message.id); message.error ? entry.reject(new Error(JSON.stringify(message.error))) : entry.resolve(message.result); } };
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = () => reject(new Error('ws')); });
await send('Runtime.enable'); await send('Page.enable'); await send('DOM.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1680, height: 1000, deviceScaleFactor: 1, mobile: false });
const evaluate = async (expression, awaitPromise = true) => { const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise }); if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text); return result.result?.value; };
const waitFor = async (expression, timeout = 90000, label = 'wait') => { const start = Date.now(); while (Date.now() - start < timeout) { try { const value = await evaluate(expression); if (value) return value; } catch { } await sleep(400); } throw new Error('timeout: ' + label); };
const shot = async name => { const data = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(OUT, name), Buffer.from(data.data, 'base64')); };
try {
  await waitFor(`(async () => { if (!window.rpenMods?.manager) return null; await window.rpenMods.manager.ready; return true; })()`, 90000, 'boot');
  const modBase64 = fs.readFileSync(MOD).toString('base64');
  await evaluate(`(async () => {
    const manager = window.rpenMods.manager; window.confirm = () => true; manager.review = async () => true;
    const bytes = Uint8Array.from(atob(${JSON.stringify(modBase64)}), c => c.charCodeAt(0));
    await manager.importFiles([new File([bytes], 'milthm-fmt2-bridge.rpenmod')]);
    await manager.enable('milthm-fmt2-bridge');
    await new Promise(resolve => setTimeout(resolve, 700));
    return true;
  })()`);
  const doc = await send('DOM.getDocument', { depth: -1, pierce: true });
  const input = await send('DOM.querySelector', { nodeId: doc.root.nodeId, selector: '#file-input' });
  await send('DOM.setFileInputFiles', { nodeId: input.nodeId, files: [CHART_ZIP] });
  await waitFor(`(() => window.rpenMods.editor?.chart?.['x-milthm']?.columns && window.rpenMods.editor?.chart?.judgeLineList?.length > 10)()`, 90000, 'chart');
  const result = await evaluate(`(async () => {
    const editor = window.rpenMods.editor;
    // map slot 4 -> lineAlpha and slot 5 -> bodyAlpha
    const bar = document.querySelector('.milthm-column-bar');
    const selects = [...bar.querySelectorAll('select')];
    selects[3].value = 'lineAlpha'; selects[3].dispatchEvent(new Event('change'));
    await new Promise(resolve => setTimeout(resolve, 900));
    selects[4].value = 'bodyAlpha'; selects[4].dispatchEvent(new Event('change'));
    await new Promise(resolve => setTimeout(resolve, 900));
    // add a 0-opacity event on line 1 at beat 8:3/4 .. 8:7/8 through the display alpha carrier
    const lineIndex = 7;
    const next = structuredClone(editor.chart);
    const line = next.judgeLineList[lineIndex];
    const layer = line.eventLayers[0];
    const newEvent = {
      startTime: [8, 3, 4], endTime: [8, 7, 8], start: 0, end: 0,
      easingType: 1, easingLeft: 0, easingRight: 1, bezier: 0, bezierPoints: [0, 0, 1, 1], linkgroup: 0,
    };
    const beat = time => Number(time[0]) + Number(time[1]) / Number(time[2]);
    const insertAt = Math.max(0, (layer.alphaEvents ?? []).findIndex(event => Math.abs(beat(event.startTime) - 8.75) < 1e-9));
    layer.alphaEvents = [...(layer.alphaEvents ?? []).slice(0, insertAt), newEvent, ...(layer.alphaEvents ?? []).slice(insertAt)];
    line['x-milthm'].applied = null;
    editor.commit('add zero lineAlpha event', next);
    await new Promise(resolve => setTimeout(resolve, 1000));
    editor.selectLine(lineIndex);
    editor.setPreview(true, { stay: true });
    const seconds = editor.tempo.seconds(8.75, 1);
    editor.seek(seconds, { pause: true });
    await new Promise(resolve => setTimeout(resolve, 1200));
    const scene = editor.preview.scene;
    const states = scene.sample(seconds, { x: 1, y: 1 });
    const semantics = editor.chart.judgeLineList[lineIndex]['x-milthm'].events;
    const previewLine = editor.chart.judgeLineList[lineIndex];
    const texture = editor.chart.judgeLineList[lineIndex].Texture;
    return {
      columns: editor.chart['x-milthm'].columns,
      lineAlphaEvents: semantics.lineAlpha,
      lineAlphaCount: semantics.lineAlpha.length,
      bodyAlphaCount: semantics.bodyAlpha.length,
      displayAlphaEvents: editor.chart.judgeLineList[lineIndex].eventLayers[0].alphaEvents.slice(-2),
      seconds, stateAlpha: states[lineIndex]?.alpha,
      alphaAtBeat875: scene.lines[lineIndex]?.state ? scene.lines[lineIndex].state(seconds).alpha : null,
      lineX: states[lineIndex]?.x, lineY: states[lineIndex]?.y, rotation: states[lineIndex]?.rotation,
      texture,
      columnsNote: editor.chart['x-milthm'].columns.join(','),
    };
  })()`);
  console.log(JSON.stringify(result, null, 2));
  // also take a screenshot to look at
  await shot('case.png');
} catch (error) { console.log('FAILED', String(error?.stack ?? error)); process.exitCode = 1; }
finally { try { await send('Page.close'); } catch { } ws.close(); }
