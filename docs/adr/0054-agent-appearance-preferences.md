# App-wide agent appearance preferences

## Status

Accepted

## Context

Agent state colors currently follow the selected theme unless overridden, and the same state is shown across tabs, pane headers, the agents list, and spaces. The legacy word “waiting” can refer to either a human prompt or an unseen finished turn, while v2 distinguishes `needs-you` from `finished`.

## Decision

- Add app-wide settings for the colors of `needs-you`, `working`, and `finished`. Use the existing eight space colors as named swatches; until a color is explicitly selected, follow the active theme. A selected color overrides that state across themes, and “Theme default” clears that state’s override. Duplicate colors are allowed. `idle` and `unknown` retain their theme colors.
- Add a working-indicator style setting with three thinking dots as the default and the three-bar waveform as the alternative. Apply the choice wherever working is shown. Respect the OS reduced-motion preference by displaying the selected shape statically.
- In these settings, “waiting” means `needs-you` only, and “running” means `working`; these labels do not add states to the v2 status model.

## Consequences

The state palette remains consistent across themes after a user makes an explicit choice, while untouched states continue to inherit theme colors. State shapes, labels, and reduced-motion behavior remain available so color is not the only signal.
