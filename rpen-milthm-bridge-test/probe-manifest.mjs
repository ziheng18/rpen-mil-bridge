// Verify the packaged manifest after installing it into a live RPEN:
//   - version matches the expected one,
//   - the mod loads,
//   - the manifest description stays a short introduction (no per-version changelog),
//   - name/id and the 14 settings are intact.
//
// Expects RPEN on :4173 and headless Edge CDP on :9333.
import fs from 'node:fs';
import path from 'node:path';

const CDP = 9333;
const PAGE = 'http://127.0.0.1:4173/';
const WORK = 'E:\\File\\deepseek harness\\mil';
const OUT = path.join(WORK, 'rpen-milthm-bridge-test', 'manifest');
const MOD = path.join(WORK, 'rpen-milthm-bridge', 'milthm-fmt2-bridge.rpenmod');
const EXPECTED_VERSION = '0.7.20';
const EXPECTED_AUTHOR = 'ziheng';
const MAX_ZH = 400;
const MAX_EN = 900;
fs.mkdirSync(OUT, { recursive: true });

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const fetchJson = async (url, options) => JSON.parse(await (await fetch(url, options)).text());
const target = await fetchJson(`http://127.0.0.1:${CDP}/json/new?${encodeURIComponent(PAGE)}`, { method: 'PUT' });
const ws = new WebSocket(target.webSocketDebuggerUrl);
const pending = new Map(); let messageId = 0;
const exceptions = [];
function send(method, params = {}) { return new Promise((resolve, reject) => { const id = ++messageId; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })); }); }
ws.onmessage = event => {
  const message = JSON.parse(event.data);
  if (message.id && pending.has(message.id)) { const entry = pending.get(message.id); pending.delete(message.id); message.error ? entry.reject(new Error(JSON.stringify(message.error))) : entry.resolve(message.result); return; }
  if (message.method === 'Runtime.exceptionThrown') exceptions.push((message.params.exceptionDetails?.exception?.description ?? message.params.exceptionDetails?.text ?? '').slice(0, 400));
};
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = () => reject(new Error('ws error')); });
await send('Runtime.enable'); await send('Page.enable');
const evaluate = async expression => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
  return r.result?.value;
};
const waitFor = async (expression, timeout = 60000, label = 'wait') => {
  const start = Date.now();
  while (Date.now() - start < timeout) { try { const value = await evaluate(expression); if (value) return value; } catch { } await sleep(250); }
  throw new Error('timeout: ' + label);
};

try {
  await waitFor(`(async () => { if (!window.rpenMods?.manager) return null; await window.rpenMods.manager.ready; return true; })()`);
  const modBase64 = fs.readFileSync(MOD).toString('base64');
  const info = await evaluate(`(async () => {
    const manager = window.rpenMods.manager;
    window.confirm = () => true; manager.review = async () => true;
    if (manager.runtime.loaded.has('milthm-fmt2-bridge')) await manager.disable('milthm-fmt2-bridge');
    const bytes = Uint8Array.from(atob(${JSON.stringify(modBase64)}), c => c.charCodeAt(0));
    await manager.importFiles([new File([bytes], 'milthm-fmt2-bridge.rpenmod')]);
    await manager.enable('milthm-fmt2-bridge');
    await new Promise(resolve => setTimeout(resolve, 1200));
    const record = manager.records.get('milthm-fmt2-bridge');
    const manifest = record?.manifest ?? {};
    const description = manifest.description ?? {};
    return {
      version: manifest.version,
      loaded: manager.runtime.loaded.get('milthm-fmt2-bridge')?.status,
      nameZh: manifest.name?.['zh-CN'] ?? null,
      nameEn: manifest.name?.['en-US'] ?? null,
      authorZh: manifest.author?.['zh-CN'] ?? null,
      authorEn: manifest.author?.['en-US'] ?? null,
      settings: Object.keys(manifest.settings ?? {}).length,
      zhLength: description['zh-CN']?.length ?? null,
      enLength: description['en-US']?.length ?? null,
      zh: description['zh-CN'] ?? null,
      mentionsVersions: /v0\.\d+\.\d+/.test(description['zh-CN'] ?? '') || /v0\.\d+\.\d+/.test(description['en-US'] ?? ''),
    };
  })()`);
  const result = {
    ...info,
    expectedVersion: EXPECTED_VERSION,
    expectedAuthor: EXPECTED_AUTHOR,
    maxZh: MAX_ZH,
    maxEn: MAX_EN,
    exceptions: exceptions.length,
  };
  result.ok = info.version === EXPECTED_VERSION && info.loaded === 'loaded'
    && info.nameEn === 'Milthm fmt=2 Bridge' && info.settings === 14
    && info.zhLength > 0 && info.zhLength <= MAX_ZH && info.enLength > 0 && info.enLength <= MAX_EN
    && info.authorZh === EXPECTED_AUTHOR && info.authorEn === EXPECTED_AUTHOR
    && info.mentionsVersions === false && exceptions.length === 0;
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify({ result, info }, null, 2));
  console.log(JSON.stringify(result, null, 1));
  if (!result.ok) process.exitCode = 1;
  try { await send('Page.close'); } catch { }
  ws.close();
} catch (error) {
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify({ error: String(error?.stack ?? error), exceptions }, null, 2));
  console.log('PROBE ERROR', String(error?.stack ?? error));
  process.exitCode = 1;
  try { ws.close(); } catch { }
}

