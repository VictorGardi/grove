Status: shipped

> **Shipped on branch `usage-stats`.** The spec below is kept as written except where marked **Superseded** or **Changed**: the saved record of ADR 0003 was never kept (ADR 0004: the history is built in memory from the agents' files at every start), the per-agent "Where it ran" section was removed (62d03dd), and the panel gained hover, focus and keyboard behaviour (92313f5) and per-agent "no record" days.

# Usage statistics: a usage panel for Claude and Copilot

Decisions behind this spec: `brief.md`, `decision-log.md`, `research-*.md` in this folder, and ADR 0004 (`docs/adr/0004-usage-from-the-agents-files.md`), which supersedes ADR 0003 (`docs/adr/0003-usage-history.md`, the saved record this spec first described). Glossary terms used: **Request**, **Usage panel**, **Usage history**, **Not tracked by Grove**, **Module**, **Space**, **Context level**.

## Problem Statement

I run Claude and Copilot all day, in Grove tabs and elsewhere, and I cannot see how much I use them. Grove shows only how full one tab's context window is. I cannot see which days I worked hardest, which model or repository the work went to, when in the day I work, or what Copilot is costing me in credits. The agents keep their own records, but those records are scattered, repeat themselves, and are deleted after a while (terminal Claude after 30 days by default), so any history I could piece together shrinks over time. *(Accepted, not solved: ADR 0004 shows what the agents' files still hold and says "no record" for days older than that.)*

## Solution

A **usage panel** in the dock. For each agent that made a **request** in the last 30 days (Claude, Copilot) it shows a GitHub-style day matrix, where a darker day means more requests, plus Today / 7 days / 30 days totals. Click a day to see its breakdown: requests, tokens, models, the share made by helper agents and, for Copilot, credits. Pointing at or focusing a day links it across the panel, and one tooltip names it. Under the matrices are stacked bars for the selected range, "When you work" (weekday by hour) and "Where it went" (by repository, with models as a second breakdown). The numbers come from **usage history**: one entry per request, built in memory from the agents' own files at every start and never saved, so the panel shows what the agents still hold (ADR 0004; ADR 0003's saved record is superseded). The panel never freezes Grove, even on the first scan of gigabytes of history.

OpenCode has no panel section and no placeholder. Its requests made on Copilot's models still count, under Copilot, tagged "via OpenCode".

## User Stories

1. As a Grove user, I want a usage panel in the dock, so that I can see my agent usage without leaving Grove.
2. As a Grove user, I want the panel opened by a key like the other dock panels, and a button in the dock rail, so that I reach it the way I reach the diff panel.
3. As a Grove user, I want each agent to have its own day matrix, so that a busy Claude day and a busy Copilot day are never mixed in one shade.
4. As a Grove user, I want a darker day to mean more requests, so that I can spot my heaviest days at a glance.
5. As a Grove user, I want the shades to be quartiles of my own days, so that one giant day does not wash out all the others.
6. As a Grove user, I want the shades to differ in lightness and not only in hue, and to meet contrast guidance, so that the matrix is readable for colour-blind users.
7. As a Grove user, I want to click a day to see its breakdown, so that I can learn what made it heavy.
8. As a Grove user, I want a day's breakdown to show requests, tokens (fresh input, output, and cache shown separately), and models, so that I understand the request count behind it.
9. As a Grove user, I want the day detail to show "of which helper agents" as a share of that day's requests, so that I can tell my own prompting from background work.
10. As a Grove user, I want Today, last 7 days and last 30 days totals per agent, so that I get the headline numbers without reading the matrix.
11. As a Grove user, I want stacked bars for the selected range, with the agents in distinct colours, so that I see how big each day was and who made it.
12. As a Grove user, I want the stacked bars to mark requests made through OpenCode on Copilot's models, so that I can see that part of Copilot's total.
13. As a Grove user, I want a "When you work" view by weekday and hour, so that I can see the rhythm of my week.
14. As a Grove user, I want a "Where it went" view by repository, so that I can see which projects take my agents' time.
15. As a Grove user, I want worktrees rolled up into their main checkout in "Where it went", so that one project is not split into many rows.
16. As a Grove user, I want the repositories that are current Spaces marked, so that I can tell my Grove projects from other folders.
17. As a Grove user, I want folders with no repository or Space, such as scratch folders and my home folder, grouped under "Other", so that the list stays short.
18. As a Grove user, I want a second breakdown by model, so that I can see how much goes to which model.
19. As a Grove user, I want an agent to appear only when it made a request in the last 30 days, so that I never see an empty matrix.
20. As a Grove user, I want one plain "no usage in the last 30 days" message when no agent qualifies, so that an empty panel is not confusing.
21. ~~As a Grove user, I want an agent I have not used for 30 days to come back, with its saved history, when I use it again, so that nothing is lost by it being hidden.~~ **Superseded (ADR 0004):** an agent I have not used for 30 days is hidden and comes back, with whatever its files still hold, when I use it again. Nothing is saved, so nothing is kept for it.
22. As a Grove user, I want Claude's figures to cover everything on this machine, including sessions I started outside Grove, so that the totals match the work I actually did.
23. As a Grove user, I want Claude Desktop sessions included in Claude's numbers as a separate slice, so that my long Desktop history counts and I can still tell it from terminal work.
24. As a Grove user, I want Claude's sources labelled "Claude Desktop", "Claude Code run in Grove" and "Claude Code not tracked by Grove", so that I know where the numbers came from. **Changed (62d03dd):** the labels appear in a day's detail only; the per-agent "Where it ran, 30 days" section was removed.
25. As a Grove user, I want the Grove-versus-not-tracked split shown only from 2026-11-05, the day Grove began recording its sessions, with "can't tell" before it, so that I am never shown a confident figure that is a guess. **Changed (62d03dd):** shown in a day's detail (with the note naming the date Grove began recording), no longer in a section of its own.
26. As a Grove user, I want Copilot's split between sessions Grove ran and others based on Grove's own session records, so that it is correct back to Copilot's first session.
27. As a Grove user, I want Copilot's credits shown, with no dollar sign, so that I can see what Copilot costs me in its own unit.
28. As a Grove user, I want no cost shown for Claude, so that I am never shown an estimate that looks exact.
29. As a Grove user, I want credits never added to Claude's numbers or to anything else, so that two different units are not mixed.
30. As a Grove user, I want a Copilot credit total that includes requests without a credit figure to read "plus N requests without credits", so that I know the total is partial.
31. As a Grove user, I want requests that OpenCode sends to Copilot's models counted once, under Copilot and tagged "via OpenCode", so that my Copilot totals are complete.
32. As a Grove user, I want OpenCode's other requests left out of the panel, so that the panel stays about Claude and Copilot until OpenCode is ready.
33. As a Grove user, I want helper agents' requests included in every total, so that the totals match what the provider counts.
34. As a Grove user, I want a request counted once even though the agent's own records repeat it across lines, files and resumed sessions, so that totals are not roughly doubled.
35. As a Grove user, I want a later, larger token count for the same request to replace an earlier partial one, so that streamed responses are counted in full.
36. ~~As a Grove user, I want my history to survive after Claude deletes its old terminal sessions or I prune Copilot's, so that the matrix does not shrink.~~ **Superseded (ADR 0004):** the matrix shows what the agents' files still hold and is shorter after an agent prunes. This is the accepted loss.
37. ~~As a Grove user, I want the panel to say "history from <date>", so that I know how far back the record really goes.~~ **Superseded (ADR 0004):** no "history from" line. A day before an agent's first request is drawn as "no record that far back" (see 38).
38. As a Grove user, I want days before an agent's own earliest request to be honestly "no record that far back" rather than shown as zero activity, so that the matrix does not claim I did nothing. **Changed:** the earliest day is per agent (`from` in the summary), so Copilot's days before its first request are "no record" even when Claude's files reach further back; where agents are drawn together (the bars, a day's tip) a day is "no record" only before the earliest request of all of them.
39. ~~As a Grove user, I want a way to wipe the saved history, and the "history from" date to reset when I do, so that I stay in control of what Grove keeps.~~ **Superseded (ADR 0004):** there is nothing saved to wipe. The file an earlier build wrote (`usage-history.json`, its temp files and `.corrupt-*` copies) is removed when the core starts.
40. ~~As a Grove user, I want the saved record readable only by me, so that the project folders it names stay private.~~ **Superseded (ADR 0004):** nothing is saved, so there is nothing to protect.
41. As a Grove user, I want the usage history to contain no conversation text, session names or prompts, so that nothing sensitive is held. **Changed:** it is held in memory only; the requirement stands for what is held.
42. As a Grove user, I want the read of a large history to happen without freezing Grove's window, tabs or status, so that a start never makes the app feel broken. **Changed:** this now happens at every start (about 6 to 14 s of Claude transcripts on the author's machine), not only the first run.
43. As a Grove user, I want the panel to say the history is still being built, with progress per agent and what is ready so far, so that I understand why numbers are growing after a start.
44. As a Grove user, I want later updates to read only what is new, so that the panel stays quick. **Changed:** each reader keeps its byte offsets (OpenCode its row positions) in memory while the core runs; a file that was replaced (new inode, shorter, earlier time or changed first bytes) is read again from the start, and the place of a deleted file is dropped.
45. As a Grove user, I want today's numbers to stay current while the panel is open, so that I see a heavy day as it happens.
46. As a Grove user, I want a day to be my local day, so that a late-night session lands on the day I remember.
47. ~~As a Grove user, I want old days not to be rewritten by a changed time zone beyond the normal shift of a day boundary, so that the record stays trustworthy.~~ **Superseded (ADR 0004):** with no saved record every day is derived from the request's timestamp in the local zone at each start, so there is nothing to rewrite.
48. As a Grove user, I want the panel to make clear that the numbers are for this machine only, so that I do not read them as an account-wide total.
49. As a Grove user, I want Copilot to be labelled as the Copilot CLI, so that I do not expect usage from other editors.
50. As a Grove user, I want an agent whose files are missing, unreadable or in an unknown format to show no value rather than an error, so that one broken source never breaks the panel.
51. As a Grove user, I want the context ring, meter and warn/handoff levels to behave exactly as before, so that this feature changes nothing about handoffs.
52. As a Grove user, I want no plan limits, quotas or dollar estimates anywhere in the panel, so that it shows only what the agents' own records support.
53. As a Grove user, I want the panel to follow the app's theme, spacing and tokens, so that it looks like part of Grove.
54. As a Grove user, I want the panel to work in the expanded dock, using the extra width for a longer matrix, so that I can see a full year when there is room.
55. ~~As a Grove user, I want the panel to work after a core restart without losing anything, so that a restart is invisible.~~ **Superseded (ADR 0004):** a restart reads the agents' files again, with the panel saying it is still building, and the numbers come back as the files hold them.
56. As a developer, I want a usage reader per agent behind one shared contract, so that adding OpenCode's own models later is one more reader and no change to the panel.
57. As a developer, I want the OpenCode-on-Copilot reader tested against a fixture database, so that it is trusted before the first real request exists.
58. As a Grove user, I want pointing at a day (a matrix cell or a bar) to step the rest of the panel back and keep that day's cells, its bar and its weekday's hours in view, and pointing at an hour to link its weekday's days, so that I see how one day sits in the whole. *(Added, 92313f5.)*
59. As a Grove user, I want one tooltip for a day that names the date, each agent's requests, its top model and Copilot credits, and for a total how it compares with the period before it ("Yesterday 9, 3 more"), so that I get the answer without clicking. *(Added, 92313f5.)*
60. As a Grove user, I want to move between the matrix's days with the arrow keys, with one Tab stop per matrix, so that the panel works without a mouse. *(Added, 92313f5.)*
61. As a Grove user, I want a calm first drawing (cells fade in, bars grow, totals count up, a thin progress bar on the building note) that reduced-motion settings turn off, so that the panel does not flash as numbers arrive. *(Added, 92313f5.)*
62. As a Grove user, I want a day before one agent's first request to read "no record that far back" for that agent alone, so that an agent that began later is not shown as zero before it. *(Added; see 38.)*

## Implementation Decisions

- **Unit.** A **request** is one model call, helper agents included. Tokens are carried as fresh input, output, cache read and cache write, and are detail, never the headline. Copilot also carries its per-request credit figure.
- **Scope.** Everything the agent's records on this machine hold, whether or not Grove ran it. Claude includes Claude Desktop, tagged as its own source. Copilot is the Copilot CLI only; no other editor's data is read.
- **Usage history** is built in memory at every start (ADR 0004, which supersedes ADR 0003's saved record): one keyed entry per request holding time, agent, source, model, folder, token counts, credits where present, and whether Grove ran the session. Nothing is written: no history file, no saved reader positions, no wipe, no "history from". An index of the history per agent and local day (kept in step one request at a time) answers the summary without rescanning. It is separate from any future conversation search. What an earlier build saved (`usage-history.json`, `.tmp` and `.corrupt-*` copies) is deleted when the core starts, each file on its own and never a directory or a link.
- **Reader per agent**, started and fed incrementally by position in each growing file (positions held in memory, dropped when a file is deleted; a file replaced is read again from the start, by inode, size, time and first bytes), with a shared contract (read one slice, return request entries, say how far the first read has got). Dedupe is global across files:
  - Claude: key is message id plus request id (message id alone when the request id is missing); the largest output count seen for a key wins; subagent files are included; synthetic and API-error records are dropped; a request copied into a resumed session is attributed to its first occurrence with its original timestamp. Claude Desktop records are recognised by the session's entrypoint and tagged as the Desktop source. Folder is the record's working folder, not the encoded project folder name.
  - Copilot: one entry per per-request usage record, keyed by its unique accounting id; cumulative checkpoint and shutdown records are never added; subagent records are included. Grove-run is decided by joining the session id against Grove's own per-tab agent records.
  - OpenCode (narrow): read only assistant requests whose provider is the Copilot provider, from OpenCode's local database without needing its service, tagged "via OpenCode", credits absent. Rows lacking tokens or a completion time are skipped. Both table generations are handled and de-duplicated by id. All other OpenCode requests are ignored.
- **Grove-run tagging.** Going forward, a request is tagged at record time from Grove's own session records. The split is shown only from 2026-11-05 (when Grove began recording Claude sessions); earlier Claude Code requests are "can't tell". Claude Desktop is never Grove-run and always known.
- **Time.** The entry stores the request's timestamp; the day, week and hour are derived in the user's local time at display. Weeks start on Monday.
- **Where it went.** Folders map to repositories (worktrees roll up into their main checkout, including worktrees under Grove's own worktree folder), repositories that are current Spaces are marked, and everything else (scratch folders, home, Desktop scratch workspaces, tiny groups) goes under "Other". Matching a folder to a Space follows the rules Spaces already use, extended to cover subfolders and former worktrees.
- **Responsiveness.** The first scan and later catch-ups run so that the core's single event loop is never blocked for long (work in small slices or in a separate process; the choice is left to implementation, the observable rule is: tabs, status and RPC stay responsive while a multi-gigabyte first scan runs). Slices are small and the event loop is given back between them. The summary carries a "still building" flag, progress per agent and the date range ready so far. Updates are incremental while the core runs.
- **Core API.** One new request returns the usage summary for the panel: per agent that qualifies (a request in the last 30 days), its daily request counts and detail for the selected range, totals for today / 7 / 30 days, hour-by-weekday counts, breakdowns by repository and by model, the source split, helper share, credit totals with the without-credits count, each agent's own first day (`from`), the range ready so far, and the building flag. One notification tells the window the numbers changed (coalesced; not per request). Failing sources contribute nothing and are logged in the existing style.
- **Hover and focus (92313f5).** `usage-hover.ts` holds the pure parts (a day's tooltip, a total's comparison with the period before, the building progress); the panel links days, bars and hours by class changes without rebuilding the DOM, shows one tooltip, handles the arrow keys, and plays the first-drawing motion unless reduced motion is on.
- **Removed (62d03dd).** The per-agent "Where it ran, 30 days" section. A day's detail still says where that day's requests ran.
- **Panel.** A built-in **Module** in the dock: rail button, key action with a default binding (added to the key list, labels and the defaults), and a panel that asks the core and re-asks on the host events it already follows. A pure view model turns the summary into what is drawn: quartile shades of the user's own days per agent, lightness-differentiated and contrast-checked against the non-text contrast guidance, day-detail strings, the "plus N requests without credits" and "no record that far back" labels, per agent, the empty message, and the expanded-dock matrix length. Colours and sizes use existing design tokens. The agreed mockups are in `.scratch/usage-stats/` (artifact linked from `brief.md`).
- **Glossary.** Already updated with Request, Usage panel, Usage history and Not tracked by Grove. Existing "usage" names in code (the context readings) stay; the new feature uses the new terms to avoid confusion.
- **No change** to the context reading, ring, meter or levels.

## Testing Decisions

- A good test checks behaviour a user can observe (what the panel would show, or what survives), never how the code is organised.
- **Seam 1: the core's usage history, from agent files to the summary.** Tests build fake agent folders for Claude, Claude Desktop, Copilot and an OpenCode database in a temporary directory, with a temporary Grove home, an injected clock and injected agent paths, then ask for the summary and assert on it. Cases: repeated lines and files count once; a later larger count replaces a partial one; a resumed session's copied history is not double counted; helper agents included and shown as a share; Claude Desktop shown as its own slice; the Grove / not-tracked split starts at 2026-11-05; Copilot's Grove-run join; credits sums, including "plus N requests without credits" when OpenCode rows are present; OpenCode-on-Copilot counted under Copilot and its other requests ignored; a new core reads the agents' files again and gets the same numbers; a file the agent deleted stops counting and its reader place is dropped; a replaced file (new inode, shorter, earlier time) is read again while an append reads only the tail; an agent with no request in 30 days is absent and returns when used; each agent's `from` is its own first day; the files an earlier build left are removed one by one and a directory with an old name is left alone; a corrupt or missing file yields no value without breaking others, and is reported once; nothing is written and no conversation text is held; the first scan of a large fixture reports "still building" while the core still answers other requests promptly.
- **Seam 2: the panel's view model, from summary to what is drawn.** Pure-function tests with a small summary factory: quartile shading with a lone huge day, zero days, ties; labels ("no record that far back" per agent, "plus N requests without credits", "via OpenCode", "can't tell"); the empty message; agent order; expanded-dock matrix length; contrast of the shade ramp against its background.
- Hover and keyboard: pure tests for the tooltip and the comparison (`usage-hover.test.ts`); panel tests with a fake core for linking, the tooltip and the arrow keys.
- No window-level test. Dock wiring (rail button, key action, labels, defaults) follows the existing modules test style where it adds behaviour, using fakes for the core.
- **Prior art:** the Claude, Copilot and OpenCode usage source tests (temporary directories, injected paths, clock, fake timers, calling the drain directly); the core service tests built from injected adapters and a temporary home; the pure view-model tests for the context ring and the sidebar; the modules and dock tests with fake deps; the shared persisted-preference tests for failure handling.

## Out of Scope

- Plan limits, quotas, rate-limit windows, reset times.
- Estimated dollar costs, and any dollar sign; Claude cost; combining credits with anything.
- OpenCode's own models, and any OpenCode panel or placeholder.
- Copilot usage from other editors; other agents.
- Combining numbers across machines or accounts.
- Any change to the context ring, meter, warn/handoff levels or Handoff.
- A search across past conversations (still needs its own decision, ADR 0002).
- Recovering days an agent deleted before this start (ADR 0004: accepted loss).
- A saved usage record, a wipe control and a "history from" line (ADR 0003, superseded).
- Exporting the record.

## Further Notes

- Real data on the author's machine: Claude has about 56,000 unique requests (53% Claude Desktop, 26% helper agents), about 1.6 GB of transcripts, a full parse of 6 to 14 s; Copilot has about 810 requests over 19 days. Nothing exists to test OpenCode-on-Copilot against, so the fixture database is the only proof until it is used for real.
- Claude's terminal sessions are deleted after 30 days by default; Desktop sessions are kept. This is why the matrix looks Desktop-heavy before October.
- Copilot's credit figures per request add up exactly to its session totals on this machine (36 of 36 sessions), so they are trusted. Its "premium request" count is the legacy unit and is not shown.
- Implemented without the saved record; the slicing below is the original plan and the order the work took is in the branch's history.
- A suggested slicing for implementation: (1) the saved record, Claude reader and summary with a minimal panel; (2) Copilot reader and credits; (3) the "when you work", "where it went" and stacked bars views; (4) Claude Desktop and the Grove split; (5) OpenCode-on-Copilot reader and its fixture; (6) first-scan responsiveness and wipe.
