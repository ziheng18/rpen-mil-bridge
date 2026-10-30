import io

path = r'E:\File\deepseek harness\mil\rpen-milthm-bridge\columns.mjs'
s = io.open(path, encoding='utf-8').read()

old = """function makeSyntheticAlphaInit(type) {
  const ease = { type: 0, press: 0, isValueExp: false, cusValueExp: '', clipLeft: 0, clipRight: 1 };
  // One beat long, starting at beat 0, fully transparent (0). Never zero-length.
  return { type, startTime: [0, 0, 1], endTime: [0, 1, 1], start: 0, end: 0, ease, syntheticInit: true };
}"""
new = """function makeSyntheticAlphaInit(type, startTime = [0, 0, 1], endTime = [0, 1, 1], value = 0) {
  const ease = { type: 0, press: 0, isValueExp: false, cusValueExp: '', clipLeft: 0, clipRight: 1 };
  return { type, startTime: clone(startTime), endTime: clone(endTime), start: value, end: value, ease, syntheticInit: true };
}

const plusBeat = time => [Number(time?.[0] ?? 0) + 1, Number(time?.[1] ?? 0), Number(time?.[2] ?? 1)];"""
assert old in s
s = s.replace(old, new, 1)

old = """  const targets = [];
  if (!lineAlpha && (bodyAlpha || headAlpha)) targets.push({ key: 'lineAlpha', type: MIL_ANIM.TRANSPARENCY });
  if (lineAlpha && !bodyAlpha && !headAlpha) {
    targets.push({ key: 'bodyAlpha', type: MIL_ANIM.LINE_BODY_TRANSPARENCY });
    targets.push({ key: 'headAlpha', type: MIL_ANIM.LINE_HEAD_TRANSPARENCY });
  }
  for (const target of targets) {
    if ((semantics[target.key] ?? []).length) continue;
    semantics[target.key] = [makeSyntheticAlphaInit(target.type)];
  }"""
new = """  const targets = [];
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
  }"""
assert old in s
s = s.replace(old, new, 1)

io.open(path, 'w', encoding='utf-8').write(s)
print('v0.6.2: 0-init + 255 hand-off event added')
