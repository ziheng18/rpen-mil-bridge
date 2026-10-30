import io

path = r'E:\File\deepseek harness\mil\rpen-milthm-bridge\columns.mjs'
s = io.open(path, encoding='utf-8').read()

old = """function makeSyntheticAlphaInit(type, startTime) {
  const ease = { type: 0, press: 0, isValueExp: false, cusValueExp: '', clipLeft: 0, clipRight: 1 };
  return { type, startTime: clone(startTime), endTime: clone(startTime), start: 1, end: 1, ease, syntheticInit: true };
}"""
new = """function makeSyntheticAlphaInit(type, startTime, value = 1) {
  const ease = { type: 0, press: 0, isValueExp: false, cusValueExp: '', clipLeft: 0, clipRight: 1 };
  return { type, startTime: clone(startTime), endTime: clone(startTime), start: value, end: value, ease, syntheticInit: true };
}"""
assert old in s
s = s.replace(old, new, 1)

old = """  const tracks = [
    { key: 'lineAlpha', type: MIL_ANIM.TRANSPARENCY },
    { key: 'bodyAlpha', type: MIL_ANIM.LINE_BODY_TRANSPARENCY },
    { key: 'headAlpha', type: MIL_ANIM.LINE_HEAD_TRANSPARENCY },
    { key: 'wholeAlpha', type: MIL_ANIM.WHOLE_TRANSPARENCY },
  ];"""
new = """  // Only the line's visual transparency tracks; WholeTransparency(13) affects notes and
  // keeps Rain Editor's opaque default so notes do not disappear before a line event starts.
  const tracks = [
    { key: 'lineAlpha', type: MIL_ANIM.TRANSPARENCY },
    { key: 'bodyAlpha', type: MIL_ANIM.LINE_BODY_TRANSPARENCY },
    { key: 'headAlpha', type: MIL_ANIM.LINE_HEAD_TRANSPARENCY },
  ];"""
assert old in s
s = s.replace(old, new, 1)

old = """  const initBeat = earliestTime ?? [0, 0, 1];
  for (const track of tracks) {
    if ((semantics[track.key] ?? []).length) continue;
    semantics[track.key] = [makeSyntheticAlphaInit(track.type, initBeat)];
  }"""
new = """  const initBeat = earliestTime ?? [0, 0, 1];
  const earliestBeat = initBeat === [0, 0, 1] ? 0 : (() => {
    let beat = 0;
    for (const track of present) for (const event of semantics[track.key]) {
      const value = eventBeat(event.startTime);
      if (beat === 0 && value > 0) beat = value;
    }
    return beat;
  })();
  for (const track of tracks) {
    if ((semantics[track.key] ?? []).length) continue;
    // Before the first real transparency event: fully transparent (0).
    // From that event onward: fully opaque (1) so the multiplication does not dim it.
    const events = [makeSyntheticAlphaInit(track.type, [0, 0, 1], 0)];
    events.push(makeSyntheticAlphaInit(track.type, initBeat, 1));
    semantics[track.key] = events;
  }"""
assert old in s
s = s.replace(old, new, 1)

io.open(path, 'w', encoding='utf-8').write(s)
print('transparent-before/opaque-from-event patch applied')
