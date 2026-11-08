// Offline regression: a Milthm track line may carry a custom judgement-line texture too.
//  - the commit-time lane lock must keep `Texture` (only note positionX/above/defaults are locked);
//  - export must turn that texture into a Milthm picture storyboard (type 0) while the line still
//    exports as a track with its notes, and the zip must ship the image under res/.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { importMilthmChart, exportMilthmChart, normalizeLaneChart } from '../rpen-milthm-bridge/convert.mjs';
import { ensureChartColumns, syncMilthmColumns, buildMilthmExportChart } from '../rpen-milthm-bridge/columns.mjs';

const WORK = 'E:\\File\\deepseek harness\\mil';
const TEXTURE = 'probe-line.png';
const failures = [];
const check = (name, condition, detail = '') => { if (condition) console.log('PASS', name); else { failures.push(name + (detail ? ' — ' + detail : '')); console.log('FAIL', name, detail); } };

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

const zipName = fs.readdirSync(WORK).find(name => /^Class.Memories\.zip$/i.test(name));
const { chart: imported } = importMilthmChart(readZipChart(path.join(WORK, zipName)), {});
const synced = syncMilthmColumns(ensureChartColumns(imported) ?? imported);
const lineIndex = synced.judgeLineList.findIndex(line => (line.notes ?? []).length > 0);
check('fixture: a track line with notes exists', lineIndex >= 0);
const originalNoteCount = synced.judgeLineList[lineIndex].notes.length;

const mutated = structuredClone(synced);
mutated.judgeLineList[lineIndex].Texture = TEXTURE;
mutated.judgeLineList[lineIndex].bpmfactor = 0.75;
mutated.judgeLineList[lineIndex].notes[0].positionX = 123;

/* ---------------- 1) lane lock keeps the texture, locks the notes ---------------- */
const locked = normalizeLaneChart(mutated, { 'lane-lock': true });
check('lane lock keeps the note-bearing line texture', locked.judgeLineList[lineIndex].Texture === TEXTURE);
check('lane lock still forces note positionX to 0', locked.judgeLineList[lineIndex].notes[0].positionX === 0);
check('lane lock still forces bpmfactor to 1', locked.judgeLineList[lineIndex].bpmfactor === 1);

/* ---------------- 2) export -> picture storyboard + track with notes ---------------- */
const view = buildMilthmExportChart(locked);
const { chart: exported, warnings } = exportMilthmChart(view, {});
const picture = (exported.storyboards ?? []).filter(storyboard => Number(storyboard.type) === 0 && String(storyboard.data ?? '') === TEXTURE);
check('export emits one picture storyboard for the line texture', picture.length === 1, `storyboards=${JSON.stringify((exported.storyboards ?? []).map(s => [s.type, s.data]))}`);
check('picture storyboard carries transform animations', (picture[0]?.animations ?? []).length > 0, `animations=${picture[0]?.animations?.length ?? 0}`);
const storyboardTypes = new Set((picture[0]?.animations ?? []).map(animation => Number(animation.type)));
check('picture storyboard has position/rotation animations', storyboardTypes.has(0) && storyboardTypes.has(1), [...storyboardTypes].join(','));
const exportedLine = (exported.lines ?? []).find(line => (line.notes ?? []).length === originalNoteCount);
check('the same line still exports as a track with all notes', Boolean(exportedLine));
check('export warns about the texture-to-storyboard conversion', warnings.some(warning => warning.includes('已导出为图片故事板') && warning.includes(TEXTURE)), JSON.stringify(warnings.filter(w => w.includes('故事板'))));
check('export warns that the line still exports as a track', warnings.some(warning => warning.includes('音符仍按轨道导出')), JSON.stringify(warnings.filter(w => w.includes('轨道导出'))));

console.log(failures.length ? `\n=== LINE TEXTURE TESTS FAILED (${failures.length}) ===\n  ` + failures.join('\n  ') : '\n=== LINE TEXTURE TESTS PASSED ===');
if (failures.length) process.exitCode = 1;
