// Reproduction: lineAlpha event ends at 0; add another 0-valued event later — does the visual/state differ?
import fs from 'node:fs';
import path from 'node:path';
const CDP = 9333;
const PAGE = 'http://127.0.0.1:4173/';
const WORK = 'E:\\File\\deepseek harness\\mil';
const MOD = path.join(WORK, 'rpen-milthm-bridge', 'milthm-fmt2-bridge.rpenmod');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function fetchJson(url, options) { const response = await fetch(url, options); return JSON.parse(await response.text()); }
const target = await fetchJson(`http://127.0.0.1:${CDP}/json/new?${encodeURIComponent(PAGE)}`, { method: 'PUT' });
const ws = new WebSocket(target.webSocketDebuggerUrl);
const pending = new Map(); let messageId = 0;
function send(method, params = {}) { return new Promise((resolve, reject) => { const id = ++messageId; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })); }); }
ws.onmessage = event => { const message = JSON.parse(event.data); if (message.id && pending.has(message.id)) { const entry = pending.get(message.id); pending.delete(message.id); message.error ? entry.reject(new Error(JSON.stringify(message.error))) : entry.resolve(message.result); } };
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = () => reject(new Error('ws')); });
await send('Runtime.enable'); await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 850, deviceScaleFactor: 1, mobile: false });
const evaluate = async (expression, awaitPromise = true) => { const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise }); if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text); return result.result?.value; };
const waitFor = async (expression, timeout = 90000, label = 'wait') => { const start = Date.now(); while (Date.now() - start < timeout) { try { const value = await evaluate(expression); if (value) return value; } catch { } await sleep(400); } throw new Error('timeout ' + label); };
try {
  await waitFor(`(async () => { if (!window.rpenMods?.manager) return null; await window.rpenMods.manager.ready; return true; })()`, 90000, 'boot');
  const modBase64 = fs.readFileSync(MOD).toString('base64');
  await evaluate(`(async () => {
    const manager = window.rpenMods.manager; window.confirm = () => true; manager.review = async () => true;
    const bytes = Uint8Array.from(atob(${JSON.stringify(modBase64)}), c => c.charCodeAt(0));
    await manager.importFiles([new File([bytes], 'milthm-fmt2-bridge.rpenmod')]);
    await manager.enable('milthm-fmt2-bridge');
    await new Promise(resolve => setTimeout(resolve, 700));
    manager.runtime.commands.get('milthm-fmt2-bridge:new-milthm-chart')?.run();
    await new Promise(resolve => setTimeout(resolve, 900));
    return true;
  })()`);
  await waitFor(`(() => { const chart = window.rpenMods.editor?.chart; return chart?.['x-milthm']?.columns && chart.judgeLineList?.[0]?.['x-milthm']?.events; })()`, 30000, 'chart');
  const result = await evaluate(`(async () => {
    const editor = window.rpenMods.editor;
    const ev = (startBeat, endBeat, value) => ({ startTime: [startBeat, 0, 1], endTime: [endBeat, 0, 1], start: value, end: value,
      easingType: 1, easingLeft: 0, easingRight: 1, bezier: 0, bezierPoints: [0, 0, 1, 1], linkgroup: 0 });
    const raw = (startBeat, endBeat, value) => ({ type: 2, startTime: [startBeat, 0, 1], endTime: [endBeat, 0, 1], start: value, end: value,
      ease: { type: 0, press: 0, isValueExp: false, cusValueExp: '', clipLeft: 0, clipRight: 1 } });
    const prepare = (extra) => {
      const clone = structuredClone(editor.chart);
      clone['x-milthm'].columns = ['x','y','rotate','lineAlpha','flowSpeed'];
      const line = clone.judgeLineList[0];
      const semantics = line['x-milthm'].events;
      semantics.lineAlpha = [raw(0, 1, 0), ...(extra ? [raw(2, 3, 0)] : [])];
      line.eventLayers[0].alphaEvents = [ev(0, 1, 0), ...(extra ? [ev(2, 3, 0)] : [])];
      line['x-milthm'].applied = null;
      return clone;
    };
    const sampleAt = async (beat) => {
      editor.setPreview(true, { stay: true });
      editor.seek(beat, { pause: true });
      await new Promise(resolve => setTimeout(resolve, 700));
      const states = editor.preview.scene.sample(beat, { x: 1, y: 1 });
      return { alpha: states[0]?.alpha };
    };
    const record = {};
    editor.commit('A only', prepare(false));
    await new Promise(resolve => setTimeout(resolve, 900));
    record.aSemantics = JSON.parse(JSON.stringify(editor.chart.judgeLineList[0]['x-milthm'].events.lineAlpha));
    record.afterA = await sampleAt(1.8);
    editor.commit('A + zero event', prepare(true));
    await new Promise(resolve => setTimeout(resolve, 900));
    record.abSemantics = JSON.parse(JSON.stringify(editor.chart.judgeLineList[0]['x-milthm'].events.lineAlpha));
    record.afterAB = await sampleAt(1.8);
    record.afterABlate = await sampleAt(1.8);
    record.afterAB2 = await sampleAt(4);
    return record;
  })()`);
  console.log(JSON.stringify(result, null, 2));
} catch (error) { console.log('FAILED', String(error?.stack ?? error)); process.exitCode = 1; }
finally { try { await send('Page.close'); } catch { } ws.close(); }
