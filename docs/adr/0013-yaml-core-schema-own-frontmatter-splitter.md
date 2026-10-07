# 0013. YAML core schema with an own frontmatter splitter, no gray-matter

Date: 2026-10-05

## Status

Accepted

## Context

Feature discovery reads frontmatter from every artifact and parses the
global `workflow.yaml`, whose errors are shown to the human in a banner. The
epic's two-way default was chokidar + gray-matter. gray-matter 4.0.3 parses
with js-yaml 3 `safeLoad`: unquoted dates such as `2026-10-05` become JS
`Date` objects, and results are cached by input string and mutable unless
options are passed. Grove artifacts use plain `---` blocks only.

## Decision

Use `yaml@2.9.1` with `{ schema: 'core' }` for both `workflow.yaml` and
frontmatter, and split frontmatter with an own ~15-line `readFrontmatter`
(leading `---` after optional BOM, CRLF accepted, closed by `---` or `...`).
No gray-matter. Dates stay strings; an unclosed block, a YAML error or a
non-mapping yields empty data plus an error that becomes a `frontmatter?`
warning.

## Consequences

- One dependency and one YAML semantics; error messages carry line and
  column for the workflow banner; no cache or `Date` workarounds.
- We own the splitter's edge cases. `---yaml` language tags and custom
  delimiters are not supported.
- Rejected: gray-matter with its default js-yaml 3 (date coercion, mutable
  cache, old major); gray-matter with `yaml` as engine (gray-matter reduced
  to splitting, js-yaml installed unused).
