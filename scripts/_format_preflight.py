#!/usr/bin/env python3
"""Format the week-results preflight response. Reads stdin.

A separate file, not inlined in the shell script: the first attempt embedded
this in a heredoc and the f-string quotes broke the shell parse. Same lesson
as _format_picks_ai.py.
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

    print("OVERALL: " + ("READY" if d.get("ok") else "SOMETHING IS WRONG"))
    print()

    for name, c in (d.get("checks") or {}).items():
        if "ready" in c:
            ok = c.get("ready")
            detail = c.get("reason") or "{0} fixtures, {1} picks scored".format(
                c.get("fixtures", "?"), c.get("picks", "?"))
        else:
            ok = c.get("pass")
            detail = c.get("detail", "")

        mark = "PASS" if ok else ("FAIL" if ok is False else " ?? ")
        print("  [{0}] {1}".format(mark, name))
        if detail:
            print("         " + str(detail))
        if c.get("missingEmail"):
            print("         no email on file: " + ", ".join(c["missingEmail"]))
        if c.get("alreadySent"):
            print("         already emailed at " + str(c["alreadySent"]))
    return 0


if __name__ == "__main__":
    sys.exit(main())
