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
