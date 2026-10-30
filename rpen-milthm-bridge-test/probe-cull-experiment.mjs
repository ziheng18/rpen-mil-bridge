// Experiment: can a temporary texture/describe override make the off-screen track pass RPEN's line culling?
import fs from 'node:fs';
import path from 'node:path';
const CDP = 9333;
const PAGE = 'http://127.0.0.1:4173/';
const WORK = 'E:\\File\\deepseek harness\\mil';
const OUT = path.join(WORK, 'rpen-milthm-bridge-test', 'offscreen-test');
const MOD = path.join(WORK, 'rpen-milthm-bridge', 'milthm-fmt2-bridge.rpenmod');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function fetchJson(url, options) { const response = await fetch(url, options); return JSON.parse(await response.text()); }
const target = await fetchJson(`http://127.0.0.1:${CDP}/json/new?${encodeURIComponent(PAGE)}`, { method: 'PUT' });
const ws = new WebSocket(target.webSocketDebuggerUrl);
const pending = new Map(); let messageId = 0;
function send(method, params = {}) { return new Promise((resolve, reject) => { const id = ++messageId; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })); }); }
ws.onmessage = event => { const message = JSON.parse(event.data); if (message.id && pending.has(message.id)) { const entry = pending.get(message.id); pending.delete(message.id); message.error ? entry.reject(new Error(JSON.stringify(message.error))) : entry.resolve(message.result); } };
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = () => reject(new Error('ws error')); });
await send('Runtime.enable'); await send('Page.enable'); await send('DOM.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });
const evaluate = async (expression, awaitPromise = true) => { const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise }); if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text); return result.result?.value; };
const waitFor = async (expression, timeout = 60000, label = 'wait') => { const start = Date.now(); while (Date.now() - start < timeout) { try { const value = await evaluate(expression); if (value) return value; } catch { } await sleep(400); } throw new Error('timeout ' + label); };
const shot = async name => { const data = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(OUT, name), Buffer.from(data.data, 'base64')); };
try {
  await waitFor(`(async () => { if (!window.rpenMods?.manager) return null; await window.rpenMods.manager.ready; return true; })()`, 90000, 'boot');
  const modBase64 = fs.readFileSync(MOD).toString('base64');
  await evaluate(`(async () => {
    const manager = window.rpenMods.manager;
    window.confirm = () => true; manager.review = async () => true;
    const bytes = Uint8Array.from(atob(${JSON.stringify(modBase64)}), c => c.charCodeAt(0));
    await manager.importFiles([new File([bytes], 'milthm-fmt2-bridge.rpenmod')]);
    await manager.enable('milthm-fmt2-bridge');
    await new Promise(resolve => setTimeout(resolve, 800));
    manager.runtime.commands.get('milthm-fmt2-bridge:new-milthm-chart')?.run();
    await new Promise(resolve => setTimeout(resolve, 800));
    return true;
  })()`);
  // wrap drawScene with a temporary texture/describe override
  await evaluate(`(() => {
    const P = Object.getPrototypeOf(window.rpenMods.editor.preview);
    window.__lineCalls = 0;
    if (!window.__expWrapped) {
      window.__expWrapped = true;
      const current = P.drawScene;
      P.drawScene = function (...args) {
        const images = this.images;
        if (!images) return current.apply(this, args);
        const originalDescribe = images.describe;
        const runtimes = this.scene?.lines ?? [];
        const originalTextures = runtimes.map(runtime => runtime.line.Texture);
        try {
          images.describe = () => ({ naturalWidth: 1e6, naturalHeight: 1e6 });
          for (const runtime of runtimes) runtime.line.Texture = '__milthm_track__';
          return current.apply(this, args);
        } finally {
          images.describe = originalDescribe;
          runtimes.forEach((runtime, index) => { runtime.line.Texture = originalTextures[index]; });
        }
      };
      const line = P.drawLine;
      P.drawLine = function (...args) { window.__lineCalls++; return line.apply(this, args); };
    }
    return true;
  })()`);
  for (const [name, y] of [['exp-y0', 0], ['exp-y-minus700', -700]]) {
    await evaluate(`(async () => {
      const editor = window.rpenMods.editor;
      const next = structuredClone(editor.chart);
      const line = next.judgeLineList[0];
      const ev = value => ({ startTime: [0, 0, 1], endTime: [0, 0, 1], start: value, end: value, easingType: 1, easingLeft: 0, easingRight: 1, bezier: 0, bezierPoints: [0, 0, 1, 1], linkgroup: 0 });
      line.eventLayers[0].moveYEvents = [ev(${y})];
      line.eventLayers[0].moveXEvents = [ev(0)];
      line.eventLayers[0].rotateEvents = [ev(0)];
      editor.commit('exp', next);
      editor.selectLine(0);
      editor.setPreview(true, { stay: true });
      editor.seek(1, { pause: true });
      window.__lineCalls = 0;
      editor.invalidate();
      await new Promise(resolve => setTimeout(resolve, 1200));
      return true;
    })()`);
    await sleep(500);
    console.log(name, JSON.stringify(await evaluate(`(() => ({ lineCalls: window.__lineCalls, y: window.rpenMods.editor.chart.judgeLineList[0].eventLayers[0].moveYEvents[0]?.start }))()`)));
    await shot(`${name}.png`);
  }
} catch (error) { console.log('FAILED', String(error?.stack ?? error)); process.exitCode = 1; }
finally { try { await send('Page.close'); } catch { } ws.close(); }
