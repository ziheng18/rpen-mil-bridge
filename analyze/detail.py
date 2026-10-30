"""Deep field-level profile of the two chart JSON formats. Read-only."""
import json
import sys
from collections import Counter, OrderedDict


def tstr(t):
    return "[%s]" % ",".join(str(x) for x in t) if isinstance(t, list) else repr(t)


def frac(t):
    if isinstance(t, list) and len(t) == 3:
        return "%d+%d/%d" % (t[0], t[1], t[2])
    return repr(t)


def union_keys(items):
    c = Counter()
    for it in items:
        if isinstance(it, dict):
            c.update(it.keys())
    return c


def ranges(items, key):
    vals = [it[key] for it in items if isinstance(it, dict) and key in it]
    vals = [v for v in vals if isinstance(v, (int, float)) and not isinstance(v, bool)]
    if not vals:
        return "(none)"
    return "n=%d min=%s max=%s" % (len(vals), min(vals), max(vals))


def hist(items, key):
    c = Counter()
    for it in items:
        if isinstance(it, dict) and key in it:
            v = it[key]
            if isinstance(v, list):
                c[tstr(v)] += 1
            else:
                c[v] += 1
    return c


def dump_denoms(obj, path="$", denoms=None, times=None):
    if denoms is None:
        denoms = Counter()
        times = []
    if isinstance(obj, dict):
        for k, v in obj.items():
            if k in ("startTime", "endTime", "time", "appearTime", "disappearTime") and isinstance(v, list) and len(v) == 3 and all(isinstance(x, int) for x in v):
                denoms[v[2]] += 1
                times.append(tuple(v))
                if 0 <= v[1] < v[2]:
                    pass
                else:
                    times[-1] = ("BAD",) + times[-1]
            else:
                dump_denoms(v, path + "." + k, denoms, times)
    elif isinstance(obj, list):
        for i, v in enumerate(obj):
            dump_denoms(v, path + "[]", denoms, times)
    return denoms, times


def pretty(obj):
    return json.dumps(obj, ensure_ascii=False, indent=2)


def main():
    rpen_path = r"E:\File\deepseek harness\mil\extracted\water_pez\0130923863793952.json"
    fmt2_path = r"E:\File\deepseek harness\mil\extracted\class_memories\chart.json"

    with open(rpen_path, encoding="utf-8") as f:
        rpe = json.load(f)
    with open(fmt2_path, encoding="utf-8") as f:
        fmt = json.load(f)

    print("#" * 110)
    print("# PART 1: RPEN / RPE-Next chart")
    print("#" * 110)
    print("\n== META ==")
    print(pretty(rpe["META"]))
    print("\n== judgeLineGroup ==", rpe["judgeLineGroup"])
    print("== multiLineString ==", rpe["multiLineString"])
    print("== multiScale ==", rpe["multiScale"])
    print("\n== BPMList ==")
    print(pretty(rpe["BPMList"]))
    print("\n== noiseAreaLayers ==")
    print(pretty(rpe["noiseAreaLayers"]))
    print("\n== effects ==", pretty(rpe["effects"]))

    lines = rpe["judgeLineList"]
    print("\n== judgeLineList: %d lines ==" % len(lines))
    line_key_union = union_keys(lines)
    print("line keys:", ", ".join("%s=%d" % (k, c) for k, c in line_key_union.most_common()))
    all_notes = []
    for i, ln in enumerate(lines):
        ncnt = len(ln.get("notes", []))
        ecnt = {k: len(v) for k, v in (ln.get("eventLayers") or [{}])[0].items() if isinstance(v, list)} if ln.get("eventLayers") else {}
        ext = ln.get("extended", {})
        print("line %2d: Name=%-12r Texture=%-10r Group=%s father=%s isCover=%s isGif=%s zOrder=%s bpmfactor=%s anchor=%s numOfNotes=%s notes=%d rotateWithFather=%s controls(a,p,s,sk,y)=%d,%d,%d,%d,%d extended=%s events=%s"
              % (i, ln.get("Name"), ln.get("Texture"), ln.get("Group"), ln.get("father"), ln.get("isCover"), ln.get("isGif"),
                 ln.get("zOrder"), ln.get("bpmfactor"), ln.get("anchor"), ln.get("numOfNotes"), ncnt,
                 ln.get("rotateWithFather"), len(ln.get("alphaControl") or []), len(ln.get("posControl") or []),
                 len(ln.get("sizeControl") or []), len(ln.get("skewControl") or []), len(ln.get("yControl") or []),
                 list(ext.keys()), ecnt))
        all_notes.extend(ln.get("notes", []))

    print("\n-- all notes: %d --" % len(all_notes))
    print("note keys:", ", ".join("%s=%d" % (k, c) for k, c in union_keys(all_notes).most_common()))
    print("note type hist:", dict(hist(all_notes, "type")))
    print("note above hist:", dict(hist(all_notes, "above")))
    print("note isFake hist:", dict(hist(all_notes, "isFake")))
    for key in ("positionX", "size", "speed", "visibleTime", "yOffset", "alpha"):
        print("range %-11s: %s" % (key, ranges(all_notes, key)))
    seen_types = sorted(set(n["type"] for n in all_notes))
    for ty in seen_types:
        sample = [n for n in all_notes if n["type"] == ty][0]
        print("\nsample note type=%s: %s" % (ty, pretty(sample)))
    # find notes with endTime != startTime
    holds = [n for n in all_notes if n.get("endTime") != n.get("startTime")]
    print("\nnotes with endTime != startTime: %d ; sample:" % len(holds))
    if holds:
        print(pretty(holds[0]))
    print("note startTime denominator hist:", dict(Counter(n["startTime"][2] for n in all_notes)))
    print("note startTime note: n[1]<n[2] always? ", all(n["startTime"][1] < n["startTime"][2] for n in all_notes))

    print("\n-- event layer samples --")
    first_ln = lines[0]
    el = (first_ln.get("eventLayers") or [{}])[0]
    for arr_name, arr in el.items():
        if isinstance(arr, list) and arr:
            print("\n%s: %d events; fields: %s" % (arr_name, len(arr), ", ".join(union_keys(arr).keys())))
            print("sample:", pretty(arr[0]))
    for ctl in ("alphaControl", "posControl", "sizeControl", "skewControl", "yControl"):
        arr = first_ln.get(ctl) or []
        print("\n%s: %d entries; sample:" % (ctl, len(arr)))
        if arr:
            print(pretty(arr[0]))
    print("\nextended of line0:", pretty(first_ln.get("extended")))
    print("\nrotateWithFather line: ", pretty([ln for ln in lines if "rotateWithFather" in ln][0]))

    # event type histograms over the whole chart
    print("\n-- event arrays: global histograms --")
    agg = {}
    for ln in lines:
        for layer in ln.get("eventLayers") or []:
            for name, arr in layer.items():
                if isinstance(arr, list):
                    agg.setdefault(name, []).extend(arr)
    for name, arr in agg.items():
        print("%-12s n=%-5d fields=%s" % (name, len(arr), ",".join(sorted(union_keys(arr).keys()))))
        if arr:
            print("    easingType hist:", dict(hist(arr, "easingType")))
            print("    bezier hist:", dict(hist(arr, "bezier")))
    print("\nline-level extended inclineEvents total:", sum(len(ln.get("extended", {}).get("inclineEvents", [])) for ln in lines))

    # blockAreaList
    blocks = rpe.get("blockAreaList", [])
    print("\n== blockAreaList: %d ==" % len(blocks))
    print("keys:", ", ".join("%s=%d" % (k, c) for k, c in union_keys(blocks).most_common()))
    for i, b in enumerate(blocks[:3]):
        print("\nblockArea[%d]: %s" % (i, pretty(b)))
    print("\nblock activeIntervals non-empty:", sum(1 for b in blocks if b.get("activeIntervals")))
    print("block layerId hist:", dict(hist(blocks, "layerId")))
    print("block isInvert hist:", dict(hist(blocks, "isInvert")))
    print("block moveXEvents total:", sum(len(b.get("moveXEvents") or []) for b in blocks))
    print("block moveYEvents total:", sum(len(b.get("moveYEvents") or []) for b in blocks))
    print("block scaleXEvents total:", sum(len(b.get("scaleXEvents") or []) for b in blocks))
    print("block rotateEvents total:", sum(len(b.get("rotateEvents") or []) for b in blocks))

    # time denominators
    denoms, _ = dump_denoms(rpe)
    print("\nRPEN: time-array denominator histogram:", dict(denoms))

    print("\n" + "#" * 110)
    print("# PART 2: fmt=2 chart (milracle?)")
    print("#" * 110)
    print("\n== fmt ==", fmt["fmt"])
    print("\n== meta ==")
    print(pretty(fmt["meta"]))
    print("\n== bpms ==")
    print(pretty(fmt["bpms"]))
    print("\n== storyboards ==", pretty(fmt["storyboards"]))
    print("\n== editor ==")
    print(pretty(fmt["editor"]))

    lines = fmt["lines"]
    print("\n== lines: %d ==" % len(lines))
    print("line keys:", ", ".join("%s=%d" % (k, c) for k, c in union_keys(lines).most_common()))
    print("line index values:", [ln["index"] for ln in lines])
    all_notes = []
    all_anims = []
    for i, ln in enumerate(lines):
        notes = ln.get("notes", [])
        anims = ln.get("animations", [])
        print("line %2d: index=%-3s notes=%3d animations=%3d" % (i, ln.get("index"), len(notes), len(anims)))
        all_notes.extend(notes)
        all_anims.extend(anims)
    print("\n-- all notes: %d --" % len(all_notes))
    if all_notes:
        print("note keys:", ", ".join("%s=%d" % (k, c) for k, c in union_keys(all_notes).most_common()))
        print("note type hist:", dict(hist(all_notes, "type")))
        print("note isFake hist:", dict(hist(all_notes, "isFake")))
        print("note isAlwaysPerfect hist:", dict(hist(all_notes, "isAlwaysPerfect")))
        for key in ("positionX", "size", "speed", "visibleTime", "yOffset", "alpha"):
            if key in union_keys(all_notes):
                print("range %-11s: %s" % (key, ranges(all_notes, key)))
        for ty in sorted(set(n["type"] for n in all_notes)):
            sample = [n for n in all_notes if n["type"] == ty][0]
            print("\nsample note type=%s: %s" % (ty, pretty(sample)))
        holds = [n for n in all_notes if n.get("endTime") != n.get("startTime")]
        print("\nnotes with endTime != startTime: %d ; sample:" % len(holds))
        if holds:
            print(pretty(holds[0]))

    print("\n-- all animations: %d --" % len(all_anims))
    print("anim keys:", ", ".join("%s=%d" % (k, c) for k, c in union_keys(all_anims).most_common()))
    print("anim type hist:", dict(hist(all_anims, "type")))
    print("anim bearer_type hist:", dict(hist(all_anims, "bearer_type")))
    print("anim bearer hist:", dict(hist(all_anims, "bearer")))
    for ty in sorted(set(a["type"] for a in all_anims)):
        sample = [a for a in all_anims if a["type"] == ty][0]
        print("\nsample anim type=%s: %s" % (ty, pretty(sample)))
    ease_objs = [a["ease"] for a in all_anims if isinstance(a.get("ease"), dict)]
    print("\nease keys:", ", ".join("%s=%d" % (k, c) for k, c in union_keys(ease_objs).most_common()))
    print("ease.type hist:", dict(hist(ease_objs, "type")))
    print("ease.press hist:", dict(hist(ease_objs, "press")))
    print("ease.isValueExp hist:", dict(hist(ease_objs, "isValueExp")))
    print("ease.cusValueExp values:", dict(hist(ease_objs, "cusValueExp")))
    print("anim index range:", ranges(all_anims, "index"))
    print("anim start range:", ranges(all_anims, "start"))
    print("anim end range:", ranges(all_anims, "end"))
    print("anim startTime denom hist:", dict(Counter(a["startTime"][2] for a in all_anims)))
    print("anim endTime denom hist:", dict(Counter(a["endTime"][2] for a in all_anims)))
    print("anim endTime==startTime count:", sum(1 for a in all_anims if a["endTime"] == a["startTime"]))

    denoms, _ = dump_denoms(fmt)
    print("\nfmt2: time-array denominator histogram:", dict(denoms))


if __name__ == "__main__":
    main()
