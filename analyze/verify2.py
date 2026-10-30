"""Final verification pass: key-presence tables, index/global IDs, percentiles, edge cases."""
import json
from collections import Counter, defaultdict

RPE = r"E:\File\deepseek harness\mil\extracted\water_pez\0130923863793952.json"
FMT = r"E:\File\deepseek harness\mil\extracted\class_memories\chart.json"

rpe = json.load(open(RPE, encoding="utf-8"))
fmt = json.load(open(FMT, encoding="utf-8"))


def pct(vals, ps=(0, 5, 50, 95, 100)):
    vals = sorted(vals)
    n = len(vals)
    if not n:
        return []
    return [vals[min(n - 1, int(round(p / 100 * (n - 1))))] for p in ps]


print("########## RPEN (WATER.pez) ##########")
lines = rpe["judgeLineList"]
# key presence per event type
agg = defaultdict(Counter)
total = Counter()
for ln in lines:
    for layer in ln.get("eventLayers") or []:
        for name, arr in layer.items():
            if isinstance(arr, list):
                total[name] += len(arr)
                for ev in arr:
                    agg[name].update(ev.keys())
for name, _n in total.most_common():
    print("event %-12s n=%-5d keys=%s" % (name, total[name], dict(agg[name].most_common())))
# inst / trajectory
inst_vals = Counter()
for ln in lines:
    for layer in ln.get("eventLayers") or []:
        for name, arr in layer.items():
            if isinstance(arr, list):
                for ev in arr:
                    if "inst" in ev:
                        inst_vals[(name, ev["inst"])] += 1
print("inst presence:", dict(inst_vals) or "none in line events")
allkeys = set()
for ln in lines:
    for layer in ln.get("eventLayers") or []:
        for arr in layer.values():
            if isinstance(arr, list):
                for ev in arr:
                    allkeys.update(ev.keys())
print("union of line-event keys:", sorted(allkeys))
print("trajectory field present in line events:", "trajectory" in allkeys)

# block areas
blocks = rpe["blockAreaList"]
print("\nblockAreas:", len(blocks))
print("block keys:", sorted(blocks[0].keys()))
print("activeIntervals counts:", Counter(len(b.get("activeIntervals") or []) for b in blocks))
print("isInvert:", Counter(b["isInvert"] for b in blocks))
print("layerId:", Counter(b.get("layerId") for b in blocks))
print("editorPositionX present:", sum(1 for b in blocks if "editorPositionX" in b))
ai = [iv for b in blocks for iv in (b.get("activeIntervals") or [])]
print("activeIntervals sample:", json.dumps(ai[0], ensure_ascii=False) if ai else None)
print("activeIntervals keys:", sorted(ai[0].keys()) if ai else None)
print("block event easingType hist:", Counter(ev.get("easingType") for b in blocks for k in ("moveXEvents","moveYEvents","rotateEvents","scaleXEvents","scaleYEvents") for ev in (b.get(k) or [])))
print("block event inst hist:", Counter(ev.get("inst") for b in blocks for k in ("moveXEvents","moveYEvents","rotateEvents","scaleXEvents","scaleYEvents") for ev in (b.get(k) or [])))
print("block event keys:", sorted({k for b in blocks for t in ("moveXEvents","moveYEvents","rotateEvents","scaleXEvents","scaleYEvents") for ev in (b.get(t) or []) for k in ev}))
print("block name nonempty:", sum(1 for b in blocks if b.get("Name")))

# line stats
print("\nlines:", len(lines), " notes:", sum(len(l.get("notes", [])) for l in lines))
print("numOfNotes==len(notes):", all(l.get("numOfNotes") == len(l.get("notes", [])) for l in lines))
print("eventLayers per line:", Counter(len(l.get("eventLayers") or []) for l in lines))
print("extended keys:", Counter(k for l in lines for k in (l.get("extended") or {})))
print("line keys:", sorted(lines[0].keys()))
print("alphaControl sample:", json.dumps(lines[0]["alphaControl"][0], ensure_ascii=False))
print("posControl sample:", json.dumps(lines[0]["posControl"][0], ensure_ascii=False))
print("yControl sample:", json.dumps(lines[0]["yControl"][0], ensure_ascii=False))
print("sizeControl sample:", json.dumps(lines[0]["sizeControl"][0], ensure_ascii=False))
print("skewControl sample:", json.dumps(lines[0]["skewControl"][0], ensure_ascii=False))
print("inclineEvents sample:", json.dumps(lines[0]["extended"]["inclineEvents"][0], ensure_ascii=False))
print("META.keys:", sorted(rpe["META"].keys()))
print("judgeLineGroup:", rpe["judgeLineGroup"], "multiLineString:", rpe["multiLineString"], "multiScale:", rpe["multiScale"])
print("has globalEvents:", "globalEvents" in rpe, " noiseAreaOptions:", "noiseAreaOptions" in rpe)
print("BPMList:", rpe["BPMList"])

# note stats
notes = [n for l in lines for n in l.get("notes", [])]
print("\nnotes:", len(notes), "by type:", dict(Counter(n["type"] for n in notes)))
print("hold(end>start) count:", sum(1 for n in notes if n["endTime"] != n["startTime"]))
print("alpha values:", dict(Counter(n["alpha"] for n in notes)))
print("speed values:", dict(Counter(n["speed"] for n in notes)))
print("size values:", dict(Counter(n["size"] for n in notes)))
print("yOffset values:", dict(Counter(n["yOffset"] for n in notes)))
print("above values:", dict(Counter(n["above"] for n in notes)))
print("visibleTime values:", dict(Counter(n["visibleTime"] for n in notes)))
print("isFake values:", dict(Counter(n["isFake"] for n in notes)))
print("note keys:", sorted(notes[0].keys()))

# last note beat & duration consistency
def beats(t):
    return t[0] + t[1] / t[2]
last = max(beats(n["endTime"]) for n in notes)
print("last note end beat:", last, " bpm:", rpe["BPMList"][0]["bpm"], " -> sec:", last * 60 / rpe["BPMList"][0]["bpm"])

print("\n########## fmt2 (Class Memories) ##########")
flines = fmt["lines"]
print("keys:", sorted(fmt.keys()))
print("lines:", len(flines), "indexes:", [l["index"] for l in flines])
allnotes = [n for l in flines for n in l["notes"]]
allanims = [a for l in flines for a in l["animations"]]
print("notes:", len(allnotes), "types:", dict(Counter(n["type"] for n in allnotes)),
      "elapsed(endTime>time):", sum(1 for n in allnotes if n["endTime"] != n["time"]),
      "by type elapsed:", dict(Counter(n["type"] for n in allnotes if n["endTime"] != n["time"])))
print("note index unique:", len({n["index"] for n in allnotes}) == len(allnotes), " range:", min(n["index"] for n in allnotes), max(n["index"] for n in allnotes))
print("anim index unique:", len({a["index"] for a in allanims}) == len(allanims), " range:", min(a["index"] for a in allanims), max(a["index"] for a in allanims))
print("anim types:", dict(sorted(Counter(a["type"] for a in allanims).items())))
print("bearer_type:", dict(Counter(a["bearer_type"] for a in allanims)))
print("notes per line:", [len(l["notes"]) for l in flines])
print("anims per line:", [len(l["animations"]) for l in flines])
print("origins: note index order within line monotonic:",
      all([n["index"] for n in l["notes"]] == sorted(n["index"] for n in l["notes"]) for l in flines))
print("anim sorted by startTime within line:", all(
    [beats(a["startTime"]) for a in l["animations"]] == sorted(beats(a["startTime"]) for a in l["animations"]) for l in flines))
print("ease types:", dict(Counter((a["ease"]["type"], a["ease"]["press"]) for a in allanims)))
# percentiles for position types
for ty in (0, 1):
    vals = [a["start"] for a in allanims if a["type"] == ty] + [a["end"] for a in allanims if a["type"] == ty]
    print("type %d position percentiles(0,5,50,95,100):" % ty, pct(vals))
print("type 2 transparency start/end samples:", [(a["start"], a["end"]) for a in allanims if a["type"] == 2][:20])
print("type 5 flow speed:", [(a["start"], a["end"], a["bearer"]) for a in allanims if a["type"] == 5])
print("type 8 values:", Counter((a["start"], a["end"]) for a in allanims if a["type"] == 8))
print("type 3 size values:", Counter((a["start"], a["end"]) for a in allanims if a["type"] == 3))
print("type 4 rotation percentiles:", pct([a["start"] for a in allanims if a["type"] == 4]))
print("storyboards:", fmt["storyboards"])
print("editor:", json.dumps(fmt["editor"], ensure_ascii=False))
print("meta:", json.dumps(fmt["meta"], ensure_ascii=False))
print("bpms:", fmt["bpms"])
lastn = max(beats(n["endTime"]) for n in allnotes)
print("last note beat:", lastn, " bpm:", fmt["bpms"][0]["bpm"], " -> sec:", lastn * 60 / fmt["bpms"][0]["bpm"])
