# Electron spike (Electron 44.5.1, @xterm/xterm 6.0.0, node-pty 1.1.0, tmux -L grove-espike)

Throwaway spike for research questions 6, 7, 9, 11, 12. It logs JSON lines to
`$SPIKE_LOG_DIR` (or `--log-dir=`). The default is `/tmp/grove-espike`.
It redirects `userData` into the log dir, so it never writes to `~/Library/Application Support/grove`.

## Setup

```sh
cd spikes/electron
npm install
node node_modules/electron/install.js   # Electron 44 downloads its binary lazily; npm allowScripts may skip it
chmod 755 node_modules/node-pty/prebuilds/darwin-arm64/spawn-helper   # 1.1.0 ships 644 -> posix_spawnp failed
```

## Flags (`electron . --flag=...`, or `open grove.app --args --flag=...`)

- `--session=keys|oc|none` attaches to the inner hex key logger (`keylog.py`) or to `opencode`
- `--prevent=none|renderer|bie|ignore` sets which mechanism blocks Cmd-key events: renderer keydown `preventDefault`, `before-input-event` `preventDefault`, or `setIgnoreMenuShortcuts(true)`
- `--autotest=1` sends synthetic `sendInputEvent` keys, screenshots, then exits. `--keys=0` skips the keys.
- `--pty-colorterm=` (empty) leaves COLORTERM out of the PTY env. The default is `truecolor`.
- `--label=NAME` sets the log file prefix

Log kinds to look at: `menu-click`, `before-input-event`, `renderer:keydown`, `pty-in` (hex that xterm sends to the PTY),
`<label>-*-inner-keys.log` (hex that tmux delivers to the program inside), `pty-out-stats` (SGR 38;2 / 48;2 / 38;5 counts from tmux).

## Human checklist (real keystrokes; synthetic events skip the macOS menu path)

Run everything from a normal terminal (not inside Claude's sandbox), from the repo root.
Each step opens a window. The window shows only the terminal; **all results go to the
log file**. After closing a step's window, run its summary command to read the result.

One-time setup (skip if already done):

```sh
cd spikes/electron
npm install
node node_modules/electron/install.js
cd ../..
```

### Step 1: menu vs page, nothing prevented

```sh
spikes/electron/run-step.sh 1
```

Click inside the window. Press Cmd+T, Cmd+W, Cmd+1, Cmd+5, Cmd+9, then Cmd+Q (this quits). Then run:

```sh
spikes/electron/summarize.py 1
```

The result is a table with columns `key | menu fired | page keydown`.

### Step 2: page calls preventDefault on Cmd keys

```sh
spikes/electron/run-step.sh 2
```

Press the same keys (Cmd+T, W, 1, 5, 9, Q). Cmd+Q may not quit; if not, close the window with the red button. Then:

```sh
spikes/electron/summarize.py 2
```

Check whether "menu fired" is still `yes` on rows noted "page prevented".

### Step 3: before-input-event calls preventDefault

```sh
spikes/electron/run-step.sh 3
```

Press the same keys. Cmd+Q is blocked, so close the window with the red button. Then:

```sh
spikes/electron/summarize.py 3
```

### Step 4: setIgnoreMenuShortcuts(true)

```sh
spikes/electron/run-step.sh 4
```

Press the same keys, then close with the red button. Then:

```sh
spikes/electron/summarize.py 4
```

### Step 5a: raw keys through xterm and tmux

```sh
spikes/electron/run-step.sh 5a
```

The window shows `keylog ready`, then one hex line per key. Press, one at a time:
Shift+Enter, Option+Enter, Option+B, Option+F, Option+Backspace, Option+Left,
Ctrl+A, Ctrl+C, Ctrl+P, Ctrl+X, Ctrl+J, Esc, then Esc quickly followed by Tab.
Close with Cmd+Q. Then:

```sh
spikes/electron/summarize.py 5a
```

It prints each key next to the bytes xterm sent, and the bytes the program inside tmux received.

### Step 5b: the same keys in OpenCode

```sh
spikes/electron/run-step.sh 5b
```

OpenCode opens in the window. Type `hello`, then press Shift+Enter: does it add a newline or submit?
Type `one two three`, then try Option+B / Option+F (does the cursor jump by word?) and
Option+Backspace (does it delete a word?). Press Esc. Write down what happened, close with Cmd+Q, then:

```sh
spikes/electron/summarize.py 5b
```

### Step 6: Finder and Dock launch

```sh
spikes/electron/run-step.sh 6-pack      # builds /tmp/grove-espike-dist/mac-arm64/grove.app (about 1 min)
spikes/electron/run-step.sh 6-finder    # reveals grove.app in Finder
```

Double-click `grove.app` in Finder, wait for the window, then press Cmd+Q. Then:

```sh
spikes/electron/summarize.py 6
```

For the Dock: drag `grove.app` from that Finder window into the Dock, click it there, press Cmd+Q,
and run `spikes/electron/summarize.py 6` again (it reads the newest log). Remove it from the Dock afterwards.

### Clean up

```sh
tmux -L grove-espike kill-server
```

Only the spike uses that socket. Paste each summary output back to Claude to have it recorded in `02-research.md`.
