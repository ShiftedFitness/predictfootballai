#!/usr/bin/env python3
"""Pretty-print a picks-ai JSON response. Reads stdin, writes a summary.

Split out of picks-ai-run.sh rather than inlined: embedding Python inside a
bash heredoc means nested-quote escaping that is easy to get subtly wrong and
impossible to test on its own.
"""
import json
import sys


def main():
    raw = sys.stdin.read()
    try:
        d = json.loads(raw)
    except Exception:
        print(raw)
        return 0

    if d.get("error"):
        print("ERROR: " + str(d["error"]))
        return 1

    if not d.get("ok"):
        print(json.dumps(d, indent=2))
        return 0

    if d.get("message"):
        print(d["message"])
        print()

    picks = d.get("picks") or []
    if picks:
        print("PICKS")
        for p in picks:
            head = "  match {0}  {1:<5} (confidence {2}/5)".format(
                p.get("match_id"), p.get("pick"), p.get("confidence"))
            print(head)
            if p.get("rationale"):
                print("      " + p["rationale"])
        print()

    if d.get("strategy"):
        print("STRATEGY")
        print("  " + d["strategy"])
        print()

    fields = [
        ("week", "week"),
        ("isFinal", "final picks"),
        ("replacedProvisional", "replaced provisional"),
        ("oddsRefreshed", "odds refreshed"),
        ("searches", "web searches"),
        ("estimatedCostUsd", "cost (USD)"),
        ("picksWritten", "picks written"),
        ("turns", "model turns"),
    ]
    for key, label in fields:
        if d.get(key) is not None:
            print("  {0:<22} {1}".format(label, d[key]))

    usage = d.get("usage") or {}
    if usage:
        print("  {0:<22} {1} / {2}".format(
            "tokens in/out",
            usage.get("input_tokens", "?"),
            usage.get("output_tokens", "?")))

    if d.get("skipped"):
        print()
        print("SKIPPED")
        for s in d["skipped"]:
            print("  - " + str(s))

    if d.get("note"):
        print()
        print("  " + d["note"])

    return 0


if __name__ == "__main__":
    sys.exit(main())
