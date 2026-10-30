// Compare the chart.json exported from the running RPEN editor with the original Milthm chart.
// Usage: node compare-exported.mjs
import fs from 'node:fs';
import path from 'node:path';

const WORK = 'E:\\File\\deepseek harness\\mil';
const DL = path.join(WORK, 'rpen-milthm-bridge-test', 'integration', 'downloads');
const OUT = path.join(WORK, 'rpen-milthm-bridge-test', 'integration');
const beatOf = time => Number(time[0]) + Number(time[1]) / Number(time[2]);
const canon = value => Array.isArray(value) ? value.map(canon)
  : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canon(value[key])]))
    : value;
const sameJson = (a, b) => JSON.stringify(canon(a)) === JSON.stringify(canon(b));

async function readZipEntries(input) {
  const buffer = input.buffer ? input.buffer.slice(input.byteOffset, input.byteOffset + input.byteLength) : input;
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= 0; i--) if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  const count = view.getUint16(eocd + 10, true);
  let offset = view.getUint32(eocd + 16, true);
  const entries = new Map();
  for (let n = 0; n < count; n++) {
    const method = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const size = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localOffset = view.getUint32(offset + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(offset + 46, offset + 46 + nameLength));
    offset += 46 + nameLength + extraLength + commentLength;
    const localNameLength = view.getUint16(localOffset + 26, true);
    const localExtraLength = view.getUint16(localOffset + 28, true);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    let data = bytes.slice(dataStart, dataStart + compressedSize);
    if (method === 8) {
      const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
      data = new Uint8Array(await new Response(stream).arrayBuffer());
    } else if (method !== 0) throw new Error('unsupported method ' + method);
    entries.set(name, data.subarray(0, size));
  }
  return entries;
}

const originalZipName = fs.readdirSync(WORK).filter(name => /^Class.Memories\.zip$/i.test(name))[0];
const original = JSON.parse(new TextDecoder().decode((await readZipEntries(fs.readFileSync(path.join(WORK, originalZipName)))).get('chart.json')));
const exportedName = fs.readdirSync(DL).filter(name => /\.json$/i.test(name))[0];
const exported = JSON.parse(new TextDecoder().decode(fs.readFileSync(path.join(DL, exportedName))));

const diffs = [];
const push = message => diffs.push(message);

// meta (the exported chart intentionally has no `editor` block)
for (const key of ['background_dim', 'name', 'background_artist', 'music_artist', 'charter', 'difficulty_name', 'difficulty', 'offset']) {
  if (!sameJson(original.meta?.[key], exported.meta?.[key])) push(`meta.${key}: ${JSON.stringify(original.meta?.[key])} -> ${JSON.stringify(exported.meta?.[key])}`);
}
if (!sameJson(original.bpms, exported.bpms)) push(`bpms differ`);
if (!sameJson(original.storyboards, exported.storyboards)) push('storyboards differ');
if (JSON.stringify(Object.keys(exported)) !== JSON.stringify(['fmt', 'meta', 'bpms', 'lines', 'storyboards'])) push(`top-level keys: ${JSON.stringify(Object.keys(exported))}`);
if (exported.fmt !== 2) push(`fmt ${exported.fmt}`);

const originalLines = [...original.lines].sort((a, b) => a.index - b.index);
if (originalLines.length !== exported.lines.length) push(`line count ${originalLines.length} -> ${exported.lines.length}`);
for (let i = 0; i < Math.min(originalLines.length, exported.lines.length); i++) {
  const a = originalLines[i], b = exported.lines[i];
  if (a.index !== b.index) push(`line ${i}: index ${a.index} -> ${b.index}`);
  if (a.notes.length !== b.notes.length) push(`line ${i}: note count ${a.notes.length} -> ${b.notes.length}`);
  const noteKey = note => JSON.stringify([beatOf(note.time), beatOf(note.endTime), note.type, Boolean(note.isFake), Boolean(note.isAlwaysPerfect)]);
  const aNotes = a.notes.map(noteKey).sort(), bNotes = b.notes.map(noteKey).sort();
  if (!sameJson(aNotes, bNotes)) {
    push(`line ${i}: notes differ; missing=${JSON.stringify(aNotes.filter(x => !bNotes.includes(x)).slice(0, 3))} extra=${JSON.stringify(bNotes.filter(x => !aNotes.includes(x)).slice(0, 3))}`);
  }
  if (a.animations.length !== b.animations.length) push(`line ${i}: animation count ${a.animations.length} -> ${b.animations.length}`);
  const animKey = animation => JSON.stringify(canon({
    startTime: animation.startTime, endTime: animation.endTime, type: animation.type,
    start: animation.start, end: animation.end, bearer_type: animation.bearer_type, bearer: animation.bearer, ease: animation.ease,
  }));
  const aAnims = a.animations.map(animKey).sort(), bAnims = b.animations.map(animKey).sort();
  if (!sameJson(aAnims, bAnims)) {
    push(`line ${i}: animations differ; missing=${JSON.stringify(aAnims.filter(x => !bAnims.includes(x)).slice(0, 2))} extra=${JSON.stringify(bAnims.filter(x => !aAnims.includes(x)).slice(0, 2))}`);
  }
}

// exported package validation
const zipName = fs.readdirSync(DL).filter(name => /\.zip$/i.test(name))[0];
let zipReport = null;
if (zipName) {
  const entries = await readZipEntries(fs.readFileSync(path.join(DL, zipName)));
  const meta = JSON.parse(new TextDecoder().decode(entries.get('meta.json')));
  const chart = JSON.parse(new TextDecoder().decode(entries.get('chart.json')));
  const image = entries.get(meta.image_file);
  zipReport = {
    name: zipName,
    entries: [...entries.keys()],
    sizes: Object.fromEntries([...entries].map(([name, bytes]) => [name, bytes.length])),
    meta,
    chartSameAsJsonExport: sameJson(chart, exported),
    imageIsPng: image && image[0] === 0x89 && image[1] === 0x50 && image[2] === 0x4e && image[3] === 0x47,
    audioSignature: entries.get(meta.audio_file)?.slice(0, 3),
  };
}

const report = { original: { name: originalZipName, lines: originalLines.length, notes: originalLines.reduce((s, l) => s + l.notes.length, 0), animations: originalLines.reduce((s, l) => s + l.animations.length, 0) },
  exported: { name: exportedName, lines: exported.lines.length, notes: exported.lines.reduce((s, l) => s + l.notes.length, 0), animations: exported.lines.reduce((s, l) => s + l.animations.length, 0) },
  diffs, zipReport };
fs.writeFileSync(path.join(OUT, 'compare-report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
process.exitCode = diffs.length ? 1 : 0;
