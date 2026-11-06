# 0051. Dock features are built-in window modules; the registry is UI-only for now

Date: 2026-11-06

## Status

Accepted

## Context

In grove-next, adding a dock feature (notes, diff, later an artifact view with comments) touched `index.html` (a toggle button), `main.ts` (registration, toggle and key wiring, `aria-pressed`, tooltips, and named calls such as `diffPanel.retarget()`), the key-action lists in `core/config/schema.ts` and `protocol/messages.ts`, the RPC types, and a core handler. A grill-me session (`docs/work/2026-11-06-feature-modules/decisions.md`) proposed a fuller module system: core-side handler registration with `start`/`stop`, schema fragments from manifests, and a live on/off setting.

A review against the code found that notes and diff have no core lifecycle (their handlers are stateless; core dispatch is a plain `if (method === …)` chain with no registry), that the artifact view does not exist yet, and that the pain is on the window side. Diff's saved preferences also live in core `spaces` state, not in the feature.

## Decision

- **Modules are built-in.** No loading from disk, no third-party code, no sandbox. Workflow plugins are out of scope.
- **The registry is UI-only.** A `DockModule` is a panel, a rail button, a key action, and an optional `follow(bus)` that subscribes to host events. `mountModules` builds the buttons, registers the panels, and wires toggles, pressed state and tooltips. Adding a module is a file plus one entry in the list in `main.ts`.
- **The host talks to modules through a typed bus**, not named calls. Delivery is synchronous in subscription order, and a listener that throws is reported and skipped.
- **The host stays out of the registry:** terminals and holder, spaces and tabs, status and attention, the config store, the dock, agent adapters, the agents panel and the keys panel.
- **Deferred, not rejected:** a core-side registry with lifecycle, manifest schema fragments (key actions and settings), a `modules` setting, and the live on/off toggle. Revisit when a module with background work or its own persisted state is actually designed (the artifact view is the expected first).

## Consequences

- A new module still adds its key action to `KEY_ACTIONS` and `KeyAction` by hand, and its RPC names and types to `protocol/messages.ts`.
- There is no enabled-set yet, so there is no source-of-truth or skew question. It must be decided (UI-gated, reload to apply is the simplest rule) before the `modules` setting is added.
- The bus's event set is a small contract shaped by two modules. Extend it when the third module needs more, and do not add palette, status-line or context-menu contribution points before then.
