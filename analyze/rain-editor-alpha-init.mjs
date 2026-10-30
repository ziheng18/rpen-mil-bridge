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
const beatOf = time => Number(time[0]) + Number(time[1]) / Number(time[2]);

// Faithful port of Rain Editor's ChartUtils.get_es_value() (milthm_editor.html:6512)
function raineditorGetValue(events, t, deft) {
  if (!events.length) return deft;
  let res = deft, found = false;
  if (events[events.length - 1].endTime.value <= t) return events[events.length - 1].end;
  if (events[0].startTime.value >= t) {
    return events[0].startTime.value === events[0].endTime.value ? events[0].end : events[0].start;
  }
  for (const e of events) {
    if (e.startTime.value >= t) { if (!found) res = e.start; break; }
    else if (e.endTime.value <= t) { res = e.end; found = true; }
    else if (e.startTime.value <= t && t <= e.endTime.value) {
      const p = (t - e.startTime.value) / (e.endTime.value - e.startTime.value);
      res = e.ease.doease(p, e.start, e.end); // linear here is enough for constant events
      found = true;
    }
  }
  return res;
}
// simplified linear ease (all relevant events are constant 0 or 1)
const toEvent = animation => ({ startTime: { value: beatOf(animation.startTime) }, endTime: { value: beatOf(animation.endTime) }, start: animation.start, end: animation.end,
  ease: { doease: (p, a, b) => a + (b - a) * Math.max(0, Math.min(1, p)) } });
const line = chart.lines.find(entry => entry.index === 7);
const events = line.animations.filter(animation => Number(animation.type) === 2 && Number(animation.bearer_type) === 0)
  .map(toEvent).sort((a, b) => a.startTime.value - b.startTime.value);
console.log('Rain Editor line7 Transparency(2) events:', events.length);
for (const beat of [8.74, 8.75, 8.76, 8.875, 9.0, 10.57]) {
  console.log('beat', beat, '->', raineditorGetValue(events, beat, 1));
}
// find the events around 8.75
console.log('events starting at 8.75:', events.filter(e => Math.abs(e.startTime.value - 8.75) < 1e-9).map(e => ({ start: e.start, end: e.end, startTime: e.startTime.value, endTime: e.endTime.value })));
