import fs from 'node:fs';
import path from 'node:path';
const CDP = 9334;
const OUT = 'E:\\File\\deepseek harness\\mil\\rpen-milthm-bridge-test\\offscreen-test';
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
const shot = async name => { const data = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(OUT, name), Buffer.from(data.data, 'base64')); };
const state = await evaluate(`(() => {
  const preview = window.rpenMods.editor.preview;
  const scene = preview.scene;
  return {
    visible: preview.visible, allLines: preview.allLines,
    sceneChartMarker: scene?.chart?.['x-milthm']?.kind ?? null,
    hasChartProp: !!scene?.chart,
    lines: scene?.lines?.length ?? null,
    settings: (() => { try { return window.rpenMods.manager.runtime.loaded.get('milthm-fmt2-bridge')?.settings; } catch { return null; } })(),
  };
})()`);
console.log('preview state', JSON.stringify(state));
for (const [name, y] of [['visible-y0', 0], ['offscreen-y-minus700', -700]]) {
  await evaluate(`(async () => {
    const editor = window.rpenMods.editor;
    const next = structuredClone(editor.chart);
    const line = next.judgeLineList[0];
    const ev = value => ({ startTime: [0, 0, 1], endTime: [0, 0, 1], start: value, end: value, easingType: 1, easingLeft: 0, easingRight: 1, bezier: 0, bezierPoints: [0, 0, 1, 1], linkgroup: 0 });
    line.eventLayers[0].moveYEvents = [ev(${y})];
    line.eventLayers[0].moveXEvents = [ev(0)];
    line.eventLayers[0].rotateEvents = [ev(0)];
    editor.commit('probe y', next);
    editor.setPreview(true, { stay: true });
    editor.seek(1, { pause: true });
    await new Promise(resolve => setTimeout(resolve, 1200));
    return true;
  })()`);
  await sleep(800);
  await shot(`${name}.png`);
  console.log(name, JSON.stringify(await evaluate(`(() => { const p = window.rpenMods.editor.preview; return { y: window.rpenMods.editor.chart.judgeLineList[0].eventLayers[0].moveYEvents[0].start, canvas: [p.canvas.width, p.canvas.height], drawSceneCalls: p.__milthmSeconds ?? null }; })()`)));
}
ws.close();
