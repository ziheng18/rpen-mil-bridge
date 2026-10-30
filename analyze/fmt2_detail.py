"""Focused analysis of fmt=2 chart: infer semantics from data distributions."""
import json
import sys
from collections import Counter, defaultdict

PATH = r"E:\File\deepseek harness\mil\extracted\class_memories\chart.json"
fmt = json.load(open(PATH, encoding="utf-8"))

lines = fmt["lines"]


def rng(vals):
    return "%s..%s" % (min(vals), max(vals)) if vals else "-"


# ---------- notes ----------
print("== NOTES per line ==")
for ln in lines:
    notes = ln["notes"]
    if not notes:
        continue
    idx = [n["index"] for n in notes]
    times = [tuple(n["time"]) for n in notes]
    types = Counter(n["type"] for n in notes)
    enddiff = sum(1 for n in notes if n["endTime"] != n["time"])
    sorted_ok = all(times[i] <= times[i + 1] for i in range(len(times) - 1)) if len(times) > 1 else True
    print("line %2d: n=%3d types=%s index=%s endTime!=time:%d sorted:%s first=%s last=%s"
          % (ln["index"], len(notes), dict(types), rng(idx), enddiff, sorted_ok, times[0], times[-1]))
    # duplicate indexes?
    if len(set(idx)) != len(idx):
        print("    DUPLICATE indexes!")

print("\n== global note type stats ==")
for ty in (0, 1):
    sel = [n for ln in lines for n in ln["notes"] if n["type"] == ty]
    print("type %d: n=%d endTime==time:%d isFake:%s alwaysPerfect:%d"
          % (ty, len(sel), sum(1 for n in sel if n["endTime"] == n["time"]),
             dict(Counter(n["isFake"] for n in sel)), sum(1 for n in sel if n["isAlwaysPerfect"])))
    t0 = tuple(sel[0]["time"])
    tN = tuple(sel[-1]["time"])
    print("   time range: %s .. %s" % (t0, tN))
    print("   sample:", json.dumps(sel[0], ensure_ascii=False))

# ---------- animations ----------
print("\n== ANIMATIONS by type ==")
by_type = defaultdict(list)
for ln in lines:
    for a in ln["animations"]:
        by_type[a["type"]].append((ln["index"], a))
for ty in sorted(by_type):
    items = by_type[ty]
    starts = [a["start"] for _, a in items if isinstance(a["start"], (int, float))]
    ends = [a["end"] for _, a in items if isinstance(a["end"], (int, float))]
    zero = sum(1 for _, a in items if a["startTime"] == a["endTime"])
    press = Counter(a["ease"].get("press") for _, a in items)
    etypes = Counter(a["ease"].get("type") for _, a in items)
    lines_used = Counter(l for l, _ in items)
    idxs = [a["index"] for _, a in items]
    print("type %2d: n=%-4d zeroDur=%-4d start=%s end=%s" % (ty, len(items), zero, rng(starts), rng(ends)))
    print("        ease.type=%s" % dict(etypes))
    print("        ease.press=%s" % dict(press))
    print("        lines=%s" % dict(sorted(lines_used.items())))
    print("        index=%s" % rng(idxs))

print("\n== sample per type ==")
for ty in sorted(by_type):
    lnidx, a = by_type[ty][0]
    print("type %d (line %d): %s" % (ty, lnidx, json.dumps(a, ensure_ascii=False)))

# check index sequential per (line,type)?
print("\n== index sequence check per (line,type) ==")
for ln in lines:
    groups = defaultdict(list)
    for a in ln["animations"]:
        groups[a["type"]].append(a["index"])
    for ty, idxs in sorted(groups.items()):
        ok = sorted(idxs) == list(range(len(idxs)))
        if not ok:
            print("line %d type %d: indexes=%s" % (ln["index"], ty, sorted(idxs)[:20]))

print("\n== animation ordering ==")
for ln in lines:
    beats = []
    seq = []
    for a in ln["animations"]:
        beat = a["startTime"][0] + a["startTime"][1] / a["startTime"][2]
        beats.append(beat)
        seq.append(a["type"])
    print("line %2d: sorted_by_start=%s  first_types=%s" % (ln["index"], beats == sorted(beats), seq[:12]))

# ---------- ease / bearer ----------
print("\n== ease fields ==")
all_ease = [a["ease"] for ln in lines for a in ln["animations"]]
print("ease.type:", dict(Counter(e["type"] for e in all_ease)))
print("ease.isValueExp:", dict(Counter(e["isValueExp"] for e in all_ease)))
print("ease.cusValueExp:", dict(Counter(e["cusValueExp"] for e in all_ease)))
print("clipLeft:", dict(Counter(e["clipLeft"] for e in all_ease)))
print("clipRight:", dict(Counter(e["clipRight"] for e in all_ease)))
print("press:", dict(Counter(e["press"] for e in all_ease)))
print("\nbearer_type x bearer:", dict(Counter((a["bearer_type"], a["bearer"]) for ln in lines for a in ln["animations"])))

# ---------- raw bytes / formatting ----------
raw = open(PATH, "rb").read()
print("\n== raw file ==")
print("size:", len(raw), "bytes")
print("head:", raw[:120])
print("has newline:", b"\n" in raw, " has space:", b" " in raw[:2000])
print("BOM:", raw[:3])
print("non-ascii bytes present:", any(b > 127 for b in raw[:100000]))

# RPEN raw compare
rpe = open(r"E:\File\deepseek harness\mil\extracted\water_pez\0130923863793952.json", "rb").read()
print("\n== RPEN raw file ==")
print("size:", len(rpe), "bytes")
print("head:", rpe[:120])
print("has newline:", b"\n" in rpe, " has space in first 2000:", b" " in rpe[:2000])
print("BOM:", rpe[:3])
