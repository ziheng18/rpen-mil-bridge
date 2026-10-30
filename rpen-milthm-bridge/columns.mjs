// Milthm event-column model.
//
// The five native RPEN event columns are used as *view slots* for Milthm line
// events. The authoritative (semantic) event lists live in
// `line['x-milthm'].events`; the native arrays always mirror the current column
// mapping so the native timeline can render, drag, select and paste them.
// Scene rendering / export read the semantic list, so re-mapping a column never
// corrupts X/Y/rotation/speed.
import { milEaseToRpe, rpeEaseToMil, MIL_ANIM } from './convert.mjs';

export const COLUMN_KEYS = ['x', 'y', 'rotate', 'bodyAlpha', 'headAlpha', 'wholeAlpha', 'flowSpeed', 'size'];
export const COLUMN_LABELS = {
  x: 'X 坐标', y: 'Y 坐标', rotate: '旋转',
  lineAlpha: '轨道整体不透明度', bodyAlpha: '线体不透明度', headAlpha: '线头不透明度', wholeAlpha: '音符整体不透明度',
  flowSpeed: '流速倍率', size: '轨道大小',
};
export const COLUMN_LABELS_FULL = {
  lineAlpha: '轨道整体不透明度（线头+线身，Transparency 2）',
  bodyAlpha: '线体不透明度（LineBodyTransparency 8）',
  headAlpha: '线头不透明度（LineHeadTransparency 9）',
  wholeAlpha: '音符整体不透明度（WholeTransparency 13）',
};
export const ALPHA_KEYS = new Set(['lineAlpha', 'bodyAlpha', 'headAlpha', 'wholeAlpha']);
export const DEFAULT_COLUMNS = ['x', 'y', 'rotate', 'bodyAlpha', 'flowSpeed'];
// Slot 3 is RPEN's integer alpha track: only alpha semantics can live there.
const FLOAT_CANDIDATES = ['x', 'y', 'rotate', 'flowSpeed', 'size', 'bodyAlpha', 'headAlpha', 'wholeAlpha'];
const ALPHA_CANDIDATES = ['lineAlpha', 'bodyAlpha', 'headAlpha', 'wholeAlpha'];
export const SLOT_CANDIDATES = [FLOAT_CANDIDATES, FLOAT_CANDIDATES, FLOAT_CANDIDATES, ALPHA_CANDIDATES, FLOAT_CANDIDATES];

export const MIL_ANIM_TYPES = {
  lineAlpha: MIL_ANIM.TRANSPARENCY,
  bodyAlpha: MIL_ANIM.LINE_BODY_TRANSPARENCY,
  headAlpha: MIL_ANIM.LINE_HEAD_TRANSPARENCY,
  wholeAlpha: MIL_ANIM.WHOLE_TRANSPARENCY,
};

function rawSnapshot(event) {
  const raw = event?.['x-milthm']?.raw;
  return raw && Number.isFinite(Number(raw.type)) ? clone(raw) : null;
}

function carrierEventsToRaw(events, type) {
  return (events ?? []).filter(event => !event?.['x-milthm']?.synthetic).map(event => rawSnapshot(event) ?? carrierEventToRaw(event, type));
}

function rpeEventsToLineAlphaRaw(events) {
  return (events ?? []).filter(event => !event?.['x-milthm']?.synthetic).map(event => rawSnapshot(event) ?? carrierEventToRaw(event, MIL_ANIM.TRANSPARENCY));
}

const clone = value => structuredClone(value);
const cloneEvents = events => clone(Array.isArray(events) ? events : []);
const constantEvent = value => ({
  startTime: [0, 0, 1], endTime: [0, 0, 1], start: value, end: value,
  easingType: 1, easingLeft: 0, easingRight: 1, bezier: 0, bezierPoints: [0, 0, 1, 1], linkgroup: 0, inst: 1,
});

function rawToCarrierEvent(raw) {
  const ease = raw?.ease ?? { type: 0, press: 0 };
  return {
    startTime: clone(raw?.startTime ?? [0, 0, 1]), endTime: clone(raw?.endTime ?? [0, 0, 1]),
    start: Number(raw?.start ?? 0) * 255, end: Number(raw?.end ?? 0) * 255,
    easingType: milEaseToRpe(ease),
    easingLeft: Number(ease?.clipLeft ?? 0), easingRight: Number(ease?.clipRight ?? 1),
    bezier: 0, bezierPoints: [0, 0, 1, 1], linkgroup: 0,
  };
}

function carrierEventToRaw(event, type) {
  const ease = rpeEaseToMil(event?.easingType ?? 1);
  return {
    type,
    startTime: clone(event?.startTime ?? [0, 0, 1]), endTime: clone(event?.endTime ?? [0, 0, 1]),
    start: Math.max(0, Math.min(1, Number(event?.start ?? 0) / 255)),
    end: Math.max(0, Math.min(1, Number(event?.end ?? 0) / 255)),
    ease: { type: ease.type, press: ease.press, isValueExp: false, cusValueExp: '', clipLeft: Number(event?.easingLeft ?? 0), clipRight: Number(event?.easingRight ?? 1) },
  };
}

function sortByBeat(events) {
  return events.sort((left, right) => {
    const a = left?.startTime ?? [0, 0, 1], b = right?.startTime ?? [0, 0, 1];
    return (Number(a[0]) + Number(a[1]) / (Number(a[2]) || 1)) - (Number(b[0]) + Number(b[1]) / (Number(b[2]) || 1));
  });
}

function mergeRawLists(primary, extra) {
  if (!extra?.length) return primary;
  const key = event => JSON.stringify([event.startTime, event.endTime, event.start, event.end]);
  const seen = new Set(primary.map(key));
  for (const event of extra) if (!seen.has(key(event))) { primary.push(event); seen.add(key(event)); }
  return sortByBeat(primary);
}

/* ---------------- derive semantic events from a native chart line ---------------- */

function makeSyntheticAlphaInit(type, startTime = [0, 0, 1], endTime = [0, 1, 1], value = 0) {
  const ease = { type: 0, press: 0, isValueExp: false, cusValueExp: '', clipLeft: 0, clipRight: 1 };
  return { type, startTime: clone(startTime), endTime: clone(endTime), start: value, end: value, ease, syntheticInit: true };
}

const plusBeat = time => [Number(time?.[0] ?? 0) + 1, Number(time?.[1] ?? 0), Number(time?.[2] ?? 1)];

// Missing line-transparency tracks are initialised with a single 1-beat fully transparent (0)
// event, starting at beat 0:
//  - lineAlpha missing, body/head present  -> initialise lineAlpha;
//  - lineAlpha present, body AND head both missing -> initialise body and head;
//  - body/head are peers: never auto-fill one from the other.
// WholeTransparency(13) affects notes and is left alone.
function addTransparencyInitializers(semantics) {
  const has = key => (semantics[key] ?? []).length > 0;
  const lineAlpha = has('lineAlpha');
  const bodyAlpha = has('bodyAlpha');
  const headAlpha = has('headAlpha');
  if (!lineAlpha && !bodyAlpha && !headAlpha) return;
  const targets = [];
  if (!lineAlpha && (bodyAlpha || headAlpha)) targets.push({ key: 'lineAlpha', type: MIL_ANIM.TRANSPARENCY });
  if (lineAlpha && !bodyAlpha && !headAlpha) {
    targets.push({ key: 'bodyAlpha', type: MIL_ANIM.LINE_BODY_TRANSPARENCY });
    targets.push({ key: 'headAlpha', type: MIL_ANIM.LINE_HEAD_TRANSPARENCY });
  }
  if (!targets.length) return;
  // Start beat of the existing transparency events (used for the 255 hand-off event).
  let earliestTime = null;
  let earliestBeat = null;
  for (const key of ['lineAlpha', 'bodyAlpha', 'headAlpha']) for (const event of (semantics[key] ?? [])) {
    const beat = eventBeat(event.startTime);
    if (earliestBeat === null || beat < earliestBeat) { earliestBeat = beat; earliestTime = event.startTime; }
  }
  for (const target of targets) {
    if ((semantics[target.key] ?? []).length) continue;
    const events = [makeSyntheticAlphaInit(target.type, [0, 0, 1], [0, 1, 1], 0)];
    if (earliestTime) events.push(makeSyntheticAlphaInit(target.type, earliestTime, plusBeat(earliestTime), 1));
    semantics[target.key] = events;
  }
}

export function deriveSemantics(line) {
  const stash = line?.['x-milthm'] ?? {};
  const layer = line?.eventLayers?.[0] ?? {};
  const extended = line?.extended ?? {};
  const semantics = {
    x: cloneEvents(layer.moveXEvents),
    y: cloneEvents(layer.moveYEvents),
    rotate: cloneEvents(layer.rotateEvents),
    flowSpeed: [], speed: [], flowRaw: [],
    size: cloneEvents(extended.scaleXEvents),
    lineAlpha: [], bodyAlpha: [], headAlpha: [], wholeAlpha: [], legacy: [],
  };
  const primarySpeed = Number(stash.primarySpeedType);
  if (primarySpeed === MIL_ANIM.SPEED) {
    semantics.speed = cloneEvents(layer.speedEvents);
    semantics.flowRaw = cloneEvents(stash.channels?.flowSpeed);
  } else {
    semantics.flowSpeed = cloneEvents(layer.speedEvents);
  }
  const primaryAlpha = Number(stash.primaryAlphaType);
  const alphaEvents = layer.alphaEvents ?? [];
  if (primaryAlpha === MIL_ANIM.LINE_BODY_TRANSPARENCY) semantics.bodyAlpha = carrierEventsToRaw(alphaEvents, MIL_ANIM.LINE_BODY_TRANSPARENCY);
  else if (primaryAlpha === MIL_ANIM.WHOLE_TRANSPARENCY) semantics.wholeAlpha = carrierEventsToRaw(alphaEvents, MIL_ANIM.WHOLE_TRANSPARENCY);
  else if (primaryAlpha === MIL_ANIM.TRANSPARENCY) semantics.lineAlpha = carrierEventsToRaw(alphaEvents, MIL_ANIM.TRANSPARENCY);
  else if (alphaEvents.length && !alphaEvents.every(event => event?.['x-milthm']?.synthetic)) semantics.lineAlpha = carrierEventsToRaw(alphaEvents, MIL_ANIM.TRANSPARENCY);
  semantics.bodyAlpha = mergeRawLists(semantics.bodyAlpha, cloneEvents(stash.channels?.bodyAlpha));
  semantics.headAlpha = mergeRawLists(semantics.headAlpha, cloneEvents(stash.channels?.headAlpha));
  semantics.wholeAlpha = mergeRawLists(semantics.wholeAlpha, cloneEvents(stash.channels?.wholeAlpha));
  addTransparencyInitializers(semantics);
  return semantics;
}

export function semanticEvents(line) {
  const stash = line?.['x-milthm'];
  return stash && stash.events ? stash.events : deriveSemantics(line);
}

/* ---------------- carriers <-> semantics ---------------- */

export function signature(events) {
  let hash = 0x811c9dc5;
  const feed = text => { for (let index = 0; index < text.length; index++) { hash ^= text.charCodeAt(index); hash = Math.imul(hash, 0x01000193) >>> 0; } };
  for (const event of (events ?? [])) {
    feed(`${JSON.stringify(event?.startTime)}|${JSON.stringify(event?.endTime)}|${event?.start}|${event?.end}|${event?.easingType ?? 1}|${event?.easingLeft ?? 0}|${event?.easingRight ?? 1}|${event?.inst ? 1 : 0}|${event?.linkgroup ?? 0}`);
  }
  return hash >>> 0;
}

export function buildCarrierArrays(semantics, columns) {
  return columns.map(key => {
    if (ALPHA_KEYS.has(key)) return (semantics[key] ?? []).map(raw => rawToCarrierEvent(raw));
    return cloneEvents(semantics[key] ?? []);
  });
}

const eventBeat = time => Number(time?.[0] ?? 0) + Number(time?.[1] ?? 0) / (Number(time?.[2]) || 1);
const eventIdentity = event => JSON.stringify([event?.startTime, event?.endTime, event?.start, event?.end]);

// RPEN's EventTrack resolves equal start times by array order (the last one wins).
// Imported charts often contain zero-duration 0->1 reset events at the same beat as a
// user-edited event; keep old (imported) events first and newly added/edited events last so
// the explicit edit wins the tie instead of being overridden by an imported reset.
function orderTieEvents(events, previous) {
  if (!Array.isArray(events) || events.length < 2) return events;
  const previousKeys = new Set((previous ?? []).map(eventIdentity));
  const decorated = events.map((event, index) => ({ event, index, isNew: !previousKeys.has(eventIdentity(event)) }));
  decorated.sort((left, right) => eventBeat(left.event?.startTime) - eventBeat(right.event?.startTime)
    || (left.isNew === right.isNew ? left.index - right.index : left.isNew ? 1 : -1));
  return decorated.map(item => item.event);
}

function syncFromCarriers(semantics, columns, carriers, applied) {
  const next = { ...semantics };
  columns.forEach((key, slot) => {
    const carrier = carriers[slot] ?? [];
    if (applied?.[slot] !== undefined && signature(carrier) === applied[slot]) return;
    const previous = semantics[key] ?? [];
    const converted = ALPHA_KEYS.has(key) ? carrierEventsToRaw(carrier, MIL_ANIM_TYPES[key]) : cloneEvents(carrier);
    const syntheticKeys = new Set(previous.filter(event => event?.syntheticInit).map(eventIdentity));
    for (const event of converted) if (syntheticKeys.has(eventIdentity(event))) event.syntheticInit = true;
    next[key] = orderTieEvents(converted, previous);
  });
  return next;
}

function lineCarriers(line) {
  const layer = line?.eventLayers?.[0] ?? {};
  return [layer.moveXEvents ?? [], layer.moveYEvents ?? [], layer.rotateEvents ?? [], layer.alphaEvents ?? [], layer.speedEvents ?? []];
}

function writeCarriers(line, carriers) {
  const layers = Array.isArray(line.eventLayers) ? line.eventLayers : [];
  const layer = layers[0] ?? {};
  layer.moveXEvents = carriers[0];
  layer.moveYEvents = carriers[1];
  layer.rotateEvents = carriers[2];
  layer.alphaEvents = carriers[3];
  layer.speedEvents = carriers[4];
  layers[0] = layer;
  line.eventLayers = layers;
}

function lineBeatKey(events) {
  return events;
}

/* ---------------- chart level ---------------- */

export function isMilthmChart(chart) {
  return chart?.['x-milthm']?.kind === 'milthm-fmt2';
}

export function chartColumns(chart) {
  const columns = chart?.['x-milthm']?.columns;
  return Array.isArray(columns) && columns.length === 5 ? columns : DEFAULT_COLUMNS.slice();
}

/** Prepare semantics/mapping for a freshly imported chart. Returns a new chart or null. */
export function ensureChartColumns(chart) {
  if (!isMilthmChart(chart)) return null;
  const root = chart['x-milthm'];
  const next = clone(chart);
  let changed = false;
  if (!Array.isArray(next['x-milthm'].columns) || next['x-milthm'].columns.length !== 5) {
    next['x-milthm'].columns = DEFAULT_COLUMNS.slice();
    changed = true;
  }
  const columns = next['x-milthm'].columns;
  for (const line of (next.judgeLineList ?? [])) {
    if (!line?.['x-milthm']) { changed = true; continue; }
    if (!line['x-milthm'].events) { line['x-milthm'].events = deriveSemantics(line); changed = true; }
    const semantics = line['x-milthm'].events;
    const carriers = buildCarrierArrays(semantics, columns);
    writeCarriers(line, carriers);
    line['x-milthm'].applied = carriers.map(signature);
  }
  if (!changed) return null;
  return next;
}

/** Called on every commit: persist column edits back into semantics, then re-mirror. */
export function syncMilthmColumns(chart) {
  if (!isMilthmChart(chart)) return chart;
  const next = clone(chart);
  const root = next['x-milthm'];
  if (!Array.isArray(root.columns) || root.columns.length !== 5) root.columns = DEFAULT_COLUMNS.slice();
  const columns = root.columns;
  for (const line of (next.judgeLineList ?? [])) {
    if (!line?.['x-milthm']) continue;
    const stash = line['x-milthm'];
    const usedShift = !stash.events;
    let semantics = usedShift ? deriveSemantics(line) : stash.events;
    if (!usedShift) semantics = syncFromCarriers(semantics, columns, lineCarriers(line), stash.applied);
    if (semantics.legacy?.length) {
      // v0.4 charts kept Milthm Transparency(2) line events as an uneditable legacy list.
      semantics = { ...semantics, lineAlpha: [...(semantics.lineAlpha ?? []), ...rpeEventsToLineAlphaRaw(semantics.legacy)], legacy: [] };
    }
    const carriers = buildCarrierArrays(semantics, columns);
    writeCarriers(line, carriers);
    stash.events = semantics;
    stash.applied = carriers.map(signature);
  }
  return next;
}

/** Change the column mapping, carrying each semantic list through its slot. */
export function remapColumns(chart, slot, key) {
  if (!isMilthmChart(chart)) return null;
  const candidates = SLOT_CANDIDATES[slot] ?? [];
  if (!candidates.includes(key)) return null;
  const next = clone(chart);
  const columns = chartColumns(next).slice();
  const previous = columns[slot];
  if (previous === key) return null;
  const other = columns.indexOf(key);
  if (other >= 0 && other !== slot) {
    if (!(SLOT_CANDIDATES[other] ?? []).includes(previous)) return { error: `${COLUMN_LABELS[key]} 已在第 ${other + 1} 列，且那一列不能显示${COLUMN_LABELS[previous]}` };
    columns[other] = previous;
  }
  columns[slot] = key;
  next['x-milthm'].columns = columns;
  for (const line of (next.judgeLineList ?? [])) {
    if (!line?.['x-milthm']) continue;
    const stash = line['x-milthm'];
    const semantics = stash.events ?? deriveSemantics(line);
    stash.events = semantics;
    const carriers = buildCarrierArrays(semantics, columns);
    writeCarriers(line, carriers);
    stash.applied = carriers.map(signature);
  }
  return next;
}

/** Build a chart where native arrays/channels match the semantic lists exactly (for export). */
export function buildMilthmExportChart(chart) {
  if (!isMilthmChart(chart)) return chart;
  const next = clone(chart);
  for (const line of (next.judgeLineList ?? [])) {
    const stash = line?.['x-milthm'];
    if (!stash) continue;
    const semantics = stash.events ?? deriveSemantics(line);
    const layers = Array.isArray(line.eventLayers) ? line.eventLayers : [];
    const layer = layers[0] ?? {};
    layer.moveXEvents = cloneEvents(semantics.x);
    layer.moveYEvents = cloneEvents(semantics.y);
    layer.rotateEvents = cloneEvents(semantics.rotate);
    const useSpeed = Array.isArray(semantics.speed) && semantics.speed.length > 0;
    layer.speedEvents = useSpeed ? cloneEvents(semantics.speed) : cloneEvents(semantics.flowSpeed);
    layer.alphaEvents = [];
    layers[0] = layer;
    line.eventLayers = layers;
    line.extended = {
      ...(line.extended ?? {}),
      scaleXEvents: cloneEvents(semantics.size),
      scaleYEvents: cloneEvents(semantics.size),
    };
    stash.primarySpeedType = useSpeed ? MIL_ANIM.SPEED : MIL_ANIM.FLOW_SPEED;
    delete stash.primaryAlphaType;
    const exportAlpha = key => cloneEvents((semantics[key] ?? []).filter(event => !event?.syntheticInit));
    stash.channels = {
      bodyAlpha: exportAlpha('bodyAlpha'),
      headAlpha: exportAlpha('headAlpha'),
      wholeAlpha: exportAlpha('wholeAlpha'),
      flowSpeed: useSpeed ? cloneEvents(semantics.flowRaw) : [],
    };
    const legacyRaw = (semantics.legacy ?? []).filter(event => !event?.['x-milthm']?.synthetic).map(event => {
      const snapshot = event?.['x-milthm']?.raw;
      if (snapshot && Number(snapshot.type) === MIL_ANIM.TRANSPARENCY) return clone(snapshot);
      const ease = rpeEaseToMil(event.easingType ?? 1);
      return {
        type: MIL_ANIM.TRANSPARENCY,
        startTime: clone(event.startTime), endTime: clone(event.endTime),
        start: Math.max(0, Math.min(1, Number(event.start ?? 0) / 255)),
        end: Math.max(0, Math.min(1, Number(event.end ?? 0) / 255)),
        ease: { type: ease.type, press: ease.press, isValueExp: false, cusValueExp: '', clipLeft: Number(event.easingLeft ?? 0), clipRight: Number(event.easingRight ?? 1) },
      };
    });
    const lineAlphaRaw = (semantics.lineAlpha ?? []).filter(event => !event?.syntheticInit).map(raw => ({ ...clone(raw), type: MIL_ANIM.TRANSPARENCY }));
    stash.rawExtras = [...(stash.rawExtras ?? []), ...lineAlphaRaw, ...legacyRaw];
    stash.events = semantics;
    delete stash.applied;
  }
  return next;
}

/** Native arrays to inject while compiling the preview scene (so scene semantics stay correct). */
export function sceneSemanticArrays(line) {
  const semantics = semanticEvents(line);
  const useSpeed = Array.isArray(semantics.speed) && semantics.speed.length > 0;
  const lineAlphaCarrier = (semantics.lineAlpha ?? []).length
    ? semantics.lineAlpha.map(raw => rawToCarrierEvent(raw))
    : [constantEvent(255)];
  return {
    moveXEvents: semantics.x,
    moveYEvents: semantics.y,
    rotateEvents: semantics.rotate,
    speedEvents: useSpeed ? semantics.speed : semantics.flowSpeed,
    alphaEvents: lineAlphaCarrier,
    scaleXEvents: semantics.size,
    scaleYEvents: semantics.size,
  };
}

export { lineBeatKey };
