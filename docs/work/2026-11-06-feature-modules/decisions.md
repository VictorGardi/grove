# Feature modules for grove-next: decisions from a grill-me session

Status: draft, not approved. Not a grove-phase artifact; input for a review session.
Assumption to challenge: this targets `next/` (the Tauri rebuild), not the old Electron app in `src/`.

## Goal

Let features (right-sidebar notes, diff, artifact view with comments, later others) be added as self-contained
modules, so adding one does not touch many files, and each can be switched on or off in settings.

## Today (facts)

- `next/packages/ui/dock.ts` already has a `DockPanel` interface (`id`, `title`, `mount`) and notes and diff use it.
- Adding a panel still touches: `index.html` (toggle button), `main.ts` (register, toggle wiring, `aria-pressed`, tooltip,
  and named calls like `diffPanel.retarget()`, `agentChanged()`, `connection()`), `core/config/schema.ts` (key action +
  description), `protocol/messages.ts` (RPC names and types), and a core handler.
- `main.ts` is about 1,400 lines.

## Decisions

1. **Scope: built-in modules only.** No runtime loading from disk, no third-party code, no sandbox. Workflow plugins
   (grill-me, superpowers, grove skills) are out of scope.
2. **Shape: vertical slice per module.** One folder holds the UI panel, core handlers, protocol types and a manifest.
   Adding a feature means adding a folder plus one line in the registry.
3. **RPC typing: composed type map.** Each module exports its own method types; one `modules.ts` composes
   `CoreMethods & NotesMethods & ReviewMethods`. Calls stay compile-time typed.
4. **On/off: live toggle.** Setting is `modules: { notes: true, review: false }`. UI unmounts panel, button and key
   binding. Core unregisters handlers and stops background work. Modules need `start`/`stop`. Calls to a disabled
   module return a `module-disabled` error.
5. **Contribution points in v1 (minimal):** dock panel; toggle button and key action; core handlers with lifecycle;
   settings entries; a typed host event bus (`activeTabChanged`, `agentStateChanged`, `connectionChanged`).
   Deferred: palette entries, tab/sidebar decorations, status line items, context menu items, cross-module commands.
6. **Review is one module.** Diff, artifact view and comments live together; comments are internal. No inter-module
   dependencies, so no dependency mechanism.
7. **Config: schema fragments in the manifest.** Manifests declare key actions (id, default binding, description) and
   settings (key, type, default, description). The config schema, keys panel, validation and generated `AGENTS.md` are
   assembled from core plus enabled modules. A disabled module's bindings are dropped; its saved settings are kept.
8. **First pass: notes and diff only.** Host (not modules): terminals and holder, spaces and tabs, status service and
   attention, config store, the dock itself, agent adapters, the agent-hooks (integrations) panel, the keys panel.

## Assessment (from the session, to be challenged)

Worth it if:
- more than two or three modules are expected (artifact view, plus anything after), and
- the on/off switch is a real wish.

Honest costs and risks:
- **n=2 abstraction.** Notes is trivial. Diff is the only demanding module. An API shaped by two modules may be
  wrong for the third. Mitigation: keep the API small (decision 5) and build the artifact view as the real third user.
- **Cheaper alternative that gets 70%:** only decouple `main.ts` (host event bus + a UI-side registry that builds the
  rail and wiring from a list) and skip core-side registry, live unregistration and schema fragments. Do that first and
  add the core half when a module actually needs it. Not chosen in the session; worth weighing.
- **Live toggle is the expensive decision.** It forces teardown paths everywhere. Restart-to-apply would remove most
  of the core-side complexity.
- **The refactor of `main.ts` is the real work**, not the manifest type.

## Possibly missed (not discussed)

- Who owns the enabled set: `settings.json` is watched by core, but the UI and core can disagree briefly, and the core
  daemon outlives the window. Needs one source of truth and a defined behaviour on skew.
- Error isolation: a module that throws in `mount`, `start` or a handler must not take the window or core down.
- The `grove-next` CLI: can a module contribute CLI commands? Today none do, but `notes`/`review` may want them.
- Key collisions between modules' default bindings, and rail ordering.
- Where the module toggles live in the settings UI.
- Migration of existing state: per-tab diff prefs, dock width and last open panel when a module is off.
- Contract tests: a shared test that any module manifest must pass (starts, stops, unregisters, leaves no listeners).
- Timing: `next/` is still a rebuild in flux; is this the moment to refactor `main.ts`?
- Whether this needs an ADR in `docs/adr/` and a CONTEXT.md term (**Module**), given "module" is already used loosely.

## Review request

Review these decisions critically. Specifically: is the live toggle worth its cost; is the cheaper alternative better
for now; what is missing from the list above; are there decisions that are one-way doors and should be made explicitly?
Read the code in `next/packages/ui/` (`dock.ts`, `main.ts`, `notes-panel.ts`, `diff-panel.ts`), `next/packages/protocol/messages.ts`
and `next/packages/core/config/schema.ts` to verify the facts. Do not change code.
