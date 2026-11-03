Herdr and Grove: research notes and options

Date: 2026-11-03
Scope: Herdr’s workspace model, Rust architecture and OSC 7501 status protocol, compared with Grove’s current UI, session runtime and status reporting.

Summary

 - Both products organize real terminal sessions for coding agents and surface agent activity in a desktop UI.
 - Herdr uses spaces for workspaces, task tabs within a space, and an agents list in the sidebar. Grove has projects/worktrees, sessions, workflow features and session groups; these concepts do not map one-to-one.
 - Grove already has a logical core/app boundary, but its TypeScript core runs inside Electron’s main process. tmux keeps agent processes alive when the app closes; the core’s status watchers do not.
 - Herdr uses a separate Rust core and documents OSC 7501 as a generic, agent-reported status protocol. Grove has no OSC 7501 handling and currently derives status through provider-specific sources and terminal observations.
 - There are no benchmarks showing that Grove’s current runtime is a performance bottleneck. A Rust migration’s potential benefit depends on which layers are replaced.

Product model and navigation

Herdr describes a space as work on a machine, usually a repository, and a tab as a task. Tabs can contain split panes with terminals or app panels. The default UI puts spaces and agents in the sidebar and shows the active space’s task tabs across the top. The agent list includes workers discovered across spaces. (Herdr app README, default layout)

Grove’s sidebar can show Zones or Projects. Zones group sessions by attention/work state; Projects group sessions by project. The project page has Features, Sessions and Artifacts board tabs. Sessions can also be grouped parent/child. These are session/project/feature concepts rather than a separate agent directory or task-tab model. ( src/renderer/src/components/Sidebar.tsx:256–312, 571–604 ;  src/renderer/src/components/shell/BoardSwitch.tsx:4–17 ;  src/renderer/src/zoneList.ts:6–26 ;  src/shared/types.ts:5–7, 22–26, 89–103 )

A Grove feature is a workflow record with artifacts and may be linked to multiple sessions; a session is a running process in tmux. A Herdr task tab is closer to an individual task context than to Grove’s feature record. ( CONTEXT.md:17–39, 42–49 )

Execution and core/app boundary

Grove’s renderer is React, and the Electron preload exposes typed IPC to the renderer. The Electron main process creates and owns the TypeScript core, its state, backend and agent event sources. The core is an Electron-free module boundary, but it is not a separate service or process. ( src/preload/index.ts:1–14 ;  src/main/ipc.ts:18–30, 34–61 ;  src/main/index.ts:88–120, 230–245 ;  docs/adr/0004-core-in-electron-main.md:18–28 )

Grove creates a detached tmux session for each app session on its dedicated socket.  node-pty  runs a tmux attach client for each renderer attachment. Closing the app or an attachment does not kill the tmux agent; quitting the app does dispose of the in-process core. ( docs/adr/0003-tmux-dedicated-socket-backend.md:18–37 ;  src/core/backend/tmux.ts:52–63, 107–132 ;  src/main/ipc.ts:99–120 )

Herdr’s desktop app is Rust-based and uses GPUI and Ghostty-related terminal bindings. Its separate Rust  herdr-core  owns PTYs and child processes, continuously reads terminal output and exposes an OpenRPC/JSON-RPC API over a Unix socket or Windows named pipe. Its  hc connect  command can carry the API over SSH. The app can close while the core continues to own the terminals. If the machine reboots or the core stops, however, active processes stop; restored panes are fresh shells, not resumed agent work. (Herdr app  Cargo.toml , core holder, API docs, Herdr core overview)

There are no  Cargo.toml  files in Grove. Its build uses  electron-vite ; its documented stack includes Electron, React, Zustand, xterm.js, node-pty and tmux. ( package.json:7–20, 36–47 ;  README.md:178–180 )

Session status and OSC 7501

Herdr calls OSC 7501 the Program Status Protocol. Programs report their own status through the terminal stream; Herdr does not need to identify a specific agent vendor. The documented states include  idle ,  working ,  done ,  blocked ,  error  and  clear . Reports can include an app name, title, progress, an ID, a message and a kind such as  permission ,  question  or  auth . Herdr’s home page demonstrates emitting a status from a script with one  printf ; programs that do not report status can still run, but do not get reported agent status. (Herdr homepage, core README, status implementation)

Grove does not currently parse OSC 7501. Its agent status sources are provider-specific: OpenCode service events, Claude hook-spool files and Copilot hooks. For plain terminals, Grove observes tmux process activity. Shared status derivation prioritizes permission and question attention, then work in progress, an unseen finished turn, and idle. Grove’s  waiting  state therefore means the human has a move—permission, question or an unseen completion—not simply that an agent sent a generic  done  state. ( docs/adr/0005-status-from-shared-opencode-service.md:18–40 ;  docs/adr/0016-claude-status-from-hook-spool-files.md:18–39 ;  docs/adr/0044-copilot-cli-as-a-third-agent-source.md ;  src/core/status.ts:10–66 ;  src/core/terminalActivity.ts:3–54 ;  CONTEXT.md:50–70 )

Herdr notes that an agent running inside a nested tmux session may not report OSC status through to Herdr’s terminal. Grove also launches agents in tmux, so OSC transport through Grove’s actual tmux attach path is an unresolved compatibility point; the nested-tmux caveat is a reason to test it, not evidence that Grove’s path necessarily fails. (Herdr homepage; Grove:  docs/adr/0003-tmux-dedicated-socket-backend.md:18–37 )

Rust migration: potential gains and limits

Rust can provide a native application and terminal stack, and Herdr demonstrates one such combination with GPUI and Ghostty bindings. This does not establish a performance advantage for Grove: no comparative measurements were found. Porting only Grove’s core would not replace the React renderer or xterm.js, so it would not by itself improve renderer or terminal-emulator performance.

A Rust core or host would require a bridge to the existing renderer and replacement or adaptation of Electron/Node integration points, including typed IPC,  node-pty , filesystem watchers, provider adapters, CLI/socket support, dictation and macOS integration. A full Rust application would additionally replace the renderer and terminal UI. Keeping tmux would preserve Grove’s current agent-process lifetime behavior. ( src/main/ipc.ts:18–30, 99–139 ;  src/core/backend/tmux.ts:52–63, 107–132 ;  package.json:7–20, 36–47 )

Options for Grove

┌───────────────────┬───────────────────────────────────────────────────┬────────────────────────────────────────────────────────┬─────────────────────────────────────────────────────┐
│ Option            │ Potential gain                                    │ Cost or tradeoff                                       │ Assessment                                          │
├───────────────────┼───────────────────────────────────────────────────┼────────────────────────────────────────────────────────┼─────────────────────────────────────────────────────┤
│ Clarify the       │ Make the relationship between Projects/worktrees, │ UI/state work; tabs may duplicate the session sidebar  │ Lowest-risk place to start. Grove already has       │
│ existing          │ sessions and workflow features easier to scan;    │ and session grid.                                      │ Zones/Projects navigation and project-board tabs,   │
│ space/task UX     │ test a task-focused top-tab view without changing │                                                        │ but not a dedicated agent directory plus per-task   │
│                   │ Grove’s domain model.                             │                                                        │ tabs.                                               │
├───────────────────┼───────────────────────────────────────────────────┼────────────────────────────────────────────────────────┼─────────────────────────────────────────────────────┤
│ Add optional OSC  │ A common status path for arbitrary scripts and    │ OSC must reach Grove through tmux and be mapped to     │ A bounded experiment: first verify a script’s       │
│ 7501 status input │ future agents that emit the protocol.             │ Grove’s  waiting /seen semantics. Existing provider    │ status reaches Grove through an actual tmux         │
│                   │                                                   │ adapters remain necessary for non-reporting providers  │ session; then consider it as a supplementary        │
│                   │                                                   │ and richer events.                                     │ source.                                             │
├───────────────────┼───────────────────────────────────────────────────┼────────────────────────────────────────────────────────┼─────────────────────────────────────────────────────┤
│ Extract the       │ Process-level separation; status monitoring and   │ Adds service lifecycle, API versioning, packaging and  │ Relevant if headless control, independent           │
│ TypeScript core   │ API/CLI clients could continue while the desktop  │ recovery concerns. tmux already keeps agent processes  │ monitoring or remote machines are goals. The        │
│ into a resident   │ window restarts, with a more natural path to      │ alive, so the main gain would be management/status     │ existing module boundary makes this less disruptive │
│ service           │ remote machines.                                  │ continuity.                                            │ than starting with a language port.                 │
├───────────────────┼───────────────────────────────────────────────────┼────────────────────────────────────────────────────────┼─────────────────────────────────────────────────────┤
│ Port core/host    │ Native process/terminal integration and Rust’s    │ Requires a new bridge and reimplementation/adaptation  │ Consider only against a measurable reliability,     │
│ pieces to Rust,   │ type/concurrency model.                           │ of several Node/Electron facilities. Does not          │ footprint or portability target.                    │
│ keep the current  │                                                   │ automatically speed up React/xterm.                    │                                                     │
│ renderer          │                                                   │                                                        │                                                     │
├───────────────────┼───────────────────────────────────────────────────┼────────────────────────────────────────────────────────┼─────────────────────────────────────────────────────┤
│ Rewrite as a      │ A cohesive native stack, potentially including a  │ Replaces the renderer, terminal, input, windowing and  │ Appropriate only if profiling identifies a native   │
│ native Rust app   │ different terminal renderer.                      │ integrations; highest migration and regression cost.   │ rendering or resource problem worth solving.        │
│ and terminal      │                                                   │                                                        │                                                     │
└───────────────────┴───────────────────────────────────────────────────┴────────────────────────────────────────────────────────┴─────────────────────────────────────────────────────┘

Suggested evaluation order

 1. Test the information architecture with a small UI experiment; distinguish task/session navigation from Grove’s feature workflow.
 2. Separately test OSC 7501 passthrough from a script inside a Grove tmux session.
 3. Profile startup time, memory and terminal rendering before choosing a Rust port.
 4. If independent status/API lifetime is the goal, evaluate a resident TypeScript core before treating Rust as a requirement.

Sources

Grove

 -  README.md:15–16, 178–180 
 -  CONTEXT.md:17–39, 42–70 
 -  docs/adr/0003-tmux-dedicated-socket-backend.md:18–37 
 -  docs/adr/0004-core-in-electron-main.md:18–28 
 -  docs/adr/0005-status-from-shared-opencode-service.md:18–40 
 -  docs/adr/0016-claude-status-from-hook-spool-files.md:18–39 
 -  docs/adr/0044-copilot-cli-as-a-third-agent-source.md 
 -  src/core/status.ts:10–66 
 -  src/core/terminalActivity.ts:3–54 
 -  src/core/backend/tmux.ts:52–63, 107–132 
 -  src/main/index.ts:88–120, 230–245 
 -  src/main/ipc.ts:18–30, 34–61, 99–139 
 -  src/renderer/src/components/Sidebar.tsx:256–312, 571–604 
 -  src/renderer/src/components/shell/BoardSwitch.tsx:4–17 
 -  src/renderer/src/zoneList.ts:6–26 
 -  src/shared/types.ts:5–7, 22–26, 89–103 
 -  package.json:7–20, 36–47 

Herdr

 - Homepage
 - Core overview
 - App README
 - Default layout
 - App Cargo manifest
 - Core API documentation
 - Core status implementation
 - Core holder
