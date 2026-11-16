# Grove keeps its own record of usage, one entry per request

**Superseded by [ADR 0004](0004-usage-from-the-agents-files.md).** Nothing below is built any more: Grove keeps no record, and rebuilds the usage history from the agents' files at every start. The text is kept as it was, for the reasoning and the consequences it weighed.

The usage panel reads Grove's own saved record in `~/.grove`, not the agents' session files each time. Terminal Claude deletes sessions after 30 days by default and Copilot sessions can be pruned, so recomputing would make the matrix shrink; a record kept from the first read lets the panel show a long history. The record holds one entry per request (time, agent, model, folder, token counts, Copilot credits, whether Grove ran the session), never conversation text, and is per machine.

One entry per request, not day sums, because agents rewrite their own records: Claude writes one response as several lines whose token counts grow, and resumed sessions copy old history. With a keyed entry per request, a later, larger count replaces an earlier one and a copy is not counted twice. Day sums could not be corrected.

Considered and rejected: recomputing from the agents' files every time. It always matches what exists, but loses days as agents delete them, and a full Claude scan takes 6 to 14 s anyway.

Consequences: days an agent deleted before the first read are gone, so the panel shows "history from <date>". The record names folders and projects, so it is readable by its owner only and can be wiped; wiping resets the start date. Timestamps are stored and the day is derived in local time. A search across past conversations still needs its own decision (ADR 0002).

Addendum: requests OpenCode made on Copilot's models are kept in the same history (agent Copilot, source `opencode`, no credit figure, no Grove flag), read from OpenCode's own database read-only with only the figures selected, never its conversation columns.

Addendum (first read and wipe): the first read runs in small slices with the event loop given back between them, and the history file is rewritten in slices too, to a temp file renamed over the last good one, so a kill leaves the last good file and a restart carries on from the saved place without counting anything twice. The summary says the history is still being built and how far each agent has got. The panel's wipe deletes only Grove's record: "history from" becomes the wipe day, a floor keeps older requests out, and the agents' existing files are skipped, not read again.

Addendum (late Grove records): a request is tagged "not tracked by Grove" from the records Grove had when it was read, and a session that starts after a pass began has no record in yet. The readers therefore keep, in memory, the requests tagged other than "in Grove" that were made after the last refresh of Grove's records, and record them again as Grove's when a later refresh proves the session; the history lets "in Grove" win over an earlier "not". A request made before a refresh is settled by it. The wipe also removes the copies of an unreadable history that were set aside, since they name folders too.
