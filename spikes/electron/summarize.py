#!/usr/bin/env python3
"""Print a readable summary of the newest log for a checklist step.
Usage: ./summarize.py <1|2|3|4|5a|5b|6>   (reads /tmp/grove-espike)"""
import glob, json, os, sys
LABELS = {'1': 'h-none', '2': 'h-renderer', '3': 'h-bie', '4': 'h-ignore',
          '5a': 'h-keys', '5b': 'h-oc', '6': 'packaged'}
D = '/tmp/grove-espike'
step = sys.argv[1] if len(sys.argv) > 1 else ''
if step not in LABELS: sys.exit(__doc__)
logs = sorted(glob.glob(f'{D}/{LABELS[step]}-*Z.log'), key=os.path.getmtime)
if not logs: sys.exit(f'no log for step {step} in {D}')
path = logs[-1]; base = path[:-4]
ev = [json.loads(l) for l in open(path)]
print(f'log: {path}\n')

def key_name(i):
    m = [x for x, on in (('Cmd', i.get('meta')), ('Ctrl', i.get('control')), ('Option', i.get('alt')), ('Shift', i.get('shift'))) if on]
    return '+'.join(m + [i['key']])

if step in ('1', '2', '3', '4'):
    print(f"{'key':10} {'menu fired':11} {'page keydown':13} notes")
    rows = []; cur = None
    for e in ev:
        k, d = e['kind'], e['data']
        if k == 'before-input-event' and d['type'] == 'keyDown' and d.get('meta') and d['key'] != 'Meta':
            cur = {'key': key_name(d), 'menu': 'no', 'page': 'no', 'notes': []}; rows.append(cur)
        elif cur is None: continue
        elif k == 'menu-click': cur['menu'] = 'yes' if d.get('triggeredByAccelerator') else 'yes (click)'
        elif k == 'renderer:keydown' and d['key'] != 'Meta': cur['page'] = 'yes'
        elif k == 'bie-preventDefault': cur['notes'].append('before-input-event prevented')
        elif k == 'renderer:renderer-preventDefault': cur['notes'].append('page prevented')
    for r in rows: print(f"{r['key']:10} {r['menu']:11} {r['page']:13} {', '.join(r['notes'])}")
    if not rows: print('(no Cmd+key presses found)')

elif step in ('5a', '5b'):
    print('Keys you pressed -> bytes xterm sent to the PTY (hex):')
    pending = None
    for e in ev:
        k, d = e['kind'], e['data']
        if k == 'before-input-event' and d['type'] == 'keyDown' and d['key'] not in ('Meta', 'Shift', 'Alt', 'Control'):
            pending = key_name(d)
        elif k == 'pty-in' and not d['hex'].startswith(('1b5b3f', '1b5b3e', '1b5d31', '1b5b3c', '1b5b49', '1b5b4f')):
            print(f"  {(pending or '?'):18} -> {d['hex']}   {d['json']}"); pending = None
    inner = base + '-inner-keys.log'
    if step == '5a' and os.path.exists(inner):
        print('\nBytes the program inside tmux received (time, hex):')
        for l in open(inner): print('  ' + l.rstrip())
    if step == '5b':
        print('\nNow write down what OpenCode did for each key (newline vs submit, word jump, ...).')

elif step == '6':
    env = next(e['data'] for e in ev if e['kind'] == 'env')
    which = next(e['data'] for e in ev if e['kind'] == 'which')
    print('main-process env keys:', ', '.join(sorted(env)))
    for k in ('PATH', 'SHELL', 'HOME', 'LANG', 'LC_ALL', 'LC_CTYPE'): print(f'  {k} = {env.get(k)}')
    print('\ncommand -v tmux/opencode:', which['sh_command_v'].replace('\n', ' | '))
    te = base + '-tmux-session-env.txt'
    if os.path.exists(te):
        print('\nenv inside a tmux session started by the app:')
        for l in open(te):
            if l.split('=')[0] in ('PATH', 'LANG', 'COLORTERM', 'TERM') or l.startswith(('---', '/', 'exit')): print('  ' + l.rstrip())
