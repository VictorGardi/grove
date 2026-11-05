# Window design notes

The window follows the Herdr reference (`docs/work/2026-11-04-grove-v2-spaces-tabs/reference/herdr-look.html`): one dark theme, a sidebar with spaces and the agents grouped under them, a tab strip, and panes with their own header. Every colour and length is a token in `src/tokens.css`; `literals.test.ts` fails on any other literal in the ui sources.

## Type scale

| Token | Size | Used for |
| --- | --- | --- |
| `--text-xs` | 11px | agent and shell mark letters, brand letter |
| `--text-sm` | 12px | tile letters, resume button, the new-tab labels |
| `--text-meta` | 12.5px | branch, folder, age, empty and status text |
| `--text-md` | 13.5px | section labels, tabs, pane kind |
| `--text-lg` | 14.5px | space and agent names, empty-state heading |
| `--text-brand` | 15px | the wordmark |
| `--text-terminal` | 12.5px | terminal text (read by `terminal.ts`) |

Weights: 400 for labels, 500 for the empty-state heading, 600 for the wordmark and letters in tiles and marks.

Fonts: Geist for the interface (`--font-ui`), Geist Mono for the terminal (`--font-mono`), bundled from `assets/fonts/` (licence `assets/fonts/OFL.txt`) and loaded by `src/fonts.css` before the first terminal opens.

## Spacing steps

| Token | Value | Typical use |
| --- | --- | --- |
| `--space-xs` | 2px | gap between list rows |
| `--space-1` | 4px | tab-strip gap, resume padding |
| `--space-2` | 6px | tab gap, form gap |
| `--space-3` | 8px | list side padding, row inner gaps |
| `--space-4` | 10px | row padding, pane gutter |
| `--space-5` | 12px | side padding of the header, pane head |
| `--space-6` | 16px | section heading padding, terminal side padding |

## Radius steps

| Token | Value | Used for |
| --- | --- | --- |
| `--radius-sm` | 6px | tiles, marks, icon buttons, inputs, tab close |
| `--radius-md` | 9px | space and agent rows, tabs |
| `--radius-lg` | 12px | panes |
| `--radius-pill` | 999px | indicators |

## Sizes

`--header-h` 50px (sidebar header and tab strip), `--pane-head-h` 40px, `--sidebar-width` 240px (overwritten by the saved setting), tiles 22px, marks 20px (18px in tabs and pane heads), icon buttons 24px, icons 15px (12px in tiles and close buttons), icon stroke 1.6px.

## Indicators

One shape per agent state. The class is `indicator ind-<state>` (`indicator.ts`); the label is in `title` and `aria-label`.

| State | Label | Shape | Colour token | Motion |
| --- | --- | --- | --- | --- |
| needs-you | needs you | solid dot with a 3px halo | `--state-needs-you` | none |
| working | working | ring with one coloured arc | `--state-working` | spins, period `--spin-period`; paused while the window is not focused; still under reduced motion |
| finished | finished | solid dot | `--state-finished` | none |
| unknown | unknown | dashed ring | `--state-unknown` | none |
| idle | idle | hollow ring | `--state-idle` | none |

Indicator box: `--ind-size` 8px, ring stroke `--ind-stroke` 1.5px, halo `--halo-size` 3px.

## Surfaces

Dark only. Ground `--color-ground` for the main area and terminals, sidebar `--color-sidebar`, page `--color-page` behind the window, raised `--color-raised` for hovered rows and the active tab, selected `--color-selected` for the current space or agent. Rules are `--color-rule` (quiet dividers) and `--color-line` (control borders).

## Dock (the right sidebar)

The dock is the one place for panels that sit beside the work: the notes now, the diff and the comments later. It follows Herdr's Changes panel: a card with the same border and radius as a terminal pane, in the work area beside the stage, one gutter away. A panel never draws its own frame. It implements `DockPanel` (`dock.ts`): an `id`, a `title` and `mount(body, context)`, which draws into the dock's body and returns `{ focus, destroy, canClose? }`. Through `context` a panel sets the status text at the right of the header (`status`), the count pill after the title (`meta`), an error banner under the header (`error`), and can ask to close. `canClose` may say no (unsaved work) after the panel has said why through `error`.

To add a panel: write the `DockPanel`, add a `KeyAction` for it (`protocol/messages.ts`, `core/config/schema.ts`), add a pill button for it in the tab strip next to Notes (class `new-tab dock-toggle`, `aria-pressed` follows `changed`), register it in `main.ts` with `dock.register(...)`, and call `dock.toggle(id)` from the key action and the button. Opening a second panel swaps it in without closing the dock.

Rules every panel gets for free, and should not redo:

- Layout: the card is `--dock-width` wide (default 360px, 280 to 640, saved in the window's storage, `dock-state.ts`), margin `--space-3` like the terminals' padding. Resize by dragging the gutter on its left, with the arrow keys on it, or double-click to reset. Terminals refit beside it.
- Header: `--pane-head-h` tall like a pane head: title (500), count pill, status (flexes, right-aligned), close button. Surface `--color-ground`, border `--color-pane-line`.
- Not modal: no backdrop, the window's key bindings keep working while a panel has focus, and Esc in the panel closes it (a key the panel handled itself does not). Closing hands the keyboard back to the active terminal; a swap does not.
- Body: a flex column the panel fills and scrolls itself. A panel that needs a footer (a commit box, say) puts it at the bottom of its own column, separated by a `--color-rule` line.

### Changes panel

`diff-panel.ts` is the dock's second panel (key `diff`, default Cmd+Shift+D; the "Changes" pill in the tab strip). It is read only: it names the active tab to the core (`diff.get`, `diff.bases`, `diff.prefs.*`) and the core resolves the folder. It looks again on open, tab switch, mode or base change, when the active tab's agent goes from working to idle, needs-you or finished, on reconnect, and on the refresh button; nothing watches files. Mode, base and recent bases are kept by the core per folder. Logic without DOM (tree rows, base choices, empty messages) is in `diff-model.ts`. Colours are tokens (`--diff-add-bg`, `--diff-del-bg`); rows truncate.

## Not in v1

No light theme. The theme file (`theme.json`) overrides only the twenty names at the top of `tokens.css`; the other tokens are fixed.
