import io

path = r'E:\File\deepseek harness\mil\rpen-milthm-bridge\columns.mjs'
s = io.open(path, encoding='utf-8').read()

# 1) init-event helpers + transparency initializers, inserted before deriveSemantics
anchor = "export function deriveSemantics(line) {"
helpers = """function makeSyntheticAlphaInit(type, startTime) {
  const ease = { type: 0, press: 0, isValueExp: false, cusValueExp: '', clipLeft: 0, clipRight: 1 };
  return { type, startTime: clone(startTime), endTime: clone(startTime), start: 1, end: 1, ease, syntheticInit: true };
}

// Rain Editor initialises missing transparency tracks to fully opaque (1.0). Mirror that
// explicitly at the start beat of the existing transparency events, so RPEN's timeline shows
// the initial 255 and the event multipliers are never left implicit.
function addTransparencyInitializers(semantics) {
  const tracks = [
    { key: 'lineAlpha', type: MIL_ANIM.TRANSPARENCY },
    { key: 'bodyAlpha', type: MIL_ANIM.LINE_BODY_TRANSPARENCY },
    { key: 'headAlpha', type: MIL_ANIM.LINE_HEAD_TRANSPARENCY },
  ];
  const present = tracks.filter(track => (semantics[track.key] ?? []).length > 0);
  if (!present.length) return;
  let earliestBeat = null;
  let earliestTime = null;
  for (const track of present) for (const event of semantics[track.key]) {
    const beat = eventBeat(event.startTime);
    if (earliestBeat === null || beat < earliestBeat) { earliestBeat = beat; earliestTime = event.startTime; }
  }
  const initBeat = earliestTime ?? [0, 0, 1];
  for (const track of tracks) {
    if ((semantics[track.key] ?? []).length) continue;
    semantics[track.key] = [makeSyntheticAlphaInit(track.type, initBeat)];
  }
}

""" + anchor
assert anchor in s
s = s.replace(anchor, helpers, 1)

# 2) call the initializer at the end of deriveSemantics before return
old = """  semantics.bodyAlpha = mergeRawLists(semantics.bodyAlpha, cloneEvents(stash.channels?.bodyAlpha));
  semantics.headAlpha = mergeRawLists(semantics.headAlpha, cloneEvents(stash.channels?.headAlpha));
  semantics.wholeAlpha = mergeRawLists(semantics.wholeAlpha, cloneEvents(stash.channels?.wholeAlpha));
  return semantics;"""
new = """  semantics.bodyAlpha = mergeRawLists(semantics.bodyAlpha, cloneEvents(stash.channels?.bodyAlpha));
  semantics.headAlpha = mergeRawLists(semantics.headAlpha, cloneEvents(stash.channels?.headAlpha));
  semantics.wholeAlpha = mergeRawLists(semantics.wholeAlpha, cloneEvents(stash.channels?.wholeAlpha));
  addTransparencyInitializers(semantics);
  return semantics;"""
assert old in s
s = s.replace(old, new, 1)

# 3) preserve syntheticInit markers when re-syncing changed carrier slots
old = """    const previous = semantics[key] ?? [];
    const converted = ALPHA_KEYS.has(key) ? carrierEventsToRaw(carrier, MIL_ANIM_TYPES[key]) : cloneEvents(carrier);
    next[key] = orderTieEvents(converted, previous);"""
new = """    const previous = semantics[key] ?? [];
    const converted = ALPHA_KEYS.has(key) ? carrierEventsToRaw(carrier, MIL_ANIM_TYPES[key]) : cloneEvents(carrier);
    const syntheticKeys = new Set(previous.filter(event => event?.syntheticInit).map(eventIdentity));
    for (const event of converted) if (syntheticKeys.has(eventIdentity(event))) event.syntheticInit = true;
    next[key] = orderTieEvents(converted, previous);"""
assert old in s
s = s.replace(old, new, 1)

# 4) export: do not write the synthetic init events back to Milthm
old = """    const lineAlphaRaw = (semantics.lineAlpha ?? []).map(raw => ({ ...clone(raw), type: MIL_ANIM.TRANSPARENCY }));"""
new = """    const lineAlphaRaw = (semantics.lineAlpha ?? []).filter(event => !event?.syntheticInit).map(raw => ({ ...clone(raw), type: MIL_ANIM.TRANSPARENCY }));"""
assert old in s
s = s.replace(old, new, 1)
old = """    stash.channels = {
      bodyAlpha: cloneEvents(semantics.bodyAlpha),
      headAlpha: cloneEvents(semantics.headAlpha),
      wholeAlpha: cloneEvents(semantics.wholeAlpha),
      flowSpeed: useSpeed ? cloneEvents(semantics.flowRaw) : [],
    };"""
new = """    const exportAlpha = key => cloneEvents((semantics[key] ?? []).filter(event => !event?.syntheticInit));
    stash.channels = {
      bodyAlpha: exportAlpha('bodyAlpha'),
      headAlpha: exportAlpha('headAlpha'),
      wholeAlpha: exportAlpha('wholeAlpha'),
      flowSpeed: useSpeed ? cloneEvents(semantics.flowRaw) : [],
    };"""
assert old in s
s = s.replace(old, new, 1)

io.open(path, 'w', encoding='utf-8').write(s)
print('transparency initializer patch applied')
