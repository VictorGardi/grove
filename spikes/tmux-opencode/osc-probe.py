#!/usr/bin/env python3
# Runs inside a tmux pane. At each delay (seconds since start) sends OSC 10;? and OSC 11;?
# and records whatever tmux writes back within 1s. Usage: osc-probe.py <outfile> <t1> [t2 ...]
import os, sys, time, tty, termios, select
out = open(sys.argv[1], 'a'); fd = sys.stdin.fileno(); old = termios.tcgetattr(fd); tty.setraw(fd)
t0 = time.time()
try:
    for t in map(float, sys.argv[2:]):
        time.sleep(max(0, t0 + t - time.time()))
        for q in (b'\x1b]10;?\x1b\\', b'\x1b]11;?\x1b\\'):
            os.write(1, q); buf = b''; end = time.time() + 1
            while time.time() < end:
                r, _, _ = select.select([fd], [], [], end - time.time())
                if not r: break
                buf += os.read(fd, 256)
                if buf.endswith(b'\x1b\\') or buf.endswith(b'\x07'): break
            out.write('t=%.1f query=%r reply=%r\n' % (t, q[2:4], buf)); out.flush()
finally:
    termios.tcsetattr(fd, termios.TCSADRAIN, old)
time.sleep(600)
