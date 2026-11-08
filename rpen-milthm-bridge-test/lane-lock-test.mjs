// Offline regression for the lane-lock scope (bug: normal RPE charts were force-normalized).
//
// The Milthm lane lock is a track invariant that may only touch charts imported through the
// fmt=2 bridge. In v0.7.18 the session:before-commit hook called normalizeLaneChart() for every
// chart, so a plain RPE chart lost its note X/above, bpmfactor and custom line textures on each
// commit (which is also why the preview ignored a changed judgment-line texture).
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { importMilthmChart, normalizeLaneChart } from '../rpen-milthm-bridge/convert.mjs';

const WORK = 'E:\\File\\deepseek harness\\mil';
const canon = value => Array.isArray(value) ? value.map(canon)
  : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canon(value[key])]))
    : value;
const sameJson = (a, b) => JSON.stringify(canon(a)) === JSON.stringify(canon(b));

function readZipChart(file) {
  const buffer = fs.readFileSync(file);
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  let eocd = -1;
  for (let i = buffer.length - 22; i >= 0; i--) if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  const count = view.getUint16(eocd + 10, true); let offset = view.getUint32(eocd + 16, true);
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
    if (name === 'chart.json') return JSON.parse(data.toString('utf8'));
  }
  throw new Error('chart.json missing');
}

const failures = [];
const check = (name, condition, detail = '') => { if (condition) console.log('PASS', name); else { failures.push(name + (detail ? ' — ' + detail : '')); console.log('FAIL', name, detail); } };

/* ---------------- 1) plain RPE chart must be untouched (lane lock on) ---------------- */
const note = { type: 1, positionX: 123, above: -1, startTime: [0, 0, 1], endTime: [0, 0, 1], speed: 1, size: 1, alpha: 255, visibleTime: 999999, yOffset: 0 };
const plain = {
  META: { RPEVersion: 230, offset: 0, name: 'Plain RPE' },
  BPMList: [{ bpm: 120, startTime: [0, 0, 1] }],
  judgeLineList: [{
    bpmfactor: 0.75, Texture: 'custom-line.png',
    eventLayers: [{ alphaEvents: [{ startTime: [0, 0, 1], endTime: [0, 0, 1], start: 255, end: 255, easingType: 1, easingLeft: 0, easingRight: 1 }], moveXEvents: [], moveYEvents: [], rotateEvents: [], speedEvents: [] }],
    notes: [note], extended: {},
  }],
};
const plainLocked = normalizeLaneChart(plain, { 'lane-lock': true });
check('plain RPE chart: object identity preserved', plainLocked === plain);
check('plain RPE chart: content unchanged', sameJson(plainLocked, plain));
check('plain RPE chart: note positionX stays 123', plainLocked.judgeLineList[0].notes[0].positionX === 123);
check('plain RPE chart: note above stays -1', plainLocked.judgeLineList[0].notes[0].above === -1);
check('plain RPE chart: bpmfactor stays 0.75', plainLocked.judgeLineList[0].bpmfactor === 0.75);
check('plain RPE chart: custom texture stays', plainLocked.judgeLineList[0].Texture === 'custom-line.png');
check('plain RPE chart: even non-imported chart with x-milthm kind is ignored',
  (() => { const other = structuredClone(plain); other['x-milthm'] = { kind: 'something-else' }; return normalizeLaneChart(other, { 'lane-lock': true }) === other; })());

/* ---------------- 2) imported Milthm chart still gets the lane lock ---------------- */
const zipName = fs.readdirSync(WORK).find(name => /^Class.Memories\.zip$/i.test(name));
const { chart: imported } = importMilthmChart(readZipChart(path.join(WORK, zipName)), {});
const mutated = structuredClone(imported);
const milLine = mutated.judgeLineList.find(line => (line.notes ?? []).length > 0);
const milNote = milLine.notes[0];
milLine.bpmfactor = 0.75;
milLine.Texture = 'custom-track.png';
milNote.positionX = 123;
milNote.above = -1;
const locked = normalizeLaneChart(mutated, { 'lane-lock': true });
const lockedLine = locked.judgeLineList[mutated.judgeLineList.indexOf(milLine)];
check('Milthm chart: note positionX is forced to 0', lockedLine.notes[0].positionX === 0);
check('Milthm chart: note above is forced to 1', lockedLine.notes[0].above === 1);
check('Milthm chart: bpmfactor is forced to 1', lockedLine.bpmfactor === 1);
check('Milthm chart: note-bearing line keeps its custom texture (v0.7.20)', lockedLine.Texture === 'custom-track.png');
const disabled = normalizeLaneChart(mutated, { 'lane-lock': false });
check('Milthm chart: lane lock off leaves the chart untouched', disabled === mutated);

console.log(failures.length ? `\n=== LANE LOCK TESTS FAILED (${failures.length}) ===\n  ` + failures.join('\n  ') : '\n=== LANE LOCK TESTS PASSED ===');
if (failures.length) process.exitCode = 1;
