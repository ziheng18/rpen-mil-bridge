import io

# ---- columns.mjs: legacy -> lineAlpha migration helper ----
path = r'E:\File\deepseek harness\mil\rpen-milthm-bridge\columns.mjs'
s = io.open(path, encoding='utf-8').read()

anchor = """function carrierEventsToRaw(events, type) {
  return (events ?? []).filter(event => !event?.['x-milthm']?.synthetic).map(event => rawSnapshot(event) ?? carrierEventToRaw(event, type));
}"""
addition = anchor + """

function rpeEventsToLineAlphaRaw(events) {
  return (events ?? []).filter(event => !event?.['x-milthm']?.synthetic).map(event => rawSnapshot(event) ?? carrierEventToRaw(event, MIL_ANIM.TRANSPARENCY));
}"""
assert anchor in s
s = s.replace(anchor, addition, 1)

old = """    let semantics = usedShift ? deriveSemantics(line) : stash.events;
    if (!usedShift) semantics = syncFromCarriers(semantics, columns, lineCarriers(line), stash.applied);"""
new = """    let semantics = usedShift ? deriveSemantics(line) : stash.events;
    if (!usedShift) semantics = syncFromCarriers(semantics, columns, lineCarriers(line), stash.applied);
    if (semantics.legacy?.length) {
      // v0.4 charts kept Milthm Transparency(2) line events as an uneditable legacy list.
      semantics = { ...semantics, lineAlpha: [...(semantics.lineAlpha ?? []), ...rpeEventsToLineAlphaRaw(semantics.legacy)], legacy: [] };
    }"""
assert old in s
s = s.replace(old, new, 1)
io.open(path, 'w', encoding='utf-8').write(s)
print('columns.mjs legacy migration added')

# ---- main.mjs: tooltip with full labels ----
path = r'E:\File\deepseek harness\mil\rpen-milthm-bridge\main.mjs'
s = io.open(path, encoding='utf-8').read()
s = s.replace("  DEFAULT_COLUMNS, COLUMN_LABELS, SLOT_CANDIDATES, semanticEvents, chartColumns,",
              "  DEFAULT_COLUMNS, COLUMN_LABELS, COLUMN_LABELS_FULL, SLOT_CANDIDATES, semanticEvents, chartColumns,", 1)
old_title = "      select.title = `第 ${slot + 1} 列：${COLUMN_LABELS[columns[slot]]}（点开可换成本列支持的其它 Milthm 事件）`;"
new_title = "      select.title = `第 ${slot + 1} 列：${COLUMN_LABELS_FULL[columns[slot]] ?? COLUMN_LABELS[columns[slot]]}（点开可换成本列支持的其它 Milthm 事件）`;"
assert old_title in s
s = s.replace(old_title, new_title, 1)
io.open(path, 'w', encoding='utf-8').write(s)
print('main.mjs tooltip updated')
