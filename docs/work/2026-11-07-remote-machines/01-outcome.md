---
feature: 2026-11-07-remote-machines
phase: outcome
status: draft
version: 1
created: 2026-11-07
updated: 2026-11-07
approved_at:
based_on: []
forced: []
---

# Outcome: remote machines

## Interview log

**Q1. When you add the Pi as a machine, what should you be able to do with it from the Mac app?**
Options: A view only; B full everyday parity (see, open, create spaces, shells, agents; agents keep running on the Pi and reappear on reconnect); C parity plus extras (settings, keys, themes, diffs). Recommended B.
**Answer: B, full everyday parity.**

**Q2. How should Grove get onto the Pi in the first place?**
Options: A one install command the human runs on the Pi; B the app sets it up over ssh; C both with fallback. Recommended A.
**Answer: A, one install command run on the Pi.**

**Q3. When the Pi can't be reached (network down, Mac just woke), what happens in the sidebar?**
Options: A greyed, reconnect by hand; B greyed, reconnects by itself, tabs reattach; C B plus an "unreachable since" notice. Recommended B.
**Answer: B, greyed and reconnects by itself.**

**Q4. How do you add the Pi as a machine?**
Options: A dialog only; B command only; C dialog, command and agent; D dialog plus agent. Recommended C.
**Answer (corrected by the human after first picking D): an in-app button plus a Grove CLI command. No separate agent route.**

## Open questions
