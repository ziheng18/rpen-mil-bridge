import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { importMilthmChart } from '../rpen-milthm-bridge/convert.mjs';
import { ensureChartColumns, syncMilthmColumns, remapColumns, semanticEvents } from '../rpen-milthm-bridge/columns.mjs';
import { EventTrack } from '../analyze/rpe-next/src/core/events.mjs';
import { TempoMap } from '../analyze/rpe-next/src/core/tempo.mjs';

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
const ensured = ensureChartColumns(chart);
let synced = syncMilthmColumns(ensured);
synced = syncMilthmColumns(remapColumns(synced, 3, 'lineAlpha'));
const tempo = new TempoMap(synced.BPMList);
const beatOf = time => Number(time[0]) + Number(time[1]) / Number(time[2]);

const lineIndex = 7;
const chart2 = structuredClone(synced);
const line = chart2.judgeLineList[lineIndex];
const layer = line.eventLayers[0];
const newEvent = { startTime: [8, 3, 4], endTime: [8, 7, 8], start: 0, end: 0, easingType: 1, easingLeft: 0, easingRight: 1, bezier: 0, bezierPoints: [0, 0, 1, 1], linkgroup: 0 };
// simulate a timeline insertion that lands BEFORE the imported zero-length 0->1 event at the same beat
const sameStart = layer.alphaEvents.findIndex(event => Math.abs(beatOf(event.startTime) - 8.75) < 1e-9);
const insertAt = sameStart >= 0 ? sameStart : layer.alphaEvents.length;
layer.alphaEvents = [...layer.alphaEvents.slice(0, insertAt), newEvent, ...layer.alphaEvents.slice(insertAt)];
line['x-milthm'].applied = null;
const after = syncMilthmColumns(chart2);
const semantics = semanticEvents(after.judgeLineList[lineIndex]);
const alpha = semantics.lineAlpha;
console.log('insertAt', insertAt, 'events', alpha.length);
console.log('event order around 8.75:', alpha.filter(event => Math.abs(beatOf(event.startTime) - 8.75) < 1e-9).map(event => ({ start: event.start, end: event.end, startTime: event.startTime, endTime: event.endTime })));
const track = new EventTrack(alpha.map(event => ({
  startTime: event.startTime, endTime: event.endTime,
  start: Number(event.start) * 255, end: Number(event.end) * 255,
  easingType: 1, easingLeft: 0, easingRight: 1, bezier: 0, bezierPoints: [0, 0, 1, 1],
})), tempo, 1, 255);
const seconds = tempo.seconds(8.75, 1);
console.log('alpha at beat 8.75 seconds', seconds, '=', track.value(seconds), '(expected 0)');
console.log('alpha just before 8.75 =', track.value(seconds - 0.001));
