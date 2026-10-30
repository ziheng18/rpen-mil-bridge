import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { importMilthmChart } from '../rpen-milthm-bridge/convert.mjs';
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
const tempo = new TempoMap(chart.BPMList);
for (const lineIndex of [0, 7, 9, 10]) {
  const line = chart.judgeLineList[lineIndex];
  const stash = line['x-milthm'] ?? {};
  // reconstruct semantic lineAlpha: legacy alphaEvents when primaryAlphaType===2
  const alphaEvents = line.eventLayers[0].alphaEvents ?? [];
  const track = new EventTrack(alphaEvents.map(event => ({ ...event, easingLeft: event.easingLeft ?? 0, easingRight: event.easingRight ?? 1 })), tempo, 1, 255);
  const atBeat = beat => {
    let seconds = 0;
    try { seconds = tempo.seconds(beat, 1); } catch { seconds = beat * 60 / 72.5; }
    return track.value(seconds);
  };
  console.log('line', lineIndex, 'primaryAlpha', stash.primaryAlphaType, 'alphaEvents', alphaEvents.length,
    'beat8.75', atBeat(8.75), 'beat8.751', atBeat(8.751), 'beat9.0', atBeat(9), 'beat10.57', atBeat(10.57));
}
