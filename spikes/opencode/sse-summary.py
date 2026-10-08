#!/usr/bin/env python3
"""Summarise a raw SSE capture: one line per event (type, aggregate/seq, location.directory, short data keys)."""
import json, sys
for line in open(sys.argv[1]):
    if not line.startswith("data: "): continue
    e = json.loads(line[6:])
    d = e.get("data", {})
    dur = e.get("durable") or {}
    loc = (e.get("location") or {}).get("directory", "")
    extra = ""
    if isinstance(d, dict):
        extra = ",".join(sorted(d.keys()))
    print(f'{e["type"]:<40} seq={dur.get("seq","-")!s:<4} loc={"Y" if loc else "-"} keys={extra}')
