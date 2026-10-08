#!/usr/bin/env python3
# Runs in a pane: optionally enables modes (argv[3:], e.g. 2031 2004 1004), then logs every byte tmux
# writes to the pane's input, with timestamps, for argv[2] seconds. Usage: input-log.py <out> <secs> [modes]
import os, sys, time, tty, termios, select
out = open(sys.argv[1], 'w'); fd = 0; tty.setraw(fd); t0 = time.time()
for m in sys.argv[3:]: os.write(1, ('\x1b[?%sh' % m).encode())
end = t0 + float(sys.argv[2])
while time.time() < end:
    r, _, _ = select.select([fd], [], [], end - time.time())
    if r: out.write('[+%.2fs] %r\n' % (time.time() - t0, os.read(fd, 4096))); out.flush()
time.sleep(600)
