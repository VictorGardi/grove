# Window design notes

The window follows the Herdr reference (`docs/work/2026-11-04-grove-v2-spaces-tabs/reference/herdr-look.html`): one dark theme, a sidebar with spaces and the agents grouped under them, a tab strip, and panes with their own header. Every colour and length is a token in `src/tokens.css`; `literals.test.ts` fails on any other literal in the ui sources.

## Type scale

| Token | Size | Used for |
| --- | --- | --- |
| `--text-xs` | 11px | agent and shell mark letters, brand letter |
| `--text-sm` | 12px | tile letters, resume button, the new-tab labels, stress results |
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

`--header-h` 50px (sidebar header and tab strip), `--pane-head-h` 40px, `--sidebar-width` 240px (overwritten by the saved setting), `--traffic-light-inset` 78px (room left for the macOS window controls), tiles 22px, marks 20px (18px in tabs and pane heads), icon buttons 24px, icons 15px (12px in tiles and close buttons), icon stroke 1.6px.

## Indicators

One shape per agent state. The class is `indicator ind-<state>` (`indicator.ts`); the label is in `title` and `aria-label`.

| State | Label | Shape | Colour token | Motion |
| --- | --- | --- | --- | --- |
| needs-you | needs you | solid dot with a 3px halo | `--state-needs-you` | none |
| working | working | ring with one coloured arc | `--state-working` | spins, period `--spin-period`; paused while the window is not focused; still under reduced motion |
| finished | finished | solid dot | `--state-finished` | none |
| unknown | unknown | dashed ring | `--state-unknown` | none |
| idle | idle | hollow ring | `--state-idle` | none |

Indicator box: `--ind-size` 10px, ring stroke `--ind-stroke` 1.5px, halo `--halo-size` 3px.

## Surfaces

Dark only. Ground `--color-ground` for the main area and terminals, sidebar `--color-sidebar`, page `--color-page` behind the window, raised `--color-raised` for hovered rows and the active tab, selected `--color-selected` for the current space or agent. Rules are `--color-rule` (quiet dividers) and `--color-line` (control borders).

## Not in v1

No light theme. The theme file (`theme.json`) overrides only the twenty names at the top of `tokens.css`; the other tokens are fixed.
