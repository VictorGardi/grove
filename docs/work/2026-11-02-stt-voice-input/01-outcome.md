---
feature: 2026-11-02-stt-voice-input
phase: outcome
status: approved
version: 1
created: 2026-11-02
updated: 2026-11-02
approved_at: 2026-11-02
based_on: []
forced: []
---

# Outcome: speech-to-text input for agent sessions

## Summary

Let the human dictate to any Grove agent session (Claude, Copilot, OpenCode) by voice instead of typing. Hold a shortcut, speak, release; the words appear in the focused session's prompt, unsent, for the human to review and submit with Enter. All speech recognition happens on the machine: no audio or text goes to any outside service, and no account is needed (suitable for use at a bank). English only.

## What the human sees and does

1. Focus a session pane and hold the dictation shortcut. The target is the focused pane at the moment of press and stays locked to it even if focus moves.
2. A small badge on that pane reads "Listening" while the key is held.
3. On release the badge changes to "Transcribing", then disappears once the words have been typed into that session's prompt.
4. The text is inserted exactly like a paste without Enter. It is not submitted. It merges with anything already half-typed in the prompt. The human edits if needed and presses Enter.
5. Works identically in Claude, Copilot and OpenCode panes, and in grid view (only the locked pane shows the badge and receives the text).
6. Errors show briefly in the same badge, then clear (defaults, not asked in the interview):
   - Microphone permission denied or no mic: the badge says "Microphone access needed" with a pointer to where to allow it; nothing is typed.
   - Nothing heard, or press too short to be speech: the badge briefly says "Nothing heard"; nothing is typed.
   - Locked pane closed while talking or transcribing: the recording is dropped silently; the text is not redirected to another pane.
   - Locked pane waiting on a permission or question prompt: the text still goes into that prompt unsubmitted, like any paste; the human always presses Enter, so dictation can never approve anything on its own.
   - Plain terminal panes: not part of the promise; they may receive the text the same way but it is not a requirement or tested outcome.
7. Settings (default): one fixed shortcut, available as a menu item like Grove's other shortcuts. No settings screen and no microphone picker; the system default microphone is used.

## Non-goals

- Auto-sending dictated text; voice commands ("send", "new line", "switch pane").
- Hands-free, always-listening or toggle-to-talk modes.
- Languages other than English.
- Any cloud or third-party transcription, account, API key, or network call for audio or text.
- Agents talking back (text-to-speech).
- A settings screen, microphone selection, custom vocabulary, punctuation or formatting commands, a configurable shortcut.
- Dedicated behavior for plain terminals.
- Choosing the recognition engine (deferred to the plan; the constraint is fully local, English, acceptable speed).

## How I'll know it works

- Hold the shortcut in a Claude pane, say a sentence, release: the sentence appears in the prompt unsubmitted; Enter sends it. The same in Copilot and OpenCode panes.
- The badge shows Listening, then Transcribing, then clears, on the correct pane, including in grid view when another pane gets focus mid-talk.
- With the network disconnected, dictation works the same and no outbound traffic occurs for audio or text.
- Half-typed text already in the prompt is kept and the dictated words are added to it.
- Denied mic permission, a very short tap, silence, and closing the pane mid-talk each produce the described brief message or silent drop, with nothing typed and no crash.
- Dictating while a session is waiting on a permission prompt never submits or approves anything.
- A short utterance (a sentence or two) shows words within a few seconds of release (exact target set in the plan).
- Plain English speech is transcribed accurately enough that only light edits are needed.

## Interview log

**Q1. When you want to talk to an agent, how should it work from start to finish?** Options: A hold-to-talk, review, send; B tap start/stop, review, send; C auto-send when you stop; D both.
**A1.** A. Hold-to-talk, review, send. Words appear in the focused session's prompt, not submitted; the human edits and presses Enter.

**Q2. Which session gets the words when you hold the shortcut?** Options: A always the focused pane; B focused pane locked at press time; C focused or pick by name; D fixed voice target.
**A2.** B. Focused pane, locked at press time. Switching panes while talking does not redirect the words.

**Q3. What should you see while holding the key and after releasing it?** Options: A badge on the target pane; B badge plus live words; C app-level indicator only; D sound cues only.
**A3.** A. A small badge on the locked pane: "Listening", then "Transcribing", then gone when the words are typed; errors show briefly in the same badge.

**Q4. Where should the speech-to-text happen?** Options: A private and offline only; B cloud only; C offline default with optional cloud; D macOS built-in recognition.
**A4.** Free text, no option picked: "what's the best tool that i can also use for work (bank) that has high security standards". Recorded as a constraint: the feature must be usable at a bank, so audio and transcribed text must not leave the machine and no third-party service or account is involved. Which engine is a technical decision for the plan; it must be vetted against this constraint. Shown at the play-back for correction.

**Q5. Which languages do you want to speak to your agents in?** Options: A English only; B one fixed language; C English plus Swedish auto-detected; D a few languages switched manually.
**A5.** A. English only. Other languages are out of scope.

## Open questions
