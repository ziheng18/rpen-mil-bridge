import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { importMilthmChart } from '../rpen-milthm-bridge/convert.mjs';

const WORK = 'E:\\File\\deepseek harness\\mil';
const zipName = fs.readdirSync(WORK).find(name => /^Class.Memories\.zip$/i.test(name));
const buffer = fs.readFileSync(path.join(WORK, zipName));
const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
let eocd = -1; for (let i = buffer.length - 22; i >= 0; i--) if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
const count = view.getUint16(eocd + 10, true); let offset = view.getUint32(eocd + 16, true); let chartBytes = null;
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
const beatOf = t => Number(t[0]) + Number(t[1]) / Number(t[2]);
const at = (events, beat) => {
  const sorted = [...(events ?? [])].sort((a, b) => beatOf(a.startTime) - beatOf(b.startTime));
  let chosen = null;
  for (const event of sorted) if (beatOf(event.startTime) <= beat) chosen = event;
  if (!chosen) return null;
  const p = beatOf(chosen.endTime) > beatOf(chosen.startTime)
    ? Math.max(0, Math.min(1, (beat - beatOf(chosen.startTime)) / (beatOf(chosen.endTime) - beatOf(chosen.startTime)))) : 1;
  return Number(chosen.start) + (Number(chosen.end) - Number(chosen.start)) * p;
};
const beat = 8.75;
for (const [index, line] of chart.judgeLineList.entries()) {
  const layer = line.eventLayers?.[0] ?? {};
  console.log(index, 'rotation', Math.round((at(layer.rotateEvents, beat) ?? 0) * 10) / 10, 'y', Math.round(at(layer.moveYEvents, beat) ?? 0), 'x', Math.round(at(layer.moveXEvents, beat) ?? 0), 'notes', line.notes?.length);
}
