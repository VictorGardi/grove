#!/usr/bin/env python3
# pipe-pane -O target: writes each chunk of pane output with a timestamp (escaped) to argv[1].
import sys, os, time
o = open(sys.argv[1], 'w'); t0 = time.time()
while True:
    b = os.read(0, 65536)
    if not b: break
    s = ''.join('\\e' if c == 27 else ('\\x%02x' % c if c < 32 or c == 127 else chr(c)) for c in b.decode('utf-8', 'replace').encode('latin1', 'replace'))
    o.write('[+%.2fs] %s\n' % (time.time() - t0, s)); o.flush()
