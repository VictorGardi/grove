# Grove next

The spaces-and-tabs rebuild. The window is a Tauri app with a web page (xterm.js); the terminals live in a holder and a core that run under Node, so they survive the window closing.

## Prerequisites

- Node (the version `npm install` builds node-pty for; this repo uses the one on your PATH)
- git
- Rust via rustup (`curl https://sh.rustup.rs -sSf | sh`), with `cargo` on PATH
- Xcode command line tools (`xcode-select --install`), needed by node-pty and the Tauri build

## Install

```sh
cd next
npm install
```

npm 11 skips node-pty's install script; if `npm install` warns about it, run `npm approve-scripts node-pty` (or the equivalent for your npm) and reinstall. `~/.npm` can hold root-owned files from an earlier `sudo npm`; fix ownership if the install fails with EACCES.

## Run

```sh
npm run dev
```

This runs `tauri dev`. It starts the Vite dev server on port 1420, builds the Rust bridge and opens the Grove window. The window starts the holder (and the core it supervises) detached if it is not running, so closing the window leaves your tabs running. Reopening the window shows the same screens.

`GROVE_NEXT_NODE` is set to the `node` on your PATH by the script; the holder runs under it. `GROVE_NEXT_ROOT` overrides the `next/` folder the holder is started from (default: found from the Rust crate's location).

The core socket is `~/.grove-next/s` (or `$GROVE_NEXT_HOME/s`). macOS limits socket paths to about 104 bytes, so keep `GROVE_NEXT_HOME` short if you change it.

## Spaces

A space is a folder; its tabs are login shells started in that folder. Add one from the window (the field under the spaces list), or from a terminal:

```sh
./bin/grove-next space add [path]   # from next/, or put next/bin on PATH
grove-next ls                       # the spaces, then their tabs
```

`space add` defaults to the folder you run it from. A space is identified by its real path, so adding it again says `already a space`.

The state is `~/.grove-next/state.json` (or `$GROVE_NEXT_HOME/state.json`), a versioned file (`"version": 1`). A file that is not valid JSON is set aside as `state.json.corrupt-<ms>` and Grove starts empty. A file with another version is refused: it is left untouched, and adding spaces and opening tabs fail until it is moved away.

A reboot brings the spaces and their tabs back, but the shells are fresh: each tab is a new login shell in its space's folder (the home folder if that folder is gone). A core restart alone keeps the running shells.

## Command line

`grove-next` drives the app from a terminal, or from a tab's shell, so one agent can start and read another:

```sh
grove-next ls [--json]                          spaces, then their tabs
grove-next space add [path] | space ls          add a space, or list them
grove-next new <terminal|claude|opencode|copilot> [--cwd DIR] [--label L] [--prompt TEXT|-] [--wait] [--timeout S] [--json]
grove-next send <ref> <TEXT|-> [--no-enter] [--wait] [--timeout S]
grove-next wait <ref> [--timeout S]
grove-next focus <ref>                          show the tab in the app and raise its window
grove-next kill <ref>                           end the tab and remove it
grove-next read <ref> [--lines N]               the last N lines of the screen (default 100)
```

- `<ref>` is a tab's full id, an id prefix of at least four characters, or its label (exact). A ref that matches two tabs is an error.
- `new` starts the tab in `--cwd` (default: the folder you run it from), which must be a space. It prints the tab's id, or the object with `--json`. `--label` is a name you can use as a ref.
- `--prompt` pastes the text once the agent has drawn its screen, and submits it. `-` reads standard input. `send` does the same for its text, and `--no-enter` pastes without submitting. A send to an agent tab that has exited resumes it with its saved session.
- After a submitted paste, `new` and `send` wait up to 30 s for an agent to start working. That wait is not an error if the agent does not start.
- `wait` blocks until the agent stops working. A permission prompt or a question keeps it waiting, since the human answers those. A shell tab has no agent state, so `wait` on one is an error.
- `--timeout` is in seconds (default 600) for `wait`, and for `--wait` on `new` and `send`.

Exit codes: 0 ok (for `wait`, the agent went idle), 1 error (one line on stderr), 2 usage, 3 the core cannot be reached, 5 the tab is gone, 124 timeout.

Not in v1: worktrees and branches, parent and child tabs, workflow status and progress, the agent skill, and a model per tab.

To put `grove-next` on your PATH, click "Install grove-next command" at the bottom of the sidebar. It writes `~/.local/bin/grove-next`, a small script that runs this checkout's `bin/grove-next`, so `~/.local/bin` must be on your PATH. Keep the checkout where it is: the script points at it.

## Stress page

Developer-only. In the dev window, click "Stress page" at the bottom of the sidebar (the link is hidden in production builds). It runs nine terminals fed with synthetic output and, on each run, prints:

- key echo median and 95th percentile (a timed keystroke to a terminal and its first echo)
- average frames per second, and the longest frame
- lost WebGL contexts

It ends each run with PASS or FAIL against the slice 1 bars: no frame over one second, no lost context, average 30 fps or better, echo median 50 ms or less, echo p95 100 ms or less. Set the run length in seconds before pressing "Start run" (default 60).

## Build the app bundle

```sh
npm run build:app
```

Notifications (slice 4) only show from a built bundle, so use this to test them. The bundle is local and unsigned; it is not a distributed package.
