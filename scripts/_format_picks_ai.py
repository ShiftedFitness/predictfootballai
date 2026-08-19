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

    # GET picks-ai-trigger returns a list of recorded runs.
    if "runs" in d:
        runs = d.get("runs") or []
        if not runs:
            print("No runs recorded yet.")
            return 0
        for r in runs:
            detail = r.get("detail") or {}
            kind = "DRY RUN" if detail.get("dryRun") else (
                "FINAL" if r.get("is_final") else "PROVISIONAL")
            print("{0}  week {1}  [{2}]".format(
                (r.get("created_at") or "")[:19].replace("T", " "),
                r.get("week_number"), kind))
            if r.get("strategy"):
                print("  strategy: " + r["strategy"])
            picks = detail.get("proposedPicks") or []
            for p in picks:
                print("    {0:<5} (conf {1}/5)  {2}".format(
                    p.get("pick"), p.get("confidence"), p.get("rationale") or ""))
            print("    {0} picks written | {1} searches | ${2} | {3} in / {4} out".format(
                r.get("picks_written"), r.get("web_searches"),
                r.get("estimated_cost_usd"), r.get("input_tokens"), r.get("output_tokens")))
            hrs = detail.get("hoursBeforeLockout")
            if hrs is not None:
                print("    {0}h before lockout".format(hrs))
            print()
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
