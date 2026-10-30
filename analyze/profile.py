"""Profile two chart JSON files: list structure, key unions, value ranges, sample items.

Pure read-only analysis. Usage:
    python profile.py <path> [<path> ...]
"""
import json
import sys
from collections import Counter


def describe(v):
    if isinstance(v, dict):
        return "object"
    if isinstance(v, list):
        return "array[%d]" % len(v)
    if isinstance(v, bool):
        return "bool"
    if isinstance(v, int):
        return "int"
    if isinstance(v, float):
        return "float"
    if v is None:
        return "null"
    return "str"


def keyset_report(obj, path, out, depth, max_depth):
    """Recursively describe dict/list structure, collecting keyset frequencies."""
    if depth > max_depth:
        return
    if isinstance(obj, dict):
        out.append("  " * depth + "%s {object, %d keys}: %s" % (
            path, len(obj), ", ".join(list(obj.keys())[:40])))
        for k, v in obj.items():
            keyset_report(v, k, out, depth + 1, max_depth)
    elif isinstance(obj, list):
        types = Counter(describe(x) for x in obj)
        out.append("  " * depth + "%s [array, %d items] item-types: %s" % (
            path, len(obj), dict(types)))
        if obj:
            # profile first item and merge key counts across all dict items
            if isinstance(obj[0], dict):
                key_counts = Counter()
                for it in obj:
                    if isinstance(it, dict):
                        key_counts.update(it.keys())
                out.append("  " * depth + "  keys seen across items (count): " +
                           ", ".join("%s=%d" % (k, c) for k, c in key_counts.most_common(60)))
                keyset_report(obj[0], path + "[0]", out, depth + 1, max_depth)
            elif isinstance(obj[0], list):
                keyset_report(obj[0], path + "[0]", out, depth + 1, max_depth)


def main():
    for path in sys.argv[1:]:
        print("=" * 100)
        print("FILE:", path)
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
        print("TOP TYPE:", describe(data))
        if isinstance(data, dict):
            print("TOP KEYS (%d):" % len(data))
            for k, v in data.items():
                extra = ""
                if isinstance(v, dict):
                    extra = " keys=%s" % list(v.keys())[:20]
                elif isinstance(v, list):
                    extra = " len=%d" % len(v)
                print("  %-24s %-14s%s" % (k, describe(v), extra))
            print()
            print("-" * 100)
            print("STRUCTURE (depth<=4):")
            out = []
            keyset_report(data, "$", out, 0, 4)
            print("\n".join(out))


if __name__ == "__main__":
    main()
