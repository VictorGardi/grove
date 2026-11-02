---
feature: 2026-11-02-osv-scanner-security-fixes
phase: outcome
status: approved
version: 1
created: 2026-11-02
updated: 2026-11-02
approved_at: 2026-11-02
based_on: []
forced: []
---

# Outcome: OSV scanner in CI and security fixes

## Summary

Grove gets its first CI: a dependency vulnerability scan (OSV) that runs on pull requests, weekly, and on demand, plus separate test, typecheck and build checks on pull requests. The 9 vulnerabilities `npm audit` reports today (1 critical, 4 high, 2 moderate, 2 low, all with non-major fixes) get fixed. The low-risk hardening findings from the security review get fixed too. The control socket stays as designed and the risk is documented. Known vulnerable dependencies cannot creep back in unnoticed, and the app is harder to attack.

## What the human sees and does

- Opening or updating a PR shows four separate checks: vulnerability scan, tests, typecheck, build. A failing check is visible before merge.
- A new advisory against an untouched package shows up as a failed scan on the next PR or the weekly run, not silently.
- The scan also runs weekly and has a manual "run" button in GitHub. It does not run on push to master. Weekly and manual failures appear as a failed Actions run with GitHub's standard email; no custom alerting.
- A vulnerability with no available fix, or one the human judges acceptable, goes on a reviewed ignore list kept in the repo. Each entry has a reason and an expiry date. When an entry expires the check fails again.
- The spikes/electron lockfile is scanned too, but its findings never block a PR.
- The accepted control-socket risk (ADR 0027: no token or peer check) is recorded as a short note next to ADR 0027, not as a CI ignore entry.
- The human reviews the dependency upgrades and the hardening changes like any other change.

## Non-goals

- No authentication or other change to the local control socket; documented only.
- No work on larger design findings beyond documenting them, such as an IPC channel allowlist, sender validation, or preload rework (research finding 3).
- No CI trigger on push to master.
- No custom notifications (Slack, issues, dashboards).
- No blocking on the spikes/electron lockfile.
- No packaging or release pipeline.
- No major-version upgrades.
- No Node version pinning or toolchain policy beyond what CI needs to run.

## How I'll know it works

- Of the 9 reported vulnerabilities, each is gone from the scan, or is on the ignore list only where no fix exists, with a reason and expiry.
- A PR shows all four checks and the scan passes on a clean tree.
- The scan fails when a vulnerable package is introduced and passes again once it is fixed or listed. An expired ignore entry makes the check fail again.
- The weekly schedule and the manual button each produce a scan run; the scan does not run on push to master.
- spikes/electron findings are visible in the scan output but never turn a check red.
- Tests, typecheck and build are green after the dependency upgrades.
- The low-risk code hardening items are fixed: research findings 1, 4, 5, 6, 7, 8, 9, 10 and 11 (artifact-iframe external open, window and CSP hardening, git in untrusted repos, branch-name validation, control characters in pasted text, discovery-root escape, temp-file name, check-then-read gap), subject to the human's judgement on each at plan time.
- Finding 3 (IPC allowlist) is out; finding 2 (socket) is documented only.

## Interview log

**Q1. Which of the findings should be fixed as part of this feature?**
Background: 9 vulnerable packages (1 critical, 4 high), all with non-major fixes; 11 code findings, none high; the unauthenticated control socket is a deliberate design (ADR 0027).
Options: A deps only; B deps + low-risk hardening, socket stays and is recorded as accepted risk (recommended); C B + socket authentication; D deps + medium findings only.
**Answer: B.**

**Q2. When the OSV scan finds a vulnerability in CI, should it fail the check or only warn?**
Background: no CI exists today; new advisories can appear against untouched packages; some may be unfixable or dev-only.
Options: A fail on any; B fail on high/critical only; C warn only; D fail on any with a reviewed ignore list (reason + expiry) (recommended).
**Answer: D.**

**Q3. When should the OSV scan run in CI?**
Background: no CI today; the repo is on GitHub. The human asked whether a push to master equals opening a PR (answer: no, a PR check runs before merge) and said they want the PR trigger, not push to master.
Options: push to master; schedule; both; both plus manual button. Revised after clarification: PR only; PR + weekly schedule + manual button (recommended); PR + manual button.
**Answer: runs on opened/updated pull requests, weekly on a schedule, and on demand from GitHub; not on push to master.**

**Q4. On pull requests, should CI run only the vulnerability scan, or also tests, typecheck and build?**
Background: no CI today; dependency upgrades can break tests or build; no Node version is pinned.
Options: A scan only; B scan + test, typecheck, build as separate checks (recommended); C scan + test + typecheck; D scan only, rest as follow-up.
**Answer: B.**

**Q5. Confirm the playback of the brief.**
Flagged: finding 3 (IPC allowlist, sender validation) is out of scope though "input validation" in Q1 could be read as covering it.
**Answer: Yes, correct. IPC hardening stays out, noted as follow-up.**

## Open questions
