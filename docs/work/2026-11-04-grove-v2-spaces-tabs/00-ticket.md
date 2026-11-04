# Ticket

i feel like i want to redo grove from ground up and doing it right from the start..

1. i want spaces and tabs - like herdr.
2. a space is a dir i move to through terminal or through cli (either base repo or worktree or wherever). tabs in a space auto open in the spaces root dir
3. sidebar should show both spaces and agents, just like herdr
4. i want to keep the grid mode - that is beautiful
5. i really like the look of herdr - not too much details and nonsense but the status of agents is really crisp and reliable.
6. still need support for claude + opencode + copilot.

given these things i want to redo data models in grove to get this right. think simplify simplify simplify. make it right from the ground up even if it is more work now. also - should we keep electron base everywhere or move over to rust or what direction should we take here? herdr is also separating UI from core in a really nice way. i want to do that as well.

moreover - it should be easy (like plugin) to add custom code such as "i want to be able to edit code" it should be built modularly to allow that. herdr is talking about agents can update the app itself by a simple sentence.

(Attached screenshot of Herdr: a Spaces list, an Agents list grouped by state (Idle 2) with time since last change, numbered task tabs with a "+" and a "Changes" button, a Claude Code TUI as the main pane, a Changes panel with a commit box, a status bar with machine / branch / agent count, and "Add machine".)
