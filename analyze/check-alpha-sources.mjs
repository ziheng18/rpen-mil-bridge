import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { importMilthmChart } from '../rpen-milthm-bridge/convert.mjs';

const root = 'E:\\File\\deepseek harness\\mil';
const zipName = fs.readdirSync(root).find(name => /^Class.Memories\.zip$/i.test(name));
const buffer = fs.readFileSync(path.join(root, zipName));
const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
let eocd = -1;
for (let i = buffer.length - 22; i >= 0; i--) if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
const count = view.getUint16(eocd + 10, true); let offset = view.getUint32(eocd + 16, true);
let chartBytes = null;
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
  if (name === 'chart.json') chartBytes = data;
}
const source = JSON.parse(chartBytes.toString('utf8'));
const { chart } = importMilthmChart(source, {});
for (const [index, line] of chart.judgeLineList.slice(0, 5).entries()) {
  const stash = line['x-milthm'] ?? {};
  console.log(index, 'primaryAlpha', stash.primaryAlphaType, 'primarySpeed', stash.primarySpeedType,
    '| alphaEvents', line.eventLayers[0].alphaEvents.length,
    'speedEvents', line.eventLayers[0].speedEvents.length,
    '| body', stash.channels?.bodyAlpha?.length ?? 0,
    'head', stash.channels?.headAlpha?.length ?? 0,
    'whole', stash.channels?.wholeAlpha?.length ?? 0,
    'flow', stash.channels?.flowSpeed?.length ?? 0,
    '| scaleX', line.extended?.scaleXEvents?.length ?? 0,
    'moveX', line.eventLayers[0].moveXEvents.length,
    'moveY', line.eventLayers[0].moveYEvents.length,
    'rotate', line.eventLayers[0].rotateEvents.length);
}
const totals = { body: 0, head: 0, whole: 0, flow: 0, alpha: 0, speed: 0 };
for (const line of chart.judgeLineList) {
  const stash = line['x-milthm'] ?? {};
  totals.alpha += line.eventLayers[0].alphaEvents.length;
  totals.speed += line.eventLayers[0].speedEvents.length;
  totals.body += stash.channels?.bodyAlpha?.length ?? 0;
  totals.head += stash.channels?.headAlpha?.length ?? 0;
  totals.whole += stash.channels?.wholeAlpha?.length ?? 0;
  totals.flow += stash.channels?.flowSpeed?.length ?? 0;
}
console.log('totals', JSON.stringify(totals));
