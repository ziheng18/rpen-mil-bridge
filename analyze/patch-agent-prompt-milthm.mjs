// Patch the built-in RPEN AI agent system prompt with Milthm fmt=2 bridge knowledge.
//
// Why: the stock prompt describes the Phigros/RPE model only (free judgment lines, flick notes,
// 29 easings) while a chart imported through this mod is track-based Milthm data with a second
// semantic layer (`x-milthm`). Without this section the built-in agent happily edits the native
// display columns (which do not reach the semantics), clears `x-milthm`, or asks for free note X.
//
// Where: `analyze/rpe-next` (the local RPEN checkout, not tracked by this repo) contains
//   - src/locales/{zh-CN,en-US}.mjs  -> key `agent-prompt.s0f270aa`
//   - src/ui/agent-panel.mjs         -> list of old default prompts that are auto-upgraded to the
//                                       current default when the user never customised them.
// This script inserts the section, and registers the *previous* defaults in that migration list so
// an already-saved stock prompt is replaced by the new default on next load (custom prompts are
// left untouched because their length/hash do not match).
//
// Usage (from anywhere):
//   node analyze/patch-agent-prompt-milthm.mjs          # apply (idempotent)
//   node analyze/patch-agent-prompt-milthm.mjs --check  # verify only, exit 1 when not applied
//
// Re-run it after re-cloning/upgrading RPEN: `analyze/rpe-next` is gitignored, the patch is not.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const RPE_DIR = path.join(here, 'rpe-next');
const LOCALE_FILES = {
  'zh-CN': path.join(RPE_DIR, 'src', 'locales', 'zh-CN.mjs'),
  'en-US': path.join(RPE_DIR, 'src', 'locales', 'en-US.mjs'),
};
const PANEL_FILE = path.join(RPE_DIR, 'src', 'ui', 'agent-panel.mjs');
const PROMPT_KEY = 'agent-prompt.s0f270aa';

/* ---------------- section text ---------------- */
const MARKERS = {
  'zh-CN': 'Milthm 轨道式谱面（由内置',
  'en-US': 'Milthm track charts (fmt=2',
};
const ANCHORS = {
  'zh-CN': '音乐与视觉的专业判断',
  'en-US': 'Professional judgment for music and visuals',
};
const SECTIONS = {
  'zh-CN': `
- Milthm 轨道式谱面（由内置「Milthm 自制谱桥接」模组导入的 fmt=2 谱面）：\`chart['x-milthm']\` 存在即表示这是 Milthm 谱面，判定线就是轨道，音符只落在轨道中心。
  · 两层数据：原生 5 列（moveXEvents/moveYEvents/rotateEvents/alphaEvents/speedEvents）只是显示槽位，真实语义在每条线的 \`x-milthm.events\`（x/y/rotate/lineAlpha/bodyAlpha/headAlpha/wholeAlpha/flowSpeed/size/speed/flowRaw 等）与 \`x-milthm.channels\`，列映射在 \`chart['x-milthm'].columns\`。只改原生列不会同步语义——应通过模组的列下拉/通道面板修改，或同时改写 \`x-milthm.events\` 再提交；否则预览与导出仍是旧值。
  · 不要删除或重建 \`x-milthm\` 及其中的 rawExtras/channels/音符级动画/故事板图层：它们保存源谱专有数据，删除会破坏「未编辑时导出 0 diff」并丢数据。通用 chart 命令必须保留未知字段。
  · 车道锁定（设置默认开启）：每次提交会把音符 positionX 压回 0、above 压回 1，并把 speed/size/alpha/yOffset/visibleTime 压回默认。Milthm 谱里不要写自由 X 或自定义音符属性；父线 father 会保留（导出时压平），但 Milthm 本身没有线层级。
  · Milthm 事件类型：0=X、1=Y、2=轨道整体透明度、3=大小、4=旋转、5=流速倍率、8=线体不透明度、9=线头不透明度、12=Speed（积分成落速）、13=整体不透明度（只作用于该线音符）、22=颜色；音符只有 Hit(0)/Drag(1) 加 isFake/isAlwaysPerfect，没有 Flick（导出会降级为 Hit）。Speed 与 FlowSpeed 不是一回事：Speed 决定音符位置，FlowSpeed 是视觉流速倍率，不要混用。
  · 新增/删除判定线等于增删轨道；「＋新增」后模组会自动补语义列，初始化是幂等的，不要手工清空，也不要靠反复提交去触发初始化。
  · 预览会把 Speed(12)×流速倍率(5) 合成一条速度轨道，并叠加模组「全局流速」设置；这些只影响预览，不改谱面数据与导出。
  · 导出：使用原生「导出」对话框选 \`Milthm · chart.json\` 或 \`Milthm · 谱面包 zip\`（模组命令导出也可）。导出只读语义数据；颜色只保留 RGB（alpha 丢失）；文本线/贴图线会转成 Milthm 故事板（近似）；父子线与多事件层会压平并在提示里说明；噪域、倾斜(incline)、着色器(paint)、GIF 没有 Milthm 对应，会被忽略并提示。
  · 音符级动画只有不透明度与 FlowSpeed 参与预览，其余（位置/旋转/大小/颜色/音符级 Speed）只原样暂存、不能在 RPEN 里编辑。`,
  'en-US': `
- Milthm track charts (fmt=2 charts imported through the bundled "Milthm fmt=2 Bridge" mod): \`chart['x-milthm']\` marks such a chart; a judgment line is a track and notes sit only at the track center.
  · Two data layers: the native five columns (moveXEvents/moveYEvents/rotateEvents/alphaEvents/speedEvents) are only display slots; the real semantics live in each line's \`x-milthm.events\` (x/y/rotate/lineAlpha/bodyAlpha/headAlpha/wholeAlpha/flowSpeed/size/speed/flowRaw ...) and \`x-milthm.channels\`, with the column mapping in \`chart['x-milthm'].columns\`. Editing a native column alone does not update the semantics — use the mod's column dropdown / channel panel, or write \`x-milthm.events\` as well before committing; otherwise preview and export keep the old values.
  · Never delete or rebuild \`x-milthm\` (rawExtras, channels, note-level animations, storyboard layers): it stores source-chart data, and removing it breaks the "untouched chart exports with 0 diff" guarantee and loses data. Generic chart commands must preserve unknown fields.
  · Lane lock (enabled by default): every commit forces note positionX to 0, above to 1, and speed/size/alpha/yOffset/visibleTime back to their defaults. Do not write free note X or custom note properties in a Milthm chart; \`father\` is kept (flattened on export), but Milthm itself has no line hierarchy.
  · Milthm animation types: 0 = X, 1 = Y, 2 = line transparency, 3 = size, 4 = rotation, 5 = flow speed, 8 = line body, 9 = line head, 12 = Speed (integrated into the fall distance), 13 = whole transparency (notes only), 22 = color; notes are only Hit(0)/Drag(1) plus isFake/isAlwaysPerfect, there is no Flick (export downgrades it to Hit). Speed and FlowSpeed are different: Speed moves the notes, FlowSpeed is a visual speed multiplier — do not mix them up.
  · Adding or removing a judgment line adds or removes a track; after "＋新增" the mod re-adds the semantic columns with an idempotent initializer, so do not clear it by hand and do not rely on repeated commits to trigger it.
  · The preview composes Speed(12) × FlowSpeed(5) into one speed track and multiplies the mod's global flow speed setting; these only affect the preview, not the chart data or the export.
  · Export: use the native Export dialog with \`Milthm · chart.json\` or \`Milthm · chart package zip\` (the mod's export commands work too). Export reads the semantic data only; colors keep RGB only (alpha is lost); text and picture lines become Milthm storyboards (approximate); parent lines and extra event layers are flattened and reported in the warnings; noise areas, incline, paint and GIF have no Milthm equivalent and are skipped with a warning.
  · Note-level animations: only transparency and FlowSpeed take part in the preview; the rest (position/rotation/size/color/note-level Speed) are preserved verbatim but cannot be edited in RPEN.`,
};

/* ---------------- helpers ---------------- */
const read = file => fs.readFileSync(file, 'utf8');

/** Locate the raw (still escaped) value of `'key': "...."` in a locale file. */
function findPromptLiteral(text, key) {
  const marker = `'${key}': "`;
  const start = text.indexOf(marker);
  if (start < 0) throw new Error(`prompt key not found: ${key}`);
  const valueStart = start + marker.length;
  let index = valueStart;
  while (index < text.length) {
    const char = text[index];
    if (char === '\\') { index += 2; continue; }
    if (char === '"') break;
    index += 1;
  }
  if (index >= text.length) throw new Error(`unterminated prompt string: ${key}`);
  return { quoteStart: valueStart - 1, rawStart: valueStart, rawEnd: index, raw: text.slice(valueStart, index) };
}

/** Decode/encode the JS double-quoted literal the locale files use (JSON-compatible escapes). */
const decodeLiteral = raw => JSON.parse(`"${raw}"`);
const encodeLiteral = value => JSON.stringify(value).slice(1, -1);

/** FNV-1a 32-bit, same fingerprint as src/ui/agent-panel.mjs. */
function promptFingerprint(text) {
  let fingerprint = 2166136261;
  for (const character of text) fingerprint = Math.imul(fingerprint ^ character.charCodeAt(0), 16777619);
  return fingerprint >>> 0;
}

function patchPromptFile(locale, { check }) {
  const file = LOCALE_FILES[locale];
  const text = read(file);
  const literal = findPromptLiteral(text, PROMPT_KEY);
  const current = decodeLiteral(literal.raw);
  const marker = MARKERS[locale];
  const already = current.includes(marker);
  if (check) {
    return { locale, already, length: current.length, previous: current };
  }
  if (already) return { locale, already, length: current.length, skipped: true };
  // The locale strings use CRLF inside the prompt; keep the inserted block consistent and anchor
  // on the section heading itself (blank-line count differs between locales).
  const newline = current.includes('\r\n') ? '\r\n' : '\n';
  const anchor = `${newline}${newline}${ANCHORS[locale]}`;
  const anchorAt = current.indexOf(anchor);
  if (anchorAt < 0) throw new Error(`${locale}: section anchor not found, prompt layout changed`);
  const section = SECTIONS[locale].replace(/\r?\n/g, newline);
  const patched = `${current.slice(0, anchorAt)}${section}${current.slice(anchorAt)}`;
  const updated = `${text.slice(0, literal.rawStart)}${encodeLiteral(patched)}${text.slice(literal.rawEnd)}`;
  fs.writeFileSync(file, updated, 'utf8');
  return { locale, already: false, length: patched.length, previousLength: current.length, previous: current };
}

/** Register the previous stock defaults so saved stock prompts upgrade to the new default. */
function patchMigrationList(previousDefaults) {
  const text = read(PANEL_FILE);
  const entries = Object.values(previousDefaults).filter(Boolean).map(prompt => [prompt.length, promptFingerprint(prompt)]);
  const missing = entries.filter(([length]) => !new RegExp(`\\b${length}\\b`).test(text.split('\n').find(line => line.includes('includes(saved.prompt.length)')) ?? ''));
  if (!missing.length) return { changed: false, entries };
  const lengthsLine = text.split('\n').find(line => line.includes('includes(saved.prompt.length)'));
  const lengthsArray = lengthsLine.match(/\[(\d+(?:, \d+)*)\]\.includes/);
  if (!lengthsArray) throw new Error('migration length array not found in agent-panel.mjs');
  const newLengths = lengthsArray[1] + missing.map(([length]) => `, ${length}`).join('');
  let updated = text.replace(lengthsArray[0], `[${newLengths}].includes`);
  const pairs = text.match(/\[\[\d+, \d+\](?:, \[\d+, \d+\])*\]\.some/);
  if (!pairs) throw new Error('migration fingerprint array not found in agent-panel.mjs');
  const newPairs = pairs[0].slice(0, -']'.length - '.some'.length) + missing.map(([length, hash]) => `, [${length}, ${hash}]`).join('') + '].some';
  updated = updated.replace(pairs[0], newPairs);
  fs.writeFileSync(PANEL_FILE, updated, 'utf8');
  return { changed: true, entries: missing };
}

/* ---------------- main ---------------- */
const checkOnly = process.argv.includes('--check');
if (!fs.existsSync(RPE_DIR)) {
  console.error(`RPEN checkout not found: ${RPE_DIR}`);
  process.exit(1);
}
const results = {};
let allApplied = true;
for (const locale of Object.keys(LOCALE_FILES)) {
  results[locale] = patchPromptFile(locale, { check: checkOnly });
  allApplied = allApplied && results[locale].already;
}
if (!checkOnly) {
  const previous = {};
  for (const [locale, result] of Object.entries(results)) if (!result.skipped) previous[locale] = result.previous;
  const migration = patchMigrationList(previous);
  console.log(`migration list: ${migration.changed ? 'updated' : 'already up to date'}`);
  for (const [length, hash] of migration.entries) console.log(`  stock default ${length} chars / hash ${hash} -> upgrades to new default`);
}
for (const [locale, result] of Object.entries(results)) {
  const status = checkOnly ? (result.already ? 'section present' : 'section MISSING') : (result.already ? 'section present' : 'section inserted');
  console.log(`${locale}: ${status} (prompt now ${result.length} chars${result.previousLength ? `, was ${result.previousLength}` : ''})`);
}
if (checkOnly && !allApplied) {
  console.error('check failed: prompt section missing');
  process.exit(1);
}
