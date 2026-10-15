// grove's own chrome for an OpenCode session: the tabs it does not want, and the theme its own UI
// is drawn against. This merges **over** the user's global `cli.json`, so their plugins, models and
// providers still apply — only the chrome grove owns is pinned.
//
// One function, two callers, and the second exists because it is easy to forget: `cliEnv` puts it
// on the pane for a host session, and `envFor` passes it into the VM for a sandboxed one, since
// `container run` forwards only what it is explicitly given. A sandboxed session that skipped it
// came up with the user's tabs and the user's theme (measured 2026-10-12) — which is what happened
// the first time, because only the host path had it.
//
// Takes options rather than carrying a fixed body so that the two paths cannot drift apart by
// accident, and a future difference between them is an argument instead of a second copy. The
// defaults are grove's choice; a caller that passes nothing and a caller that passes these
// defaults get the same string.
export interface OpencodeChrome {
  tabsMode?: 'off' | 'on'
  theme?: { name: string; mode: 'light' | 'dark' }
}

export function opencodeCliConfig(o: OpencodeChrome = {}): string {
  return JSON.stringify({
    tabs: { mode: o.tabsMode ?? 'off' },
    theme: { name: o.theme?.name ?? 'tokyonight', mode: o.theme?.mode ?? 'dark' },
  })
}

// The model a session was launched with (`grove new opencode --model`), as OpenCode's inline config:
// `OPENCODE_CONFIG_CONTENT` is merged over the user's own config, so only `model` is pinned. Both
// launch paths use this (`cliEnv` for the host, `envFor` for the VM). When the environment already
// carries an inline config, its other keys are kept and grove wins for `model`; a value that is not
// a JSON object is replaced.
export function opencodeModelEnv(model: string | undefined, existing?: string): Record<string, string> {
  if (!model) return {}
  let base: Record<string, unknown> = {}
  if (existing) {
    try {
      const parsed: unknown = JSON.parse(existing)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) base = parsed as Record<string, unknown>
    } catch {}
  }
  return { OPENCODE_CONFIG_CONTENT: JSON.stringify({ ...base, model }) }
}
