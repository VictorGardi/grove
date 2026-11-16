# Grove keeps its own record of usage, one entry per request

The usage panel reads Grove's own saved record in `~/.grove`, not the agents' session files each time. Terminal Claude deletes sessions after 30 days by default and Copilot sessions can be pruned, so recomputing would make the matrix shrink; a record kept from the first read lets the panel show a long history. The record holds one entry per request (time, agent, model, folder, token counts, Copilot credits, whether Grove ran the session), never conversation text, and is per machine.

One entry per request, not day sums, because agents rewrite their own records: Claude writes one response as several lines whose token counts grow, and resumed sessions copy old history. With a keyed entry per request, a later, larger count replaces an earlier one and a copy is not counted twice. Day sums could not be corrected.

Considered and rejected: recomputing from the agents' files every time. It always matches what exists, but loses days as agents delete them, and a full Claude scan takes 6 to 14 s anyway.

Consequences: days an agent deleted before the first read are gone, so the panel shows "history from <date>". The record names folders and projects, so it is readable by its owner only and can be wiped; wiping resets the start date. Timestamps are stored and the day is derived in local time. A search across past conversations still needs its own decision (ADR 0002).
