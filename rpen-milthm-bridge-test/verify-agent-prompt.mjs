// Verify the patched RPEN agent prompt in the running editor:
//  1. DEFAULT_AGENT_PROMPT from src/core/agent-prompt.mjs contains the Milthm section;
//  2. src/ui/agent-panel.mjs `agentSettings()` upgrades the previous stock default prompt to the
//     new default, while a user-customised prompt is preserved.
import fs from 'node:fs';
import path from 'node:path';

const CDP = 9333;
const PAGE = 'http://127.0.0.1:4173/';
const WORK = 'E:\\File\\deepseek harness\\mil';
const OUT = path.join(WORK, 'rpen-milthm-bridge-test', 'agent-prompt');
const BACKUP = path.join(process.env.TEMP, 'rpen-agent-prompt-backup');

// Extract the *previous* zh/en defaults from the backups to feed the migration test.
const decodePrompt = file => {
  const text = fs.readFileSync(file, 'utf8');
  const marker = "'agent-prompt.s0f270aa': \"";
  const start = text.indexOf(marker) + marker.length;
  let index = start, raw = '';
  while (index < text.length) {
    if (text[index] === '\\') { raw += text.slice(index, index + 2); index += 2; continue; }
    if (text[index] === '"') break;
    raw += text[index++];
  }
  return JSON.parse(`"${raw}"`);
};
const oldZh = decodePrompt(path.join(BACKUP, 'zh-CN.mjs'));
const oldEn = decodePrompt(path.join(BACKUP, 'en-US.mjs'));

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

const report = { steps: [], exceptions };
const step = (name, data) => { report.steps.push({ name, data }); console.log('STEP', name, JSON.stringify(data).slice(0, 600)); };

try {
  await waitFor(`(() => Boolean(window.rpenMods || document.querySelector('#ai-tool') || window.rpen))()`);
  await sleep(1200);
  const promptInfo = await evaluate(`(async () => {
    const { DEFAULT_AGENT_PROMPT } = await import('/src/core/agent-prompt.mjs');
    const markers = ['Milthm 轨道式谱面', 'Milthm track charts'];
    return {
      length: DEFAULT_AGENT_PROMPT.length,
      hit: markers.find(marker => DEFAULT_AGENT_PROMPT.includes(marker)) ?? null,
      laneLock: DEFAULT_AGENT_PROMPT.includes('车道锁定') || DEFAULT_AGENT_PROMPT.includes('Lane lock'),
      xMilthm: DEFAULT_AGENT_PROMPT.includes('x-milthm'),
      exportHint: DEFAULT_AGENT_PROMPT.includes('Milthm · chart.json'),
    };
  })()`);
  step('default-prompt', promptInfo);

  const oldZhJson = JSON.stringify(oldZh);
  const oldEnJson = JSON.stringify(oldEn);
  // The stock-prompt upgrade lives in the AgentPanel constructor (not agentSettings), so verify the
  // registered [length, fingerprint] pairs directly against the served module source.
  const fingerprint = text => {
    let value = 2166136261;
    for (const character of text) value = Math.imul(value ^ character.charCodeAt(0), 16777619);
    return value >>> 0;
  };
  const oldEntries = [
    { locale: 'zh-CN', length: oldZh.length, hash: fingerprint(oldZh) },
    { locale: 'en-US', length: oldEn.length, hash: fingerprint(oldEn) },
  ];
  const migration = await evaluate(`(async () => {
    const response = await fetch('/src/ui/agent-panel.mjs');
    const source = await response.text();
    const lengthsLine = source.split('\\n').find(line => line.includes('includes(saved.prompt.length)')) ?? '';
    const lengthsMatch = lengthsLine.match(/\\[(\\d+(?:, \\d+)*)\\]\\.includes/);
    const lengths = lengthsMatch ? lengthsMatch[1].split(', ').map(Number) : [];
    const pairsMatch = source.match(/\\[\\[\\d+, \\d+\\](?:, \\[\\d+, \\d+\\])*\\]\\.some/);
    const pairs = pairsMatch ? [...pairsMatch[0].matchAll(/\\[(\\d+), (\\d+)\\]/g)].map(match => [Number(match[1]), Number(match[2])]) : [];
    const panel = await import('/src/ui/agent-panel.mjs');
    const current = panel.DEFAULT_AGENT_SETTINGS.prompt;
    return {
      lengths,
      pairs,
      currentLength: current.length,
      customKept: panel.agentSettings({ prompt: '我的自定义提示词', uiVersion: 5 }).prompt === '我的自定义提示词',
      freshIsCurrent: panel.agentSettings({ uiVersion: 5 }).prompt === current,
    };
  })()`);
  const registered = oldEntries.map(entry => ({
    ...entry,
    lengthListed: migration.lengths.includes(entry.length),
    pairListed: migration.pairs.some(([length, hash]) => length === entry.length && hash === entry.hash),
    customLengthListed: migration.lengths.includes('我的自定义提示词'.length),
  }));
  step('migration-table', { oldEntries, registered, currentLength: migration.currentLength });

  // UI: open the AI panel, click its configure button, and read the prompt textarea
  // (`#ai-config textarea.agent-system-prompt`, value = panel.settings.prompt).
  const uiPrompt = await evaluate(`(async () => {
    document.querySelector('#ai-tool')?.click();
    await new Promise(resolve => setTimeout(resolve, 900));
    const buttons = [...document.querySelectorAll('#ai-panel button')];
    const configure = buttons.find(node => /配置|Configure|设置/.test(node.textContent ?? '')) ?? null;
    configure?.click();
    await new Promise(resolve => setTimeout(resolve, 1200));
    const dialog = document.querySelector('#ai-config');
    const area = document.querySelector('#ai-config textarea.agent-system-prompt') ?? dialog?.querySelector('textarea');
    const value = area?.value ?? null;
    return {
      panelButtons: buttons.length,
      configureFound: Boolean(configure),
      dialogOpen: Boolean(dialog?.open),
      hasPrompt: typeof value === 'string' && (value.includes('Milthm 轨道式谱面') || value.includes('Milthm track charts')),
      promptLength: typeof value === 'string' ? value.length : null,
    };
  })()`);
  step('ui-prompt', uiPrompt);
  await evaluate(`(() => { document.querySelector('#ai-config')?.close?.(); return true; })()`);

  const result = {
    promptLength: promptInfo.length,
    marker: promptInfo.hit,
    hasLaneLock: promptInfo.laneLock,
    hasXMilthm: promptInfo.xMilthm,
    hasExportHint: promptInfo.exportHint,
    oldDefaultsRegistered: registered.every(entry => entry.lengthListed && entry.pairListed),
    registered: registered.map(entry => ({ locale: entry.locale, length: entry.length, hash: entry.hash, lengthListed: entry.lengthListed, pairListed: entry.pairListed })),
    customPromptUnaffected: migration.customKept && !registered.some(entry => entry.customLengthListed),
    freshProfileUsesNewDefault: migration.freshIsCurrent,
    uiShowsPrompt: uiPrompt.hasPrompt,
    uiTextareaCount: uiPrompt.textareaCount,
    exceptions: exceptions.length,
  };
  result.ok = Boolean(result.marker) && result.hasLaneLock && result.hasXMilthm && result.hasExportHint
    && result.oldDefaultsRegistered && result.customPromptUnaffected && result.freshProfileUsesNewDefault
    && result.uiShowsPrompt && result.exceptions === 0;
  report.result = result;
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
  console.log('RESULT', JSON.stringify(result, null, 1));
  if (!result.ok) process.exitCode = 1;
} catch (error) {
  report.error = String(error?.stack ?? error);
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
  console.log('VERIFY ERROR', report.error);
  process.exitCode = 1;
} finally {
  try { await send('Page.close'); } catch { }
  ws.close();
}
