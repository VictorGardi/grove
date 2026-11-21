# Decision log: voice input

Phase 1 done: outcome brief confirmed by the user (keyboard key only, agent tabs only, no live words for now, language picked in Settings, on-device, never presses Enter).

## Settled by the user
- U1. Hold a keyboard key; no mouse mic button.
- U2. Speech turned to text on the Mac only; no audio leaves it; no account.
- U3. Text is added after what is already in the input; Grove never presses Enter; works while the agent is busy.
- U4. Voice works only in agent tabs.
- U5. "Listening" indicator, text appears on release; "didn't catch that" on silence.
- U6. One language picked in Settings, default the Mac's language.
- U7. Out of scope: agents talking back, wake word, voice commands to Grove, live words (door kept open when choosing an engine).

## Open decisions (after the altitude rule)
Dropped as implementation detail: where the language setting is stored, how the key code is structured, which file layout, how the indicator is drawn, clip length limits, how Info.plist is set up.

- D1. Speech engine: Whisper vs the macOS built-in recognizer. User-visible (accuracy on technical words, Intel and older macOS support, languages), costly to change later.
- D2. How the speech model reaches the Mac: bundled in the app vs downloaded on first use. Touches "works offline" and "no network".
- D3. Which key is held. Today bindings need a modifier plus a letter/digit; Fn is invisible to the window; a lone Right-Option can be seen.
- D4. When the agent is waiting on the human (needs-you: permission, question, auth), does the voice text still go in? The diff panel refuses in that state.
- D5. Microphone permission denied or not yet granted: what the human sees.
- D6. Key released after the window lost focus, or a very long hold: what happens to the recording.
- D7. Audio and text retention: audio kept in memory only, never written to disk, discarded after transcribing (precedent ADR 0004).

## ADR candidates (three tests)
- D1+D2 together: hard to reverse, surprising, real trade-off. Likely one ADR.
- D7: probably folded into the D1/D2 ADR, not its own.

## Rounds
### Round 1 (respondent: round-1-respondent.md)
- D1 engine: respondent inferred (medium): Whisper, final text only, behind an audio-in/text-out seam; "small" class (~190 MB quantized), base (~60 MB) fallback. Alternative: macOS 26 built-in recognizer (no model to ship, live words for free, but macOS 26+ only, code-word accuracy unknown). Grove is source-run only and this Mac is on macOS 26, so the "older macOS" cost is hypothetical today. -> ESCALATE (user asked about Whisper; real trade-off).
- D2 delivery: respondent inferred (medium): download once on first use, explicit yes, progress, checksum, offline afterwards. Alternative: bundle. Tension with "works offline" from the brief. -> ESCALATE (human call).
- D3 key: respondent inferred (medium): a chord held with Space, default mod+shift+space, rebindable; ignore key repeat; end on release of any part of the chord; lone Right-Option left out of v1 (Option composes characters and is Meta in terminals). -> ESCALATE (default key is a product preference).
- D4 waiting on you: respondent corrected my recommendation: the diff panel refuses on ALL needs-you reasons except `error`, question included. Permission and auth: refuse with a notice (Claude's sign-in prompt is reported to drop pasted text). Question: needs-human. -> ESCALATE.
- D5 mic permission: inferred (medium): macOS asks on first press; if denied a notice names System Settings > Privacy & Security > Microphone. Dev runs from source may attach the prompt to the terminal; test with the built app. Accepted by interviewer (implementation plus consequence already in the brief).
- D6 missed release: inferred (medium): stop and transcribe at focus loss; cap about 30-60 s; hold under 0.3 s does nothing; paste into the tab the hold started on, discard if it is gone. Accepted by interviewer (small, reversible).
- D7 retention: inferred (high): audio in memory only, dropped after transcribing; text not logged or saved; the model file is the only thing voice writes. Accepted; folded into the ADR.
- Language: multilingual model, not English-only, because the user settled "language picked in Settings, default Mac language" (U6). Interviewer decision, no escalation.
- Cost noted: build gains cmake, Xcode CLT and a native audio dependency; mic permission is tied to bundle id and signing.

### Escalated to the user (round 1)
Answered by the user:
- D1 engine: Whisper (final text only for now; engine seam so live words can come later).
- D2 delivery: download once on first use, explicit yes, progress, offline afterwards.
- D3 key: Ctrl+Space (user chose it over the recommended Cmd+Shift+Space). Consequences noted to the user: macOS uses Ctrl+Space to switch input sources when more than one is enabled, and Ctrl+Space is NUL in terminals; Grove's window catches it before the terminal. Rebindable in Settings > Keys.
- D4 waiting on you: always paste (user chose it over the recommended "yes for questions only"). Consequence: text can land in a permission menu, or be dropped by Claude's sign-in prompt. Accepted.

Checker (round 1): three blocking points, all fixed in the brief's "Amended" section:
1. Offline vs download: brief reworded to offline after the one-time download (follows the user's own D2 answer).
2. Always paste vs "after the input / Enter is yours": promise narrowed to the agent's normal input (follows the user's own D4 answer).
3. Plain terminal tab: Ctrl+Space passes through to the terminal, nothing recorded or pasted. Interviewer decision (inferred; small and reversible), shown in the Q&A table for veto.

No open decision remains; round cap not reached (1 of 4). Next: checker, then phase 4.
