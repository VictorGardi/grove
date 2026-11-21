# Research: how Grove behaves today (voice input)

Source: read-only sub-agent report, saved by the interviewer. Paths under packages/ ("p/"). Sections 6 and 7 were checked less deeply.

## Agent tab vs plain terminal
- `Tab.kind` is `'shell' | 'claude' | 'opencode' | 'copilot'` (p/ui/window-store.ts:12). The core says `'terminal'`, mapped to `'shell'` by `kindOf`.
- Agent test already used: `tab.kind !== 'shell'` (main.ts:754-757, :838; diff-model.ts:307 `sendState`, which also requires not exited).
- Active tab: `store.activeTab`; in grid mode it is the focused pane.

## Keys
- One `keydown` capture listener, main.ts:1552-1608. No `keyup`, no `event.repeat` check, no hold state anywhere in the UI. It runs before xterm, so a matched key never reaches the terminal.
- Bindings need a modifier plus one of a-z, 0-9, `.`, `=`, `-`, `tab` (`canonicalBinding`, p/core/config/schema.ts:158). Modifier-only or bare keys cannot be bound; `bindingFromEvent` returns null for a lone modifier.
- `Fn` is generally not delivered to WKWebView. A lone Right-Option arrives as `code:'AltRight'` keydown and keyup.
- No keyup arrives if the window loses focus mid-hold. There is a Tauri focus-change hook (main.ts:~1645) and `visibilitychange` (:1615) but no `blur` handler.
- Adding a key action touches 7 places: `KeyAction` union (messages.ts:~280), `KEY_ACTIONS` (schema.ts:23), `DEFAULT_VALUES.keys` (:77), `KEY_DESCRIPTIONS` (:168), `KEY_LABELS` (keys-panel.ts:8), `keyActions` (main.ts:327), tests. A hold key also needs a keyup path and probably a change to binding rules.
- A key bound to two actions is invalid.

## Paste
- `bracketedPaste` (p/protocol/paste.ts) strips controls except newline and tab; never sends Enter. Used by diff-panel.ts:819 and cli/paste.ts:31. Window writes via `tabs.write` (main.ts:278).
- Inserts at the agent TUI's cursor, appending to existing input. Grove adds no space or newline.
- No busy gate: `tabs.write` writes to the PTY; an exited tab is silently ignored (pty-table.ts:181-184).
- `sendState` (diff-model.ts:306-316) already refuses when not connected, no agent, exited, or needs-you (except error); it notes "<agent> is working; the text is waiting in its input" when working. Reusable pattern.

## Chrome
- Tab pill (p/ui/tab-pill.ts) and pane header (main.ts:753-770, rebuilt per `paintTab`) can carry a listening indicator.
- No toast system. The only notice is the global `#status` line (index.html:78): no timer, can be overwritten.

## Settings
- Modal index.html:112+, sections General, Appearance, Agent status, Keys. Row patterns `.settings-row`, `.settings-select`.
- Language pref: window localStorage via `persistedPref` (UI-only, per window, default from `navigator.language`) or core `settings.json` (needs schema field, `ConfigValues`, defaults, setter; agent-editable, shared).

## Tauri / macOS
- tauri.conf.json: identifier `dev.grove.app`, `csp: null`, no `bundle.macOS` block. No Info.plist, entitlements or mic string. Cargo.toml has no audio/speech crates; objc2 + objc2-app-kit present on macOS.
- Bundle is local and unsigned (README:135-141); no release or signing workflow; CI runs only OSV scan, tests, typecheck on ubuntu.
- `getUserMedia` in WKWebView needs `NSMicrophoneUsageDescription` (Tauri `bundle.macOS.infoPlist`) and, if hardened runtime, `com.apple.security.device.audio-input`. Apple's `SFSpeechRecognizer` also needs `NSSpeechRecognitionUsageDescription`. Under `tauri dev` the binary is not a bundle, so permission prompts attach to the terminal; test with the built bundle.

## Tests
- vitest. Pure matchers testable in config.test.ts; keys-panel, schema, paste, diff-model, tab-pill tests exist. The main.ts dispatcher is not testable; hold logic would need a pure module.
