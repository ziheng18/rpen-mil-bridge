import fs from 'node:fs';
const CDP = 9334;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const targets = await (async () => { const r = await fetch(`http://127.0.0.1:${CDP}/json/list`); return await r.json(); })();
const target = targets.find(item => item.type === 'page' && String(item.url).includes('127.0.0.1:4173'));
const ws = new WebSocket(target.webSocketDebuggerUrl);
const pending = new Map(); let id = 0;
function send(method, params = {}) { return new Promise((resolve, reject) => { const mid = ++id; pending.set(mid, { resolve, reject }); ws.send(JSON.stringify({ id: mid, method, params })); }); }
ws.onmessage = event => { const message = JSON.parse(event.data); if (message.id && pending.has(message.id)) { const entry = pending.get(message.id); pending.delete(message.id); message.error ? entry.reject(new Error(JSON.stringify(message.error))) : entry.resolve(message.result); } };
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = () => reject(new Error('ws')); });
await send('Runtime.enable');
const evaluate = async (expression, awaitPromise = true) => {
  const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise });
  if (result.exceptionDetails) return { __error: result.exceptionDetails.exception?.description ?? result.exceptionDetails.text };
  return result.result?.value;
};
console.log('instrument', JSON.stringify(await evaluate(`(() => {
  const P = Object.getPrototypeOf(window.rpenMods.editor.preview);
  window.__captures = [];
  if (!window.__wrapped) {
    window.__wrapped = true;
    const d = P.drawScene;
    P.drawScene = function (...args) {
      window.__captures.push({ n: args.length, chart: args[1]?.['x-milthm']?.kind ?? null, seconds: args[3], frameKeys: args[5] ? Object.keys(args[5]) : null, frame: args[5], lineScale: this.lineScale, thisIsPreview: this === window.rpenMods.editor.preview });
      return d.apply(this, args);
    };
  }
  return true;
})()`)));
console.log('commit', JSON.stringify(await evaluate(`(async () => {
  const editor = window.rpenMods.editor;
  const next = structuredClone(editor.chart);
  const line = next.judgeLineList[0];
  const ev = value => ({ startTime: [0, 0, 1], endTime: [0, 0, 1], start: value, end: value, easingType: 1, easingLeft: 0, easingRight: 1, bezier: 0, bezierPoints: [0, 0, 1, 1], linkgroup: 0 });
  line.eventLayers[0].moveYEvents = [ev(-700)];
  line.eventLayers[0].moveXEvents = [ev(0)];
  line.eventLayers[0].rotateEvents = [ev(0)];
  editor.commit('probe', next);
  editor.setPreview(true, { stay: true });
  editor.seek(1, { pause: true });
  window.__captures = [];
  editor.invalidate();
  await new Promise(resolve => setTimeout(resolve, 1500));
  return { count: window.__captures.length };
})()`)));
console.log('compute', JSON.stringify(await evaluate(`(async () => {
  const captures = window.__captures ?? [];
  const capture = captures.filter(entry => entry.frameKeys).at(-1);
  if (!capture) return { error: 'no frame capture', captures: captures.map(entry => ({ n: entry.n, chart: entry.chart, frameKeys: entry.frameKeys })) };
  const { textureInViewport } = await import('/src/ui/preview-background.mjs');
  const frame = capture.frame;
  const state = frame.states?.[0] ?? null;
  const line = window.rpenMods.editor.chart.judgeLineList[0];
  const viewport = frame.renderViewport ?? frame.viewport;
  return {
    n: capture.n, chart: capture.chart, seconds: capture.seconds,
    frameKeys: capture.frameKeys,
    state: state ? { x: state.x, y: state.y, rotation: state.rotation, alpha: state.alpha, scaleX: state.scaleX, scaleY: state.scaleY } : null,
    scale: frame.scale, width: frame.width, height: frame.height,
    viewport: viewport ? { left: viewport.left, top: viewport.top, width: viewport.width, height: viewport.height } : null,
    basePass: state ? textureInViewport({ naturalWidth: 4000, naturalHeight: 5 * frame.lineScale }, line, state, frame.width, frame.height, frame.scale, viewport) : null,
    hackedPass: state ? textureInViewport({ naturalWidth: 4000, naturalHeight: 5 * 1e6 }, line, state, frame.width, frame.height, frame.scale, viewport) : null,
  };
})()`), null, 2));
ws.close();
