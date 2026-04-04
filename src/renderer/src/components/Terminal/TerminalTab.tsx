import { useEffect, useRef, useCallback } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import "@xterm/xterm/css/xterm.css";
import {
  registerXterm,
  unregisterXterm,
  useTerminalStore,
} from "../../stores/useTerminalStore";
import { useThemeStore } from "../../stores/useThemeStore";

interface TerminalTabProps {
  id: string;
  cwd: string;
  visible: boolean;
}

export function TerminalTabView({
  id,
  cwd,
  visible,
}: TerminalTabProps): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const resizeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const xtermTheme = useThemeStore((s) => s.colors.xterm);

  const doFit = useCallback(() => {
    if (!fitAddonRef.current || !terminalRef.current || !visible) return;
    try {
      fitAddonRef.current.fit();
      const { cols, rows } = terminalRef.current;
      window.api.pty.resize(id, cols, rows);
    } catch {
      // Terminal might not be ready yet
    }
  }, [id, visible]);

  const debouncedFit = useCallback(() => {
    if (resizeTimeoutRef.current) {
      clearTimeout(resizeTimeoutRef.current);
    }
    resizeTimeoutRef.current = setTimeout(doFit, 100);
  }, [doFit]);

  // Initialize xterm UI only.
  //
  // PTY lifecycle is managed externally (Board.tsx for task tabs,
  // TerminalPanel.tsx for free tabs). This component only creates/destroys
  // the xterm.js Terminal UI object. React StrictMode double-invocation is
  // harmless here: cleanup disposes the first xterm instance, the second
  // mount creates a fresh one and registers it — the PTY keeps running
  // throughout because we never kill it here.
  useEffect(() => {
    if (!containerRef.current) return;

    const term = new Terminal({
      theme: useThemeStore.getState().colors.xterm,
      fontFamily: "'JetBrains Mono', monospace",
      fontSize: 13,
      lineHeight: 1.4,
      scrollback: 5000,
      cursorBlink: true,
      cursorStyle: "bar",
      allowProposedApi: true,
    });

    const fitAddon = new FitAddon();
    const webLinksAddon = new WebLinksAddon();

    term.loadAddon(fitAddon);
    term.loadAddon(webLinksAddon);
    term.open(containerRef.current);

    terminalRef.current = term;
    fitAddonRef.current = fitAddon;

    // Register so the centralized data listener can route PTY output here
    registerXterm(id, term);

    // Forward user keystrokes to PTY
    term.onData((data: string) => {
      if (useTerminalStore.getState().deadSet[id] === true) {
        // PTY exited — restart on any keypress
        useTerminalStore.getState().unmarkDead(id);
        term.clear();
        window.api.pty.create(id, cwd).then((result) => {
          if (!result.ok) {
            term.write(
              `\r\n\x1b[31mFailed to restart: ${result.error}\x1b[0m\r\n`,
            );
          } else {
            term.focus();
          }
        });
        return;
      }
      window.api.pty.write(id, data);
    });

    // Initial fit + focus (small delay so the DOM is fully laid out)
    const fitTimer = setTimeout(() => {
      fitAddon.fit();
      const { cols, rows } = term;
      window.api.pty.resize(id, cols, rows);
      term.focus();
    }, 50);

    return () => {
      clearTimeout(fitTimer);
      // Only clean up the xterm UI — do NOT kill the PTY here.
      // PTY is killed by removeTab() in useTerminalStore when the tab is
      // explicitly closed, or by the Board when the worktree is torn down.
      unregisterXterm(id);
      term.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Empty deps: re-running on prop changes would re-open xterm unnecessarily

  // Fit when visibility changes
  useEffect(() => {
    if (visible) {
      setTimeout(() => {
        doFit();
        terminalRef.current?.focus();
      }, 20);
    }
  }, [visible, doFit]);

  // Update xterm theme when the active Grove theme changes
  useEffect(() => {
    if (terminalRef.current) {
      terminalRef.current.options.theme = xtermTheme;
    }
  }, [xtermTheme]);

  // ResizeObserver for container size changes
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const observer = new ResizeObserver(() => {
      if (visible) {
        debouncedFit();
      }
    });

    observer.observe(container);
    return () => {
      observer.disconnect();
      if (resizeTimeoutRef.current) {
        clearTimeout(resizeTimeoutRef.current);
      }
    };
  }, [visible, debouncedFit]);

  return (
    <div
      ref={containerRef}
      style={{
        width: "100%",
        height: "100%",
        display: visible ? "block" : "none",
      }}
    />
  );
}
