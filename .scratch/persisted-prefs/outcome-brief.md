# Persisted preferences: outcome brief

Status: brief-confirmed (2026-11-14)

People using Grove see no change. Theme, zoom, sound, agent appearance, sidebar hidden, view state, dock width and expansion, and pane dimming look and behave as today, and anything already saved survives the update. If the window cannot keep settings (private window, blocked site data), Grove still works silently: it starts on defaults and a change holds until the window closes. A nonsense saved value falls back to that setting's default, and each setting keeps its own validity rules (zoom 50-300%, dock width trimmed to the window, and so on).

Non-goals: changing what view state contains (the window store spec owns that); migrating settings added later, such as the per-folder diff settings; any new setting or visible behaviour.

How we'll know it works:
1. Every existing saved value still loads after the update.
2. All eight settings behave the same when saving is unavailable.
3. All eight settings behave the same on a bad saved value (unreadable text falls back to the default; out-of-range numbers keep each setting's own rule: zoom resets, pane-dim is clamped, dock width is floored).
4. A new setting needs only its name, default and validity rule.
5. The "can't save" behaviour is tested in one place, and the per-setting tests keep only their own rules.

## Decision log
- Q1-Q5 (outcome): user answered yes to all, 2026-11-14.
