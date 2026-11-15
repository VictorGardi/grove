# A tab is named by its label, else its agent's session name, else its number

A tab's name comes from the first of three: the **label** the human gave it (rename, or `grove new --label`), the **session name** its agent keeps, the tab number. A label always wins and is never overwritten; clearing it brings the session name back. The number is only a stand-in while there is neither.

The session name is read from the agent's own records, by a small source per agent that the adapter starts in `watch` beside the context source and that reports through `onName`:

- Claude: the `custom-title` or `agent-name` record in the session transcript (`~/.claude/projects/<project>/<session id>.jsonl`), else an `ai-title` record, else the first real user prompt as one short line. The session id is the one in the tab's usage file, so a `/clear` follows to the new transcript. The transcript is read from where the last poll stopped.
- OpenCode: the `title` of the session in the shared service's session list, ignoring its placeholder titles ("New session", "Child session").
- Copilot: the `name:` line of the session's `workspace.yaml`.

Names are polled every 3 s, cleaned to one line of at most 80 characters, and delivered only when they change. They travel as `AgentInfo.name` and the `agent.named` notification, next to the context reading.

The session name is not saved. It is derived from the agent's records, so a core restart reads it again, and a saved copy could only go stale or compete with the label. `AgentInfo` also carries the tab's `sessionId`, so a later view of past conversations can tell which of them a live tab is running.

Considered and rejected:

- Writing the session name into the tab's label. It would overwrite a name the human chose, or force a rule for when a label counts as "theirs".
- Taking the name from Claude's statusLine input. It carries no session name, and the transcript gives the same record for tabs started by hand.
- A first prompt as the fallback for every agent. OpenCode and Copilot always have a name of their own; only Claude can lack one.

Consequences: a Claude tab nobody renamed shows its first prompt, which can be a poor name; renaming it is the fix. The transcript format and the OpenCode and Copilot fields belong to those agents, so each source fails soft: a record it cannot read means no name, and the tab shows its number. A search across past conversations would add a reader beside these sources (a `listSessions` on the adapter and an index in `~/.grove`), reusing the session ids and the cleaning above, and would need its own decision.
