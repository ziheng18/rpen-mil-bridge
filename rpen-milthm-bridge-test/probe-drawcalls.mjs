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
await send('Runtime.enable');
const evaluate = async (expression, awaitPromise = true) => { const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise }); if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text); return result.result?.value; };
await evaluate(`(() => {
  const P = Object.getPrototypeOf(window.rpenMods.editor.preview);
  window.__calls = { scene: 0, line: 0, lineStates: [] };
  const scene = P.drawScene, line = P.drawLine;
  P.drawScene = function (...args) { window.__calls.scene++; return scene.apply(this, args); };
  P.drawLine = function (context, lineObject, state, scale) {
    window.__calls.line++;
    window.__calls.lineStates.push({ y: state.y, x: state.x, rotation: state.rotation, alpha: state.alpha, sx: state.scaleX, sy: state.scaleY });
    return line.apply(this, arguments);
  };
  return true;
})()`);
for (const y of [0, -700]) {
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
    editor.invalidate();
    window.__calls = { scene: 0, line: 0, lineStates: [] };
    await new Promise(resolve => setTimeout(resolve, 1500));
    return true;
  })()`);
  await sleep(500);
  const calls = await evaluate(`(async () => {
    const editor = window.rpenMods.editor;
    return { calls: window.__calls, chartY: editor.chart.judgeLineList[0].eventLayers[0].moveYEvents[0].start, frame: editor.preview?.canvas?.width ?? null, visible: editor.preview?.visible };
  })()`);
  console.log('y=', y, JSON.stringify(calls));
  const data = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(OUT, `instrument-y${y}.png`), Buffer.from(data.data, 'base64'));
}
ws.close();
