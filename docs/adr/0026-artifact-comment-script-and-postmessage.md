# 0026. Markdown artifacts load a bundled comment script that talks over checked postMessage

Date: 2026-10-07

## Status

Accepted

## Context

Commenting on markdown needs text selection, a popover and highlights inside
the artifact. The artifact is in an opaque sandboxed iframe with a header CSP
that allows scripts only from `grove-artifact://assets` (ADR 0007). ADR 0007
allows one app-injected script that talks to the app only over `postMessage`.
HTML artifacts can run their own scripts in the same kind of frame.

## Decision

`renderMarkdown` adds `data-line` source ranges to each block and loads
`grove-artifact://assets/comments.js`. The script reports a selection as
`{grove:1, type:'select', exact, prefix, suffix, start, end}` and draws the
highlights it is sent with `CSS.highlights`, never changing the DOM.

The renderer accepts a message only when all of these hold:
- `event.source` is the viewer iframe's `contentWindow`
- the viewer target is a markdown artifact
- the payload validates

The comment editor is app UI outside the iframe. HTML artifacts don't get the
script.

## Consequences

- Inline selection and highlights. The sandbox and CSP are unchanged.
- A message can only propose a draft, never send one. Even a forged message
  can at most create a visible draft.
- Rejected: rendering markdown in the React renderer (gives up the sandbox and
  CSP); side-panel comments without selection (no highlights, clumsy for prose).
