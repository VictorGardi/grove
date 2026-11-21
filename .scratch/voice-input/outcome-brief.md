# Outcome brief: talk to agents

Status: confirmed by user (phase 1 done; keyboard only, agent tabs only, no live words for now but keep the door open when choosing an engine)

While an agent tab is active and Grove is in front, the human holds a dedicated key. A "listening" indicator shows on the tab. On release, what they said is turned into text on their own Mac, and the text is added after whatever is already in that agent's input. Grove never presses Enter: the human reads, edits and presses Enter themselves. This works while the agent is busy. If nothing was understood, a short "didn't catch that" notice shows and nothing is pasted. Voice works only in agent tabs; in a plain terminal tab the key does nothing. No audio leaves the Mac, there is no account or key, and it works offline. The language is picked once in Settings and defaults to the Mac's language. The first use triggers the one-time macOS microphone permission.

## Amended after the checker (round 1 answers)
- Key is Ctrl+Space, rebindable. In a plain terminal tab it is passed through to the terminal untouched: nothing is recorded or pasted.
- Offline holds after a one-time download of the speech model (about 190 MB) on first use, with the human's yes. Trying voice first while offline says the download needs a connection.
- "Always paste": while an agent waits on a permission, question or sign-in, the words go into whatever is on screen there; they may land in a menu or be dropped. The human accepted this. The "after what is already in the input" promise holds when the agent is at its normal input.

## Non-goals
- Agents talking back, a hands-free wake word, voice commands to Grove itself.
- A mouse mic button (user chose keyboard only).
- Showing words while speaking; automatic language switching.
- Using it while Grove is in the background.

## How we'll know it works
- Hold key, speak, release: the words appear in the active agent tab's input, unsent.
- Text already in the input is kept; the new words come after it.
- Enter is always the human's.
- A silent hold pastes nothing and says so.
- Airplane mode: still works.
- A plain terminal tab: nothing is pasted.
