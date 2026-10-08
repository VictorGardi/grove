# Logs hex of every byte chunk the inner program (inside tmux) receives on stdin.
import os, sys, termios, tty, time
out = open(sys.argv[1], 'a', buffering=1)
fd = sys.stdin.fileno()
tty.setraw(fd)
print('keylog ready (raw mode); TERM=%s COLORTERM=%s' % (os.environ.get('TERM'), os.environ.get('COLORTERM')), end='\r\n')
out.write('ready TERM=%s COLORTERM=%s\n' % (os.environ.get('TERM'), os.environ.get('COLORTERM')))
while True:
    b = os.read(fd, 1024)
    if not b: break
    out.write('%.3f %s %r\n' % (time.time(), b.hex(), b))
    print(b.hex(), end='\r\n')
