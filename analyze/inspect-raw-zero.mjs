import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

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
const chart = JSON.parse(chartBytes.toString('utf8'));
const beatOf = t => Number(t[0]) + Number(t[1]) / Number(t[2]);
const lineIndex = 7;
const line = chart.lines.find(entry => entry.index === 7) ?? chart.lines[lineIndex];
console.log('line index', line?.index, 'animations', line?.animations?.length);
const type2 = (line.animations ?? []).filter(animation => Number(animation.type) === 2 && Number(animation.bearer_type) === 0);
console.log('type2 line animations:', type2.length);
const around = type2.filter(animation => beatOf(animation.startTime) > 7.4 && beatOf(animation.startTime) < 9.6);
console.log('around 7.4..9.6:', JSON.stringify(around, null, 2));
console.log('all zero-duration type2 count:', type2.filter(animation => Math.abs(beatOf(animation.startTime) - beatOf(animation.endTime)) < 1e-9).length);
console.log('zero-duration examples:', JSON.stringify(type2.filter(animation => Math.abs(beatOf(animation.startTime) - beatOf(animation.endTime)) < 1e-9).slice(0, 5), null, 2));
// also total zero-duration animations across all lines/types
let zeroAll = 0, total = 0;
for (const entry of chart.lines) for (const animation of entry.animations ?? []) {
  total++;
  if (Math.abs(beatOf(animation.startTime) - beatOf(animation.endTime)) < 1e-9) zeroAll++;
}
console.log('all animations', total, 'zero-duration', zeroAll);
