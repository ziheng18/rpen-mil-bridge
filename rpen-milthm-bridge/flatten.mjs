// Export flattening: turn RPEN-only chart structure into Milthm-representable single tracks.
//
// Milthm fmt=2 has no equivalent for two RPEN features, but both are numerically definable, so
// they can be flattened instead of dropped:
//
// 1. Event layers (`line.eventLayers[1..]`). RPEN *adds* the layers: `LineRuntime.value()` sums
//    every layer's track (`core/scene.mjs:55`) and `floor()` sums the per-layer speed integrals
//    (`:54`), so the visible value is Σ layers. Summing the layers into one track is therefore
//    exact (piecewise-linear + piecewise-linear = piecewise-linear), no fitting error, and
//    summing the speed tracks is equivalent to summing their integrals. `line.extended`
//    (scaleX/scaleY/color/incline/...) is not layered in RPEN, so nothing to do there.
//
// 2. Parent lines (`line.father` / `line.rotateWithFather`). RPEN composes the parent transform
//    (`core/scene.mjs:122-130`):
//        angle   = -parentRotation * PI / 180
//        abs.x   = parent.x + local.x*cos(angle) - local.y*sin(angle)
//        abs.y   = parent.y + local.x*sin(angle) + local.y*cos(angle)
//        abs.rot = local.rot + (rotateWithFather ? parent.rot : 0)
//    Parent *scale* is not inherited (RPEN only composes position and rotation), so a child can
//    be baked into its own absolute X/Y/rotation tracks and exported as an ordinary line.
//    Rotation is still piecewise-linear; position is not (cos/sin of a moving rotation), so the
//    baked position track is refined adaptively until the linear interpolation error is below
//    tolerance. The rotation track is emitted exactly at the cut beats.
//
// Both transformations are export-only: the editor keeps the native structure, so preview and
// data model stay untouched. Warnings tell the user what was flattened — "used a feature Milthm
// cannot express -> say so on export".
//
// The module is pure: value sampling is injected (`options.sampler`) so it can be unit-tested
// offline with a plain linear sampler and driven by RPEN's EventTrack at runtime.

const EVENT_KINDS = ['moveXEvents', 'moveYEvents', 'rotateEvents', 'alphaEvents', 'speedEvents'];

const finiteNumber = value => (Number.isFinite(Number(value)) ? Number(value) : 0);
const lineNumber = value => (Number.isFinite(Number(value)) ? Math.trunc(Number(value)) : -1);

/** True when an event's value curve is not linear (a merged/baked segment may need subdividing). */
function isCurved(event) {
  if (!event) return false;
  return Boolean(event.trajectory) || Boolean(event.bezier)
    || finiteNumber(event.easingType ?? 1) !== 1
    || finiteNumber(event.easingLeft ?? 0) !== 0 || finiteNumber(event.easingRight ?? 1) !== 1;
}

/**
 * Sample an interval adaptively until a straight line between the end points approximates the
 * real curve within `tolerance`. Iterative (explicit stack) — no recursion.
 *
 * Two probe points (1/4 and 3/4) are used instead of one midpoint: a single midpoint probe is
 * blind to symmetric curves (a full cos half-period has zero midpoint error), which is exactly
 * what a rotating parent line produces.
 *
 * @returns {{beat:number, value:number}[]} ascending points, first is (startBeat, startValue)
 */
function linearizeInterval({ startBeat, endBeat, startValue, endValue, valueAt, tolerance, maxDepth }) {
  const points = [{ beat: startBeat, value: startValue }];
  const stack = [{ a: startBeat, b: endBeat, va: startValue, vb: endValue, depth: 0 }];
  while (stack.length) {
    const { a, b, va, vb, depth } = stack.pop();
    if (!(b > a)) continue;
    let split = false;
    if (depth < maxDepth) {
      const span = b - a;
      const quarter = valueAt(a + span * 0.25);
      const threeQuarters = valueAt(a + span * 0.75);
      const expectedQuarter = va + (vb - va) * 0.25;
      const expectedThreeQuarters = va + (vb - va) * 0.75;
      split = Math.abs(quarter - expectedQuarter) > tolerance || Math.abs(threeQuarters - expectedThreeQuarters) > tolerance;
    }
    if (split) {
      const middle = (a + b) / 2;
      const vm = valueAt(middle);
      // Push the right half first so the left half is finalised first (ascending output).
      stack.push({ a: middle, b, va: vm, vb, depth: depth + 1 });
      stack.push({ a, b: middle, va, vb: vm, depth: depth + 1 });
      continue;
    }
    points.push({ beat: b, value: vb });
  }
  return points;
}

/** Beats at which any of the given tracks starts a new event (i.e. where a value step can occur). */
function collectStartBeats(trackLists, beatOf) {
  const starts = new Set();
  for (const events of trackLists) for (const event of (events ?? [])) starts.add(finiteNumber(beatOf(event.startTime)));
  return starts;
}

/** RPE-style linear events from points (easing linear, no `x-milthm` snapshots). */
function eventsFromPoints(points, toTime) {
  const events = [];
  for (let index = 0; index < points.length - 1; index++) {
    const start = points[index];
    const end = points[index + 1];
    if (!(end.beat > start.beat)) continue;      // duplicate-beat points encode a step, not a segment
    events.push({
      startTime: toTime(start.beat), endTime: toTime(end.beat),
      start: start.value, end: end.value,
      easingType: 1, easingLeft: 0, easingRight: 1,
      bezier: 0, bezierPoints: [0, 0, 1, 1], linkgroup: 0,
    });
  }
  return events;
}

/** Cut beats of a set of event lists, always anchored at beat 0 like RPEN's tracks do. */
function collectCuts(trackLists, beatOf) {
  const cuts = new Set([0]);
  for (const events of trackLists) {
    for (const event of (events ?? [])) {
      cuts.add(finiteNumber(beatOf(event.startTime)));
      cuts.add(finiteNumber(beatOf(event.endTime)));
    }
  }
  return [...cuts].filter(value => Number.isFinite(value)).sort((left, right) => left - right);
}

/**
 * Build one linear track whose value is the sum of several tracks (RPEN event-layer semantics).
 * Returns null when there is nothing to merge, so callers can keep the original arrays — that
 * preserves the `x-milthm` snapshots and therefore the 0-diff export for untouched charts.
 */
function mergeTracks(trackLists, options) {
  const nonEmpty = (trackLists ?? []).filter(list => Array.isArray(list) && list.length > 0);
  if (nonEmpty.length < 2) return null;
  const { beatOf, toTime, secondsOf, sampler, epsilon } = options;
  const samplers = nonEmpty.map(events => sampler(events, 0));
  const valueAt = beat => samplers.reduce((sum, sample) => sum + finiteNumber(sample(secondsOf(toTime(beat)))), 0);
  // At a boundary where a new event starts, the segment *before* it keeps the pre-jump value.
  const valueBefore = beat => samplers.reduce((sum, sample) =>
    sum + finiteNumber(sample(Math.max(0, secondsOf(toTime(beat)) - epsilon))), 0);
  const curved = nonEmpty.some(events => events.some(isCurved));
  const cuts = collectCuts(nonEmpty, beatOf);
  const startsAt = collectStartBeats(nonEmpty, beatOf);
  const points = [];
  for (let index = 0; index < cuts.length - 1; index++) {
    const startBeat = cuts[index];
    const endBeat = cuts[index + 1];
    const startValue = valueAt(startBeat);       // right-continuous: post-jump at the boundary
    // Only a boundary where a new event starts carries a step; otherwise sample the exact value
    // so continuous ramps are not nudged by the epsilon.
    const endValue = startsAt.has(endBeat) ? valueBefore(endBeat) : valueAt(endBeat);
    points.push({ beat: startBeat, value: startValue });
    if (!curved) {
      points.push({ beat: endBeat, value: endValue });
      continue;
    }
    const tolerance = Math.max(Math.abs(startValue), Math.abs(endValue), 1) * 1e-4;
    points.push(...linearizeInterval({
      startBeat, endBeat, startValue, endValue, valueAt, tolerance, maxDepth: 6,
    }).slice(1));
  }
  // A step on the last cut has no following interval, so emit the post-step value explicitly;
  // otherwise the track would keep the pre-step value forever (RPEN would show the new one).
  const lastBeat = cuts.at(-1);
  if (Number.isFinite(lastBeat) && startsAt.has(lastBeat) && points.length) {
    const previousValue = points.at(-1).value;
    const postValue = valueAt(lastBeat);
    if (Math.abs(postValue - previousValue) > 1e-9) {
      const tailBeat = Math.max(finiteNumber(options.endBeat), lastBeat + 1);
      points.push({ beat: lastBeat, value: postValue }, { beat: tailBeat, value: postValue });
    }
  }
  return eventsFromPoints(points, toTime);
}

/** Parent index, RPEN-compatible (-1 when none). */
function parentIndexOf(line) {
  const raw = line?.father;
  if (raw === null || raw === undefined || raw === '') return -1;
  const value = lineNumber(raw);
  return value >= 0 ? value : -1;
}

/** RPEN's default for rotateWithFather changed with RPEVersion 163. */
function inheritsParentRotation(line, chart) {
  if (line?.rotateWithFather !== undefined && line?.rotateWithFather !== null) return Boolean(line.rotateWithFather);
  return finiteNumber(chart?.META?.RPEVersion ?? 0) >= 163;
}

/**
 * Bake `line.father` chains into absolute X/Y/rotation tracks (children only; roots stay as-is).
 * Returns the set of baked line indices. Warnings describe what happened.
 */
function bakeParentChains(chart, options, warnings) {
  const lines = Array.isArray(chart?.judgeLineList) ? chart.judgeLineList : [];
  const { beatOf, toTime, secondsOf, sampler, epsilon } = options;
  const layerOf = line => (Array.isArray(line?.eventLayers) && line.eventLayers.length ? (line.eventLayers[0] ?? {}) : (line?.eventLayers?.[0] ?? {}));
  const ownTracks = line => {
    const layer = layerOf(line);
    return { x: layer.moveXEvents ?? [], y: layer.moveYEvents ?? [], rotate: layer.rotateEvents ?? [] };
  };
  const trackSampler = events => sampler(events ?? [], 0);
  const resolved = new Map();        // index -> { x, y, rotate } absolute event arrays
  const baked = new Set();

  const resolveChain = startIndex => {
    const stack = [];
    const visiting = new Set();
    let index = startIndex;
    while (Number.isInteger(index) && index >= 0 && index < lines.length) {
      if (resolved.has(index)) break;
      if (visiting.has(index)) return false;        // father cycle (RPEN reports this as an error)
      visiting.add(index);
      stack.push(index);
      index = parentIndexOf(lines[index]);
    }
    // Resolve root-most first: the stack is child -> ... -> root.
    for (let position = stack.length - 1; position >= 0; position--) {
      const lineIndex = stack[position];
      const line = lines[lineIndex];
      const parent = parentIndexOf(line);
      const own = ownTracks(line);
      if (parent < 0) { resolved.set(lineIndex, own); continue; }
      const parentAbsolute = resolved.get(parent);
      if (!parentAbsolute) return false;
      const inheritRotation = inheritsParentRotation(line, chart);
      const parentX = trackSampler(parentAbsolute.x);
      const parentY = trackSampler(parentAbsolute.y);
      const parentRotate = trackSampler(parentAbsolute.rotate);
      const localX = trackSampler(own.x);
      const localY = trackSampler(own.y);
      const localRotate = trackSampler(own.rotate);
      const secondsAt = beat => secondsOf(toTime(beat));
      const composeAt = seconds => {
        const px = finiteNumber(parentX(seconds)); const py = finiteNumber(parentY(seconds));
        const prot = finiteNumber(parentRotate(seconds));
        const lx = finiteNumber(localX(seconds)); const ly = finiteNumber(localY(seconds));
        const lrot = finiteNumber(localRotate(seconds));
        const angle = -prot * Math.PI / 180;
        return {
          x: px + lx * Math.cos(angle) - ly * Math.sin(angle),
          y: py + lx * Math.sin(angle) + ly * Math.cos(angle),
          rotate: lrot + (inheritRotation ? prot : 0),
        };
      };
      const absoluteAt = beat => composeAt(secondsAt(beat));
      const absoluteBefore = beat => composeAt(Math.max(0, secondsAt(beat) - epsilon));
      const cuts = collectCuts([parentAbsolute.x, parentAbsolute.y, parentAbsolute.rotate, own.x, own.y, own.rotate], beatOf);
      const startsAt = collectStartBeats([parentAbsolute.x, parentAbsolute.y, parentAbsolute.rotate, own.x, own.y, own.rotate], beatOf);
      const xPoints = []; const yPoints = []; const rotatePoints = [];
      for (let position = 0; position < cuts.length - 1; position++) {
        const startBeat = cuts[position];
        const endBeat = cuts[position + 1];
        if (!(endBeat > startBeat)) continue;
        const startState = absoluteAt(startBeat);
        // Left limit only when something actually starts here; a continuous ramp keeps the exact
        // boundary value so the epsilon cannot bias it.
        const endState = startsAt.has(endBeat) ? absoluteBefore(endBeat) : absoluteAt(endBeat);
        xPoints.push({ beat: startBeat, value: startState.x });
        yPoints.push({ beat: startBeat, value: startState.y });
        rotatePoints.push({ beat: startBeat, value: startState.rotate });
        // Position curves with a moving parent rotation; refine until the error is sub-pixel.
        xPoints.push(...linearizeInterval({
          startBeat, endBeat, startValue: startState.x, endValue: endState.x,
          valueAt: beat => absoluteAt(beat).x, tolerance: 0.25, maxDepth: 7,
        }).slice(1));
        yPoints.push(...linearizeInterval({
          startBeat, endBeat, startValue: startState.y, endValue: endState.y,
          valueAt: beat => absoluteAt(beat).y, tolerance: 0.25, maxDepth: 7,
        }).slice(1));
        // Rotation composes linearly: exact at the boundaries, no subdivision needed.
        rotatePoints.push({ beat: endBeat, value: endState.rotate });
      }
      // Same tail rule as mergeTracks(): a step on the final cut needs an explicit segment.
      const lastBeat = cuts.at(-1);
      if (Number.isFinite(lastBeat) && startsAt.has(lastBeat)) {
        const post = absoluteAt(lastBeat);
        const tailBeat = Math.max(finiteNumber(options.endBeat), lastBeat + 1);
        const stepped = (actual, previous) => previous === undefined || Math.abs(actual - previous.value) > 1e-9;
        if (stepped(post.x, xPoints.at(-1))) xPoints.push({ beat: lastBeat, value: post.x }, { beat: tailBeat, value: post.x });
        if (stepped(post.y, yPoints.at(-1))) yPoints.push({ beat: lastBeat, value: post.y }, { beat: tailBeat, value: post.y });
        if (stepped(post.rotate, rotatePoints.at(-1))) rotatePoints.push({ beat: lastBeat, value: post.rotate }, { beat: tailBeat, value: post.rotate });
      }
      const absolute = {
        x: eventsFromPoints(xPoints, toTime),
        y: eventsFromPoints(yPoints, toTime),
        rotate: eventsFromPoints(rotatePoints, toTime),
      };
      resolved.set(lineIndex, absolute);
      // Replace the child's local tracks with the baked absolute ones, then drop the hierarchy.
      const layer = layerOf(line);
      layer.moveXEvents = absolute.x;
      layer.moveYEvents = absolute.y;
      layer.rotateEvents = absolute.rotate;
      if (!Array.isArray(line.eventLayers)) line.eventLayers = [layer];
      line.eventLayers[0] = layer;
      line.father = -1;
      baked.add(lineIndex);
    }
    return true;
  };

  for (const [index, line] of lines.entries()) {
    if (parentIndexOf(line) < 0) continue;
    if (baked.has(index)) continue;
    if (!resolveChain(index)) {
      warnings.push(`线 ${index} 的父子线（father）链存在循环或无效父级：无法烘焙，已按自身事件导出（位置/旋转会与编辑器预览不同）`);
    }
  }
  if (baked.size) {
    const list = [...baked].sort((left, right) => left - right).join(', ');
    warnings.push(`父子线已烘焙导出：${baked.size} 条线（${list}）的父线位移/旋转已合成为绝对关键帧；Milthm 没有线层级，导出后不再有父子关系`);
  }
  return baked;
}

/**
 * Flatten a rebuilt Milthm export view so every RPEN-only structure becomes a plain track.
 *
 * @param {object} chart chart produced by `buildMilthmExportChart()` (already a clone)
 * @param {object} options
 * @param {(time:any) => number} options.beatOf        time triple -> beat number
 * @param {(beat:number) => any} options.toTime        beat number -> time triple
 * @param {(time:any) => number} options.secondsOf     time triple -> seconds
 * @param {(events:any[], fallback:number) => ((seconds:number) => number)} options.sampler
 * @param {number} [options.epsilon] seconds subtracted when taking a left limit
 * @returns {{chart: object, warnings: string[], flattened: {mergedLines:number, mergedTypes:number, bakedLines:number}}}
 */
export function flattenChartForMilthm(chart, options = {}) {
  const warnings = [];
  if (!chart || !Array.isArray(chart.judgeLineList)) {
    return { chart, warnings, flattened: { mergedLines: 0, mergedTypes: 0, bakedLines: 0 } };
  }
  const beatOfTime = time => (Array.isArray(time)
    ? finiteNumber(time[0]) + finiteNumber(time[1]) / (finiteNumber(time[2]) || 1)
    : finiteNumber(time));
  const opts = {
    beatOf: options.beatOf ?? beatOfTime,
    toTime: options.toTime ?? (beat => [0, beat, 1]),
    secondsOf: options.secondsOf ?? beatOfTime,
    sampler: options.sampler,
    epsilon: Number.isFinite(options.epsilon) ? Number(options.epsilon) : 1e-6,
  };
  if (typeof opts.sampler !== 'function') throw new TypeError('flattenChartForMilthm needs options.sampler');
  // One beat past the last chart event, so a step on the final cut still gets a segment.
  let endBeat = 1;
  for (const line of chart.judgeLineList) {
    for (const note of (line?.notes ?? [])) {
      const beat = opts.beatOf(note?.endTime ?? note?.startTime);
      if (Number.isFinite(beat)) endBeat = Math.max(endBeat, beat);
    }
    for (const layer of (Array.isArray(line?.eventLayers) ? line.eventLayers : [])) {
      for (const kind of EVENT_KINDS) {
        for (const event of (layer?.[kind] ?? [])) {
          const beat = opts.beatOf(event?.endTime ?? event?.startTime);
          if (Number.isFinite(beat)) endBeat = Math.max(endBeat, beat);
        }
      }
    }
  }
  opts.endBeat = endBeat + 1;

  let mergedLines = 0;
  let mergedTypes = 0;
  for (const line of chart.judgeLineList) {
    const layers = Array.isArray(line?.eventLayers) ? line.eventLayers : [];
    if (layers.length < 2) continue;
    const target = layers[0] ?? {};
    let changed = false;
    const clearExtras = kind => {
      for (let index = 1; index < layers.length; index++) {
        if (layers[index] && Array.isArray(layers[index][kind])) layers[index][kind] = [];
      }
    };
    for (const kind of EVENT_KINDS) {
      const lists = layers.map(layer => (Array.isArray(layer?.[kind]) ? layer[kind] : []));
      const sources = lists.map((list, index) => (list.length ? index : -1)).filter(index => index >= 0);
      if (!sources.length) continue;
      if (sources.length === 1) {
        // Only one layer carries this track: move it into layer 0 unchanged (keeps snapshots).
        if (sources[0] === 0) continue;
        target[kind] = lists[sources[0]];
        clearExtras(kind);
        changed = true;
        mergedTypes += 1;
        continue;
      }
      const merged = mergeTracks(lists, opts);
      if (!merged) continue;
      target[kind] = merged;
      clearExtras(kind);
      changed = true;
      mergedTypes += 1;
    }
    // Every event kind was either summed or moved into layer 0, so the extra layers are empty and
    // can be dropped — otherwise the Milthm export would still see, and warn about, several layers.
    const extrasCarryEvents = layers.slice(1)
      .some(layer => layer && EVENT_KINDS.some(kind => (layer?.[kind] ?? []).length > 0));
    line.eventLayers = extrasCarryEvents ? layers : [target];
    if (!Array.isArray(line.eventLayers)) line.eventLayers = [target];
    if (changed) mergedLines += 1;
  }
  if (mergedLines) {
    warnings.push(`事件层已按数值叠加合并导出：${mergedLines} 条线 / ${mergedTypes} 个事件轨（RPEN 预览本来就把各层相加，Milthm 只有单轨；合并后不能再逐层编辑）`);
  }

  const baked = bakeParentChains(chart, opts, warnings);
  return { chart, warnings, flattened: { mergedLines, mergedTypes, bakedLines: baked.size } };
}
