import { useEffect, useRef, useCallback } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import "@xterm/xterm/css/xterm.css";
import {
  registerXterm,
  getXterm,
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

  // Initialize xterm UI, reusing existing instance if one exists.
  //
  // PTY lifecycle is managed externally (Board.tsx for task tabs,
  // TerminalPanel.tsx for free tabs). This component only manages the
  // xterm.js Terminal UI object. When switching workspaces, the component
  // unmounts but we keep the xterm alive in xtermRefs so output accumulated
  // while unmounted is preserved and displayed on remount.
  useEffect(() => {
    if (!containerRef.current) return;

    const existingTerm = getXterm(id);

    if (existingTerm) {
      terminalRef.current = existingTerm;
      fitAddonRef.current = null;
      registerXterm(id, existingTerm);

      const termElement = (
        existingTerm as unknown as { _core: { _terminalEl: HTMLElement } }
      )._core._terminalEl;
      if (termElement.parentElement !== containerRef.current) {
        if (termElement.parentElement) {
          termElement.parentElement.removeChild(termElement);
        }
        containerRef.current.appendChild(termElement);
      }
      existingTerm.focus();
    } else {
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

      registerXterm(id, term);
    }

    const term = terminalRef.current!;

    const dataDisposable = term.onData((data: string) => {
      if (useTerminalStore.getState().deadSet[id] === true) {
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

    const fitTimer = setTimeout(() => {
      if (fitAddonRef.current) {
        fitAddonRef.current.fit();
        const { cols, rows } = term;
        window.api.pty.resize(id, cols, rows);
      }
      term.focus();
    }, 50);

    return () => {
      clearTimeout(fitTimer);
      dataDisposable.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
