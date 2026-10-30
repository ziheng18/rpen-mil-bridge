import io

path = r'E:\File\deepseek harness\mil\rpen-milthm-bridge\columns.mjs'
s = io.open(path, encoding='utf-8').read()

anchor = """function syncFromCarriers(semantics, columns, carriers, applied) {
  const next = { ...semantics };
  columns.forEach((key, slot) => {
    const carrier = carriers[slot] ?? [];
    if (applied?.[slot] !== undefined && signature(carrier) === applied[slot]) return;
    next[key] = ALPHA_KEYS.has(key) ? carrierEventsToRaw(carrier, MIL_ANIM_TYPES[key]) : cloneEvents(carrier);
  });
  return next;
}"""
replacement = """const eventBeat = time => Number(time?.[0] ?? 0) + Number(time?.[1] ?? 0) / (Number(time?.[2]) || 1);
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
    next[key] = orderTieEvents(converted, previous);
  });
  return next;
}"""
assert anchor in s
s = s.replace(anchor, replacement, 1)
io.open(path, 'w', encoding='utf-8').write(s)
print('tie ordering patch applied')
