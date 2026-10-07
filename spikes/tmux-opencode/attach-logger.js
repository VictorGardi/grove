// node-pty client: spawns `tmux -L <sock> -f <cfg> -u attach -t <session>`, logs every byte.
// Usage: node attach-logger.js <logprefix> <session> <ms> [--answer] [--cols N --rows N]
//   --answer : reply like xterm.js to OSC 10/11 colour queries, DA1, DA2 and XTVERSION.
// Ends by killing nothing: after <ms> it runs `tmux detach-client` for its own tty, then exits.
// Writes <logprefix>.raw (bytes), <logprefix>.esc (escaped, per chunk with t+ms) and prints a summary.
const pty = require(process.env.SPIKE_DIR + '/node_modules/node-pty');
const fs = require('fs');
const { execFileSync } = require('child_process');
const [logp, session, msStr, ...rest] = process.argv.slice(2);
const answer = rest.includes('--answer');
const num = (k, d) => { const i = rest.indexOf(k); return i >= 0 ? +rest[i + 1] : d; };
const cols = num('--cols', 120), rows = num('--rows', 40);
const sock = process.env.SOCK || 'grove-spike';
const cfg = __dirname + '/spike.conf';
// --colorterm keeps COLORTERM=truecolor in the client env (node-pty default: inherited only).
const env = { ...process.env }; delete env.COLORTERM; delete env.TMUX;
if (rest.includes("--colorterm")) env.COLORTERM = "truecolor";
const t0 = Date.now(); const raw = []; const esc = fs.createWriteStream(logp + '.esc');
const escape = s => s.replace(/[\x00-\x1f\x7f]/g, c => c === '\x1b' ? '\\e' : '\\x' + c.charCodeAt(0).toString(16).padStart(2, '0'));
let p;
try {
  p = pty.spawn('/opt/homebrew/bin/tmux', ['-L', sock, '-f', cfg, '-u', 'attach', '-t', session],
    { name: 'xterm-256color', cols, rows, cwd: process.cwd(), env });
} catch (e) { console.log('SPAWN ERROR:', e.message); process.exit(2); }
p.onData(d => {
  raw.push(Buffer.from(d, 'utf8'));
  esc.write(`[+${Date.now() - t0}ms] ${escape(d)}\n`);
  if (!answer) return;
  if (/\x1b\]10;\?(\x07|\x1b\\)/.test(d)) { p.write('\x1b]10;rgb:d4d4/d4d4/d4d4\x1b\\'); esc.write('  >> answered OSC10\n'); }
  if (/\x1b\]11;\?(\x07|\x1b\\)/.test(d)) { p.write('\x1b]11;rgb:1e1e/1e1e/1e1e\x1b\\'); esc.write('  >> answered OSC11\n'); }
  if (/\x1b\[c|\x1b\[0c/.test(d)) { p.write('\x1b[?62;22c'); esc.write('  >> answered DA1\n'); }
  if (/\x1b\[>c|\x1b\[>0c/.test(d)) { p.write('\x1b[>0;276;0c'); esc.write('  >> answered DA2\n'); }
  if (/\x1b\[>q|\x1b\[>0q/.test(d)) { p.write('\x1bP>|xterm.js(5.5.0)\x1b\\'); esc.write('  >> answered XTVERSION\n'); }
});
let exitInfo = null;
p.onExit(e => { exitInfo = e; });
setTimeout(() => {
  try { execFileSync('/opt/homebrew/bin/tmux', ['-L', sock, 'detach-client', '-s', session], { env }); } catch (e) { }
  setTimeout(() => {
    const buf = Buffer.concat(raw); fs.writeFileSync(logp + '.raw', buf); esc.end();
    const s = buf.toString('utf8');
    const modes = {};
    for (const m of s.matchAll(/\x1b\[\?([\d;]+)([hl])/g)) for (const n of m[1].split(';')) { const k = `?${n}${m[2]}`; modes[k] = (modes[k] || 0) + 1; }
    const osc = {}; for (const m of s.matchAll(/\x1b\](\d+);([^\x07\x1b]*)/g)) { const k = `OSC${m[1]};${m[2].slice(0, 20)}`; osc[k] = (osc[k] || 0) + 1; }
    const sgrRGB = (s.match(/\x1b\[[\d;:]*[34]8[;:]2[;:]/g) || []).length;
    const sgr256 = (s.match(/\x1b\[[\d;:]*[34]8;5;/g) || []).length;
    const other = {}; for (const m of s.matchAll(/\x1b\[(>|=|<)?[\d;]*[cqmu]/g)) if (!/m$/.test(m[0])) other[m[0]] = (other[m[0]] || 0) + 1;
    for (const m of s.matchAll(/\x1b\[[\d;]*\$p|\x1b\[\?[\d;]*\$p|\x1bP[^\x1b]*/g)) other[m[0]] = (other[m[0]] || 0) + 1;
    console.log(JSON.stringify({ bytes: buf.length, exit: exitInfo, modes, osc, sgrRGB, sgr256, other }));
    try { p.kill(); } catch (e) { }
    process.exit(0);
  }, 800);
}, +msStr);
