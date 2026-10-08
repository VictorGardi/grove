Source: the epic's 04-structure.md (v5), child entry 4, verbatim. No separate ticket: the human started this child with `grove-start 2026-10-05-04-artifact-viewer` on 2026-10-05.

### 4. `2026-10-05-04-artifact-viewer`

- **Goal:** read any artifact of a feature safely inside the app.
- **Outcome:** from the feature page I open the current stage's `review` HTML,
  or switch to any other artifact in the folder. HTML renders in an opaque
  sandboxed iframe through `grove-artifact://` with header CSP, and Mermaid
  works offline. Markdown without a companion renders in main. Requests outside
  the feature folder are refused.
- **Scope:** E-D8 (without the comment script). Design: Desired state 7
  (viewing), "Artifacts and comments" (protocol and iframe), the artifact list
  bullet.
- **Depends on:** 2.
- **Size:** 2 days, about 4 slices.
