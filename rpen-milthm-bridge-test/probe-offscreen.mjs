// Verify the off-screen track rendering fix in the demo window.
import fs from 'node:fs';
import path from 'node:path';
const CDP = 9334;
const OUT = 'E:\\File\\deepseek harness\\mil\\rpen-milthm-bridge-test\\offscreen-test';
fs.mkdirSync(OUT, { recursive: true });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const targets = await (async () => { const r = await fetch(`http://127.0.0.1:${CDP}/json/list`); return await r.json(); })();
const target = targets.find(item => item.type === 'page' && String(item.url).includes('127.0.0.1:4173'));
const ws = new WebSocket(target.webSocketDebuggerUrl);
const pending = new Map(); let id = 0;
function send(method, params = {}) { return new Promise((resolve, reject) => { const mid = ++id; pending.set(mid, { resolve, reject }); ws.send(JSON.stringify({ id: mid, method, params })); }); }
ws.onmessage = event => { const message = JSON.parse(event.data); if (message.id && pending.has(message.id)) { const entry = pending.get(message.id); pending.delete(message.id); message.error ? entry.reject(new Error(JSON.stringify(message.error))) : entry.resolve(message.result); } };
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = () => reject(new Error('ws')); });
await send('Runtime.enable'); await send('Page.enable'); await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });
const evaluate = async (expression, awaitPromise = true) => { const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise }); if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text); return result.result?.value; };
const waitFor = async (expression, timeout = 30000, label = 'wait') => { const start = Date.now(); while (Date.now() - start < timeout) { try { const value = await evaluate(expression); if (value) return value; } catch { } await sleep(300); } throw new Error('timeout ' + label); };
const shot = async name => { const data = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(OUT, name), Buffer.from(data.data, 'base64')); };
try {
  await waitFor(`(async () => { if (!window.rpenMods?.manager) return null; await window.rpenMods.manager.ready; return window.rpenMods.manager.runtime.loaded.has('milthm-fmt2-bridge'); })()`, 60000, 'mod');
  console.log('state', JSON.stringify(await evaluate(`(() => ({ marker: window.rpenMods.editor.chart?.['x-milthm']?.kind ?? null }))()`)));
  const result = await evaluate(`(async () => {
    const editor = window.rpenMods.editor;
    // make sure a Milthm chart exists
    if (editor.chart?.['x-milthm']?.kind !== 'milthm-fmt2') {
      window.rpenMods.manager.runtime.commands.get('milthm-fmt2-bridge:new-milthm-chart')?.run();
      await new Promise(resolve => setTimeout(resolve, 800));
    }
    const next = structuredClone(editor.chart);
    const line = next.judgeLineList[0];
    line.eventLayers[0].moveYEvents = [{ startTime: [0, 0, 1], endTime: [0, 0, 1], start: -700, end: -700, easingType: 1, easingLeft: 0, easingRight: 1, bezier: 0, bezierPoints: [0, 0, 1, 1], linkgroup: 0 }];
    line.eventLayers[0].moveXEvents = [{ startTime: [0, 0, 1], endTime: [0, 0, 1], start: 0, end: 0, easingType: 1, easingLeft: 0, easingRight: 1, bezier: 0, bezierPoints: [0, 0, 1, 1], linkgroup: 0 }];
    line.eventLayers[0].rotateEvents = [{ startTime: [0, 0, 1], endTime: [0, 0, 1], start: 0, end: 0, easingType: 1, easingLeft: 0, easingRight: 1, bezier: 0, bezierPoints: [0, 0, 1, 1], linkgroup: 0 }];
    line.eventLayers[0].alphaEvents = [{ startTime: [0, 0, 1], endTime: [0, 0, 1], start: 255, end: 255, easingType: 1, easingLeft: 0, easingRight: 1, bezier: 0, bezierPoints: [0, 0, 1, 1], linkgroup: 0 }];
    line.eventLayers[0].speedEvents = [{ startTime: [0, 0, 1], endTime: [0, 0, 1], start: 1, end: 1, easingType: 1, easingLeft: 0, easingRight: 1, bezier: 0, bezierPoints: [0, 0, 1, 1], linkgroup: 0 }];
    editor.commit('offscreen test', next);
    editor.selectLine(0);
    editor.setPreview(true, { stay: true });
    editor.seek(1, { pause: true });
    await new Promise(resolve => setTimeout(resolve, 1000));
    return { y: editor.chart.judgeLineList[0].eventLayers[0].moveYEvents[0].start, preview: true };
  })()`);
  console.log('setup', JSON.stringify(result));
  await shot('offscreen-y-minus700.png');
  // also horizontal: put head far right and rotate 90 so the ribbon crosses the screen
  const result2 = await evaluate(`(async () => {
    const editor = window.rpenMods.editor;
    const next = structuredClone(editor.chart);
    const line = next.judgeLineList[0];
    line.eventLayers[0].moveYEvents = [{ startTime: [0, 0, 1], endTime: [0, 0, 1], start: 0, end: 0, easingType: 1, easingLeft: 0, easingRight: 1, bezier: 0, bezierPoints: [0, 0, 1, 1], linkgroup: 0 }];
    line.eventLayers[0].moveXEvents = [{ startTime: [0, 0, 1], endTime: [0, 0, 1], start: 900, end: 900, easingType: 1, easingLeft: 0, easingRight: 1, bezier: 0, bezierPoints: [0, 0, 1, 1], linkgroup: 0 }];
    line.eventLayers[0].rotateEvents = [{ startTime: [0, 0, 1], endTime: [0, 0, 1], start: 90, end: 90, easingType: 1, easingLeft: 0, easingRight: 1, bezier: 0, bezierPoints: [0, 0, 1, 1], linkgroup: 0 }];
    editor.commit('offscreen test 2', next);
    editor.seek(1, { pause: true });
    await new Promise(resolve => setTimeout(resolve, 1000));
    return { x: 900, rotation: 90 };
  })()`);
  console.log('setup2', JSON.stringify(result2));
  await shot('offscreen-x900-rot90.png');
} catch (error) { console.log('FAILED', String(error?.stack ?? error)); process.exitCode = 1; }
finally { ws.close(); }
