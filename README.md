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

## Install on a fresh Mac

Grove next is run from source. On a Mac with nothing installed, do these in order:

- Xcode command line tools: `xcode-select --install` (node-pty and the Tauri build need them; `git` comes with them)
- Node.js and npm, the version you want to build node-pty for (for example `brew install node`, or the installer from nodejs.org)
- Rust via rustup: `curl https://sh.rustup.rs -sSf | sh`, then open a new terminal so `cargo` is on your PATH

Check them with `git --version`, `node --version`, `npm --version` and `cargo --version`.

```sh
git clone https://github.com/VictorGardi/grove.git
cd grove/next
npm install
npm run dev
```

Then follow the Install notes above for the npm warning about node-pty. The first `npm run dev` builds the Rust bridge, so it takes a few minutes.

## Run

```sh
npm run dev
```

This runs `tauri dev`. It starts the Vite dev server on port 1420, builds the Rust bridge and opens the Grove window. The window starts the holder (and the core it supervises) detached if it is not running, so closing the window leaves your tabs running. Reopening the window shows the same screens.

`GROVE_NEXT_NODE` is set to the `node` on your PATH by the script; the holder runs under it. `GROVE_NEXT_ROOT` overrides the repo folder the holder is started from (default: found from the Rust crate's location).

The core socket is `~/.grove-next/s` (or `$GROVE_NEXT_HOME/s`). macOS limits socket paths to about 104 bytes, so keep `GROVE_NEXT_HOME` short if you change it.

## Spaces

A space is a folder; its tabs are login shells started in that folder. Add one from the window (the field under the spaces list), or from a terminal:

```sh
./bin/grove-next space add [path]   # from the repo root, or put bin/ on PATH
grove-next ls                       # the spaces, then their tabs
```

`space add` defaults to the folder you run it from, and always adds a new space: two spaces may share a folder, and the CLI uses the first space of a folder (`new --cwd`, `ls` shows a second one as `<path>#2`).

The state is `~/.grove-next/state.json` (or `$GROVE_NEXT_HOME/state.json`), a versioned file (`"version": 1`). A file that is not valid JSON is set aside as `state.json.corrupt-<ms>` and Grove starts empty. A file with another version is refused: it is left untouched, and adding spaces and opening tabs fail until it is moved away.

A reboot brings the spaces and their tabs back, but the shells are fresh: each tab is a new login shell in its space's folder (the home folder if that folder is gone). A core restart alone keeps the running shells.

## Command line

`grove-next` drives the app from a terminal, or from a tab's shell, so one agent can start and read another:

```sh
grove-next ls [--json]                          spaces, then their tabs
grove-next space add [path] | space ls          add a space, or list them
grove-next new <terminal|claude|opencode|copilot> [--cwd DIR | --space REF] [--label L] [--prompt TEXT|-] [--wait] [--timeout S] [--json]
grove-next send <ref> <TEXT|-> [--no-enter] [--wait] [--timeout S]
grove-next wait <ref> [--timeout S]
grove-next focus <ref>                          show the tab in the app and raise its window
grove-next kill <ref>                           end the tab and remove it
grove-next read <ref> [--lines N]               the last N lines of the screen (default 100)
grove-next config path                          print the config folder
grove-next skill                                install the grove-next-config skill (see Config folder)
```

- `<ref>` is a tab's full id, an id prefix of at least four characters, or its label (exact). A ref that matches two tabs is an error.
- `new` starts the tab in `--cwd` (default: the folder you run it from), which must be a space; a folder with two spaces means the first. `--space REF` picks one exactly: a space id, a unique id prefix (4+ characters), or the heading `ls` shows (`/path`, `/path#2`). It cannot be combined with `--cwd`. It prints the tab's id, or the object with `--json`. `--label` is a name you can use as a ref.
- `--prompt` pastes the text once the agent has drawn its screen, and submits it. `-` reads standard input. `send` does the same for its text, and `--no-enter` pastes without submitting. A send to an agent tab that has exited resumes it with its saved session.
- After a submitted paste, `new` and `send` wait up to 30 s for an agent to start working. That wait is not an error if the agent does not start.
- `wait` blocks until the agent stops working. A permission prompt or a question keeps it waiting, since the human answers those. A shell tab has no agent state, so `wait` on one is an error.
- `--timeout` is in seconds (default 600) for `wait`, and for `--wait` on `new` and `send`.

Exit codes: 0 ok (for `wait`, the agent went idle), 1 error (one line on stderr), 2 usage, 3 the core cannot be reached, 5 the tab is gone, 124 timeout.

Not in v1: worktrees and branches, parent and child tabs, workflow status and progress, and a model per tab.

## Agent status

A Claude, Copilot or OpenCode tab shows working, idle, finished or needs-you from one source: the status report the agent sends to its terminal (OSC 7501). Grove installs nothing for it. A tab whose agent sends no report shows `unknown`, and its tooltip names the version it needs.

Minimum versions: Claude 2.1.309, Copilot 1.0.107, OpenCode 2.2.6. Older versions stay `unknown`; there is no fallback. OpenCode shows needs-you for permissions only with `permission` set to `ask` in the project's `opencode.json`.

Status is not saved: after the core restarts it is read back from the holder, and a turn that finished while the core was down shows idle. For Claude only, Grove can add a SessionStart hook to `~/.claude/settings.json`, after asking, so a tab you typed by hand, or one after `/clear`, resumes its session (`grove-next integration install|uninstall claude`). See `docs/adr/0053-agent-status-from-osc-7501.md`.

## Config folder

The settings live in `~/.grove-next/config` (or `$GROVE_NEXT_HOME/config`). Print the path with:

```sh
grove-next config path
```

The folder holds five JSON files, each with `"version": 1`. A missing file means its defaults, and the app writes the defaults when it starts:

- `settings.json`: `sidebarWidth`, in px (180 to 480, default 240).
- `keys.json`: the shortcuts for `grid-toggle` (default `mod+g`, shows or hides the grid), `new-shell` (`mod+t`, a shell tab in the active space), `new-space` (`mod+n`, a space at the home folder, or selects it if it exists, with one new shell tab), `close-tab` (`mod+w`, closes the active tab), `previous-tab` (`ctrl+tab`, goes back to the tab you were in before, per space), `grid-tab` (`mod+shift+g`, puts the active tab into the grid, or takes it out full screen), `sidebar-toggle` (`mod+b`, shows or hides the sidebar), `notes` (`mod+shift+n`, opens or closes the notes) and `space-1` to `space-9` (`mod+1` to `mod+9`, the space at that place in the sidebar). `mod` is Cmd on macOS and Ctrl elsewhere; `ctrl` is the Control key everywhere. A key bound to two actions is invalid; an action left out of the file keeps its default. The Claude, OpenCode and Copilot shortcuts (`new-claude`, `new-opencode`, `new-copilot`) were removed in slice 9; a `keys.json` that still names them is rejected.
- `launchers.json`: a list of buttons, each `{ id, label, command, args, env }`. A launcher opens a shell tab in the active space and types the command.
- `theme.json`: `tokens`, the colours and sizes the window uses, by token name (`accent`, `state-working`, `font-ui` and so on). Removing a token reverts it to its default.
- `layout.json`: `sidebarOrder`, `["spaces", "agents"]` or the reverse.

The app watches the folder and applies a saved change while it runs, with no restart. A file that does not validate keeps its last good values, and the window's status line shows a note with the file name and the problem until the file is fixed. The folder also gets an `AGENTS.md` that lists every file and key.

Every tab the app starts has `GROVE_NEXT_CONFIG` set to the config folder, so an agent in that tab can find the files. To let agents change the settings for you, install the skill:

```sh
grove-next skill
```

It writes `grove-next-config/SKILL.md` into the Claude, OpenCode and Copilot user skill folders, one line per folder (`✓ <path>` or `✗ <path>: <error>`). The skill is generated, so running it again refreshes it. A file in those folders that grove-next did not write is left alone and named in the error; remove it first.

To put `grove-next` on your PATH, click "Install grove-next command" at the bottom of the sidebar. It writes `~/.local/bin/grove-next`, a small script that runs this checkout's `bin/grove-next`, so `~/.local/bin` must be on your PATH. Keep the checkout where it is: the script points at it.

## Build the app bundle

```sh
npm run build:app
```

Notifications (slice 4) only show from a built bundle, so use this to test them. The bundle is local and unsigned; it is not a distributed package.
