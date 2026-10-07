(async () => {
  const { PREVENT } = await window.spike.cfg();
  window.addEventListener('keydown', (e) => {
    window.spike.log('keydown', { key: e.key, code: e.code, meta: e.metaKey, ctrl: e.ctrlKey, alt: e.altKey, shift: e.shiftKey, defaultPrevented: e.defaultPrevented });
    if (PREVENT === 'renderer' && e.metaKey) { e.preventDefault(); window.spike.log('renderer-preventDefault', { key: e.key }); }
  }, true);
  const term = new Terminal({ cols: 120, rows: 40, allowProposedApi: true });
  window.spike.log('xterm', { version: Terminal.version ?? null, macOptionIsMeta: term.options.macOptionIsMeta });
  term.open(document.getElementById('t'));
  term.focus();
  term.onData((d) => window.spike.write(d));
  window.spike.onData((d) => term.write(d));
  window.spike.onReport(() => {
    const b = term.buffer.active; let rgbFg = 0, rgbBg = 0, pal = 0, cells = 0;
    for (let y = 0; y < b.length; y++) { const line = b.getLine(y); if (!line) continue;
      for (let x = 0; x < line.length; x++) { const c = line.getCell(x); if (!c) continue; cells++;
        if (c.isFgRGB()) rgbFg++; if (c.isBgRGB()) rgbBg++; if (c.isFgPalette() || c.isBgPalette()) pal++; } }
    window.spike.log('xterm-buffer-colors', { cells, rgbFg, rgbBg, palette: pal });
  });
})();
