#!/bin/sh
# Run one step of the human checklist. Usage: ./run-step.sh <1|2|3|4|5a|5b|6-pack|6-finder>
# Logs go to /tmp/grove-espike. Afterwards: ./summarize.py <same step>
set -e
cd "$(dirname "$0")"
export SPIKE_LOG_DIR=/tmp/grove-espike
E=./node_modules/.bin/electron
chmod 755 node_modules/node-pty/prebuilds/darwin-arm64/spawn-helper
case "$1" in
  1)  $E . --label=h-none     --session=keys --prevent=none ;;
  2)  $E . --label=h-renderer --session=keys --prevent=renderer ;;
  3)  $E . --label=h-bie      --session=keys --prevent=bie ;;
  4)  $E . --label=h-ignore   --session=keys --prevent=ignore ;;
  5a) $E . --label=h-keys     --session=keys ;;
  5b) $E . --label=h-oc       --session=oc ;;
  6-pack)
      npx electron-builder --mac dir -c.mac.identity=null \
        -c.directories.output=/tmp/grove-espike-dist -c.electronDist=node_modules/electron/dist
      chmod 755 /tmp/grove-espike-dist/mac-arm64/grove.app/Contents/Resources/app.asar.unpacked/node_modules/node-pty/prebuilds/darwin-arm64/spawn-helper
      echo "Packed: /tmp/grove-espike-dist/mac-arm64/grove.app" ;;
  6-finder) open -R /tmp/grove-espike-dist/mac-arm64/grove.app
      echo "Finder now shows grove.app: double-click it, wait for the window, then press Cmd+Q." ;;
  *) echo "usage: $0 <1|2|3|4|5a|5b|6-pack|6-finder>"; exit 2 ;;
esac
