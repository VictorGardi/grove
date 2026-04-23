import { useEffect, useRef, useCallback, useState, useMemo } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import "@xterm/xterm/css/xterm.css";
import Fuse from "fuse.js";
import type { TaskInfo, PlanAgent, FileTreeNode } from "@shared/types";
import {
  buildFirstPlanMessage,
  buildFirstExecutionMessage,
  type PromptConfig,
} from "../../utils/planPrompts";
import { useThemeStore } from "../../stores/useThemeStore";
import { usePlanStore } from "../../stores/usePlanStore";
import { useFileStore } from "../../stores/useFileStore";
import { useTmuxLivenessStore } from "../../stores/useTmuxLivenessStore";
import styles from "./TaskTerminal.module.css";

interface TaskTerminalProps {
  task: TaskInfo;
  visible: boolean;
  workspacePath: string;
  /** Effective cwd — worktree path if applicable, else workspacePath */
  cwd: string;
  agent: string;
  model: string | null;
  /** "plan" for backlog/review tasks, "exec" for doing tasks */
  sessionMode: "plan" | "exec";
  /** Existing tmux session name from frontmatter (null if no session yet) */
  initialSessionName: string | null;
  /** Workspace-level persona / instruction overrides */
  promptConfig?: PromptConfig;
}

type SessionState = "none" | "starting" | "active" | "reconnecting" | "ended";

/**
 * Task-bound interactive terminal. Runs the chosen agent (opencode TUI or
 * copilot REPL) in a tmux session for persistence across app restarts.
 * Renders via xterm.js — same stack as the interactive terminals panel.
 *
 * Plan mode (backlog/review): shows a textarea prompt input; user types their
 * request and clicks Send to start the session. Context is auto-submitted.
 *
 * Exec mode (doing): auto-starts on mount (no user input needed); context is
 * auto-submitted since the user confirmed intent by moving the task to doing.
 */
export function TaskTerminal({
  task,
  visible,
  workspacePath,
  cwd,
  agent,
  model,
  sessionMode,
  initialSessionName,
  promptConfig,
}: TaskTerminalProps): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const resizeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sessionNameRef = useRef<string | null>(initialSessionName);
  const sessionStateRef = useRef<SessionState>("none");
  // Guard: ensure context is only injected once per session (prevents double-fire
  // from React strict-mode double-invocation or rapid re-renders)
  const contextSentRef = useRef(false);

  const [sessionState, setSessionState] = useState<SessionState>("none");

  useEffect(() => {
    sessionStateRef.current = sessionState;
  }, [sessionState]);

  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [userInput, setUserInput] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const inputSideEffectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );

  const [showDropdown, setShowDropdown] = useState(false);
  const [dropdownPosition, setDropdownPosition] = useState({ top: 0, left: 0 });
  const [selectedIndex, setSelectedIndex] = useState(0);

  const tree = useFileStore((s) => s.tree);
  const treeLoading = useFileStore((s) => s.treeLoading);
  const fetchTree = useFileStore((s) => s.fetchTree);

  interface SearchableFile {
    name: string;
    path: string;
  }

  function flattenFiles(nodes: FileTreeNode[]): SearchableFile[] {
    const result: SearchableFile[] = [];
    for (const node of nodes) {
      if (node.type === "file") {
        result.push({ name: node.name, path: node.path });
      }
      if (node.type === "directory" && node.children) {
        result.push(...flattenFiles(node.children));
      }
    }
    return result;
  }

  const flatFiles = useMemo(() => flattenFiles(tree), [tree]);

  const fuse = useMemo(
    () =>
      new Fuse(flatFiles, {
        keys: [
          { name: "name", weight: 0.7 },
          { name: "path", weight: 0.3 },
        ],
        threshold: 0.3,
        distance: 100,
        ignoreLocation: true,
      }),
    [flatFiles],
  );

  function findAtPosition(
    text: string,
    cursorPos: number,
  ): { query: string; start: number } | null {
    const beforeCursor = text.slice(0, cursorPos);
    const atMatch = beforeCursor.match(/@([^ ]*)$/);
    if (!atMatch) return null;
    return {
      query: atMatch[1],
      start: beforeCursor.length - atMatch[0].length,
    };
  }

  const atPosition = useMemo(
    () =>
      findAtPosition(
        userInput,
        textareaRef.current?.selectionStart ?? userInput.length,
      ),
    [userInput],
  );
  const atQuery = atPosition?.query ?? "";
  const atStart = atPosition?.start ?? 0;

  const fileResults = useMemo(() => {
    if (!showDropdown) return [];
    if (!atQuery) {
      return flatFiles.slice(0, 50).map((f) => ({ item: f }));
    }
    return fuse.search(atQuery, { limit: 50 });
  }, [showDropdown, atQuery, fuse, flatFiles]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [fileResults.length]);

  useEffect(() => {
    if (!showDropdown || !textareaRef.current) return;
    const rafId = requestAnimationFrame(() => {
      if (!textareaRef.current) return;
      const rect = textareaRef.current.getBoundingClientRect();
      const parentRect =
        textareaRef.current.parentElement?.getBoundingClientRect();
      if (parentRect) {
        const spaceBelow = window.innerHeight - rect.bottom - 10;
        const spaceAbove = rect.top - 10;
        const dropdownHeight = 250;
        if (spaceBelow >= dropdownHeight || spaceBelow >= spaceAbove) {
          setDropdownPosition({
            top: rect.height + 4,
            left: 0,
          });
        } else {
          setDropdownPosition({
            top: -dropdownHeight - 4,
            left: 0,
          });
        }
      }
    });
    return () => cancelAnimationFrame(rafId);
  }, [showDropdown, userInput]);

  function insertFilePath(filePath: string): void {
    const before = userInput.slice(0, atStart);
    const after = userInput.slice(
      textareaRef.current?.selectionStart ?? userInput.length,
    );
    const newText = `${before}@${filePath}${after}`;
    setUserInput(newText);
    setShowDropdown(false);
    setTimeout(() => {
      if (textareaRef.current) {
        const newCursorPos = atStart + filePath.length + 1;
        textareaRef.current.setSelectionRange(newCursorPos, newCursorPos);
        textareaRef.current.focus();
      }
    }, 0);
  }

  function handleDropdownKeyDown(e: React.KeyboardEvent): void {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((prev) => Math.min(prev + 1, fileResults.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((prev) => Math.max(prev - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const selected = fileResults[selectedIndex];
      if (selected) {
        insertFilePath(selected.item.path);
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      setShowDropdown(false);
    }
  }

  function handleInputChange(e: React.ChangeEvent<HTMLTextAreaElement>): void {
    const value = e.target.value;
    setUserInput(value);

    const cursorPos = e.target.selectionStart ?? value.length;
    const pos = findAtPosition(value, cursorPos);
    if (!pos) {
      setShowDropdown(false);
    }

    if (inputSideEffectTimerRef.current !== null) {
      clearTimeout(inputSideEffectTimerRef.current);
    }
    inputSideEffectTimerRef.current = setTimeout(() => {
      inputSideEffectTimerRef.current = null;
      const cursorPosDelayed =
        textareaRef.current?.selectionStart ?? value.length;
      const posDelayed = findAtPosition(value, cursorPosDelayed);
      if (posDelayed) {
        if (tree.length === 0 && !treeLoading) {
          fetchTree();
        }
        setShowDropdown(true);
        setSelectedIndex(0);
      }
    }, 100);
  }

  function handleTextareaKeyDown(
    e: React.KeyboardEvent<HTMLTextAreaElement>,
  ): void {
    if (
      showDropdown &&
      (e.key === "ArrowUp" ||
        e.key === "ArrowDown" ||
        e.key === "Enter" ||
        e.key === "Escape")
    ) {
      handleDropdownKeyDown(e);
      return;
    }

    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleSend();
    }
  }

  function handlePaste(e: React.ClipboardEvent): void {
    const pastedText = e.clipboardData.getData("text");
    const value =
      e.target instanceof HTMLTextAreaElement ? e.target.value : userInput;
    const cursorPos =
      e.target instanceof HTMLTextAreaElement
        ? e.target.selectionStart
        : value.length;

    const beforeCursor = value.slice(0, cursorPos);
    const afterCursor = value.slice(cursorPos);
    const newValue = beforeCursor + pastedText + afterCursor;
    const newCursorPos = cursorPos + pastedText.length;

    const atMatch = newValue.slice(0, newCursorPos).match(/@([^ ]*)$/);
    if (atMatch) {
      e.preventDefault();
      setUserInput(newValue);

      setTimeout(() => {
        if (textareaRef.current) {
          textareaRef.current.setSelectionRange(newCursorPos, newCursorPos);
        }
      }, 0);

      if (tree.length === 0 && !treeLoading) {
        fetchTree();
      }

      if (inputSideEffectTimerRef.current !== null) {
        clearTimeout(inputSideEffectTimerRef.current);
      }
      inputSideEffectTimerRef.current = setTimeout(() => {
        inputSideEffectTimerRef.current = null;
        const pos = findAtPosition(newValue, newCursorPos);
        if (pos) {
          setShowDropdown(true);
          setSelectedIndex(0);
        }
      }, 100);
    }
  }

  useEffect(() => {
    function handleClickOutside(e: MouseEvent): void {
      const target = e.target as Node;
      if (
        !textareaRef.current?.contains(target) &&
        !dropdownRef.current?.contains(target)
      ) {
        setShowDropdown(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Agent/model selection — user can override defaults from the start screen
  const [selectedAgent, setSelectedAgent] = useState<PlanAgent>(
    (agent as PlanAgent) ?? "opencode",
  );
  const [selectedModel, setSelectedModel] = useState<string>(model ?? "");

  // Load model list for the selected agent (reuse the plan store cache)
  const modelsCache = usePlanStore((s) => s.modelsCache);
  const ensureModels = usePlanStore((s) => s.ensureModels);
  const modelCacheKey = `${workspacePath}:${selectedAgent}`;
  const cachedModels: string[] = Array.isArray(modelsCache[modelCacheKey])
    ? (modelsCache[modelCacheKey] as string[])
    : [];

  useEffect(() => {
    void ensureModels(workspacePath, selectedAgent);
  }, [workspacePath, selectedAgent, ensureModels]);

  // PTY id is scoped by session mode so plan and exec PTYs can coexist during
  // transitions (e.g. plan is being killed while exec is starting).
  const ptyId = `taskterm-${sessionMode}-${task.id}`;
  const xtermTheme = useThemeStore((s) => s.colors.xterm);

  // ── xterm helpers ──────────────────────────────────────────────

  const doFit = useCallback(() => {
    if (!fitAddonRef.current || !termRef.current || !visible) return;
    try {
      fitAddonRef.current.fit();
      const { cols, rows } = termRef.current;
      window.api.pty.resize(ptyId, cols, rows);
    } catch {
      // Terminal might not be ready yet
    }
  }, [ptyId, visible]);

  const debouncedFit = useCallback(() => {
    if (resizeTimeoutRef.current) clearTimeout(resizeTimeoutRef.current);
    resizeTimeoutRef.current = setTimeout(doFit, 100);
  }, [doFit]);

  // ── Terminal initialization — always open xterm on mount ──────────

  useEffect(() => {
    if (!containerRef.current || termRef.current) return;

    const term = new Terminal({
      theme: useThemeStore.getState().colors.xterm,
      fontFamily: "'JetBrains Mono', monospace",
      fontSize: 13,
      lineHeight: 1.4,
      scrollback: 10000,
      cursorBlink: true,
      cursorStyle: "bar",
      allowProposedApi: true,
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.loadAddon(new WebLinksAddon());
    term.open(containerRef.current);

    termRef.current = term;
    fitAddonRef.current = fitAddon;

    term.onData((data: string) => {
      window.api.pty.write(ptyId, data);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function getTerminal(): Terminal {
    if (!termRef.current) throw new Error("Terminal not ready");
    return termRef.current;
  }

  // ── Initial context injection ─────────────────────────────────────
  // After a new session starts, wait for the agent to become idle (finished
  // booting), then:
  //   1. Read the task file to get the full content
  //   2. Build the appropriate prompt (plan vs execution) with workspace personas
  //   3. Write it to a temp file
  //   4. Inject a single-line "read this file" instruction + \r (auto-submit,
  //      since the user already confirmed intent: Send click for plan, drag for exec)

  async function sendInitialContext(
    sName: string,
    userText: string,
  ): Promise<void> {
    // Prevent double-injection (React strict mode, rapid re-renders, etc.)
    if (contextSentRef.current) return;
    contextSentRef.current = true;

    // Poll until idle (agent finished booting), max 30 seconds.
    // Poll every 500ms — faster than the 3s idle threshold so we catch the
    // first quiet window quickly.
    const maxAttempts = 60;
    for (let i = 0; i < maxAttempts; i++) {
      await new Promise<void>((r) => setTimeout(r, 500));
      const idleResult = await window.api.pty.isIdle(ptyId);
      if (idleResult.ok && idleResult.data === true) break;
      if (i === maxAttempts - 1) return;
    }

    const taskRelPath = task.filePath.replace(workspacePath + "/", "");
    const fileResult = await window.api.fs.readFile(workspacePath, taskRelPath);
    const taskContent =
      fileResult.ok && "content" in fileResult.data
        ? fileResult.data.content
        : `# ${task.title}\n\n${task.description ?? ""}`;

    let promptContent: string;
    if (sessionMode === "exec") {
      promptContent = buildFirstExecutionMessage(
        task,
        taskContent,
        promptConfig,
      );
    } else {
      promptContent = buildFirstPlanMessage(
        task,
        userText || "Please help me work on this task.",
        taskContent,
        promptConfig,
      );
    }

    const writeResult = await window.api.taskterm.writeContext({
      sessionName: sName,
      content: promptContent,
      workspacePath,
    });
    if (!writeResult.ok || !writeResult.filePath) return;

    // Write the instruction first, then submit after a short delay.
    // Sending text + \r as a single write can race against the TUI's input
    // handler — splitting ensures the text is fully rendered before Enter fires.
    window.api.pty.write(
      ptyId,
      `Please read ${writeResult.filePath} for your task context and instructions.`,
    );
    await new Promise<void>((r) => setTimeout(r, 300));
    window.api.pty.write(ptyId, "\r");
  }

  async function startNewSession(userText = ""): Promise<void> {
    setSessionState("starting");
    setErrorMsg(null);
    contextSentRef.current = false; // allow fresh injection for this session

    const livenessKey = `${workspacePath}:${sessionMode}:${task.id}`;
    useTmuxLivenessStore.getState().setAgentState(livenessKey, "starting");

    startingTimeoutRef.current = setTimeout(() => {
      if (sessionState === "starting") {
        useTmuxLivenessStore.getState().setAgentState(livenessKey, "waiting");
      }
    }, 10_000);

    const term = getTerminal();
    term.clear();
    term.writeln(`\x1b[2m  Starting ${selectedAgent} session…\x1b[0m`);

    doFit();
    const cols = termRef.current?.cols ?? 220;
    const rows = termRef.current?.rows ?? 50;

    const result = await window.api.taskterm.create({
      ptyId,
      taskId: task.id,
      taskFilePath: task.filePath,
      workspacePath,
      agent: selectedAgent,
      model: selectedModel || null,
      cwd,
      sessionMode,
      cols,
      rows,
    });

    if (!result.ok) {
      setSessionState("ended");
      setErrorMsg(result.error ?? "Failed to start session");
      term.writeln(`\r\n\x1b[31m  Error: ${result.error}\x1b[0m`);
      return;
    }

    sessionNameRef.current = result.sessionName ?? null;
    term.clear();
    setTimeout(() => {
      doFit();
      term.focus();
    }, 100);
    setSessionState("active");

    if (result.sessionName) {
      sendInitialContext(result.sessionName, userText);
    }
  }

  async function reconnectSession(sName: string): Promise<void> {
    setSessionState("reconnecting");

    const isAlive = await window.api.taskterm.isAlive(sName);
    if (!isAlive) {
      setSessionState("none");
      return;
    }

    doFit();
    const cols = termRef.current?.cols ?? 220;
    const rows = termRef.current?.rows ?? 50;

    const result = await window.api.taskterm.reconnect({
      ptyId,
      sessionName: sName,
      cwd,
      cols,
      rows,
    });

    if (!result.ok) {
      setSessionState("ended");
      setErrorMsg(result.error ?? "Failed to reconnect");
      getTerminal().writeln(`\r\n\x1b[31m  Session ended\x1b[0m`);
      return;
    }

    setTimeout(() => {
      termRef.current?.focus();
    }, 50);
    setSessionState("active");
  }

  async function readFreshFrontmatter(taskFilePath: string): Promise<{
    terminalExecContextSent: boolean | null;
    terminalExecSession: string | null;
  } | null> {
    try {
      const rawResult = await window.api.tasks.readRaw(
        workspacePath,
        taskFilePath,
      );
      if (!rawResult.ok) return null;

      const content = rawResult.data;
      const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
      if (!match) return null;

      const fm = match[1];
      const contextSentMatch = fm.match(
        /terminalExecContextSent:\s*(["']?)(true|false)\1(?:\s*(?:#.*)?)$/im,
      );
      const sessionMatch = fm.match(
        /terminalExecSession:\s*(["']?)(.+?)\1(?:\s*(?:#.*)?)$/m,
      );

      return {
        terminalExecContextSent:
          contextSentMatch?.[2]?.toLowerCase() === "true"
            ? true
            : contextSentMatch?.[2]?.toLowerCase() === "false"
              ? false
              : null,
        terminalExecSession: sessionMatch?.[2]?.trim() ?? null,
      };
    } catch {
      return null;
    }
  }

  // ── Mount: auto-reconnect, auto-start exec, or show start screen ─

  const startingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const unsubData = window.api.pty.onData((id: string, data: string) => {
      if (id !== ptyId) return;
      termRef.current?.write(data);

      if (sessionStateRef.current === "starting") {
        if (startingTimeoutRef.current) {
          clearTimeout(startingTimeoutRef.current);
          startingTimeoutRef.current = null;
        }
        const livenessKey = `${workspacePath}:${sessionMode}:${task.id}`;
        useTmuxLivenessStore.getState().setAgentState(livenessKey, "active");
      }
    });

    const unsubExit = window.api.pty.onExit((id: string, exitCode: number) => {
      if (id !== ptyId) return;
      setSessionState("ended");
      termRef.current?.writeln(
        `\r\n\x1b[33m  Session ended (exit ${exitCode})\x1b[0m`,
      );
    });

    const existing = initialSessionName;
    if (existing) {
      void (async () => {
        const fresh = await readFreshFrontmatter(task.filePath);

        if (fresh === null) {
          setSessionState("none");
          return;
        }

        const storedSession = fresh.terminalExecSession;
        let sessionToReconnect = existing;
        if (storedSession) {
          const isStoredSessionAlive =
            await window.api.taskterm.isAlive(storedSession);
          if (isStoredSessionAlive) {
            sessionToReconnect = storedSession;
          }
        }

        contextSentRef.current = fresh.terminalExecContextSent === true;
        reconnectSession(sessionToReconnect);
      })();
    } else if (sessionMode === "exec") {
      setTimeout(() => startNewSession(), 300);
    }

    return () => {
      unsubData();
      unsubExit();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Agent state polling ───────────────────────────────────────────

  useEffect(() => {
    if (sessionState !== "active") {
      return;
    }
    const sName = sessionNameRef.current;
    if (!sName) return;

    const poll = async (): Promise<void> => {
      await window.api.pty.isIdle(ptyId);
    };

    poll();
    const interval = setInterval(poll, 2000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionState]);

  // ── Theme sync ───────────────────────────────────────────────────

  useEffect(() => {
    if (termRef.current) {
      termRef.current.options.theme = xtermTheme;
    }
  }, [xtermTheme]);

  // ── Visibility / fit ─────────────────────────────────────────────

  useEffect(() => {
    if (visible) {
      setTimeout(() => {
        doFit();
        termRef.current?.focus();
      }, 20);
    }
  }, [visible, doFit]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const observer = new ResizeObserver(() => {
      if (visible) debouncedFit();
    });
    observer.observe(container);
    return () => {
      observer.disconnect();
      if (resizeTimeoutRef.current) clearTimeout(resizeTimeoutRef.current);
    };
  }, [visible, debouncedFit]);

  // ── Render ───────────────────────────────────────────────────────

  const showStartScreen = sessionState === "none" || sessionState === "ended";

  function handleSend(): void {
    if (!userInput.trim()) return;
    const text = userInput;
    setUserInput("");
    void startNewSession(text);
  }

  return (
    <div className={styles.wrapper}>
      {/* Terminal container — always in DOM so xterm can attach regardless of state */}
      <div
        ref={containerRef}
        className={styles.termContainer}
        style={{ visibility: showStartScreen ? "hidden" : "visible" }}
      />

      {/* Start / restart screen — overlaid on top */}
      {showStartScreen && (
        <div className={styles.startScreen}>
          {sessionMode === "plan" && sessionState === "none" ? (
            // Plan mode: textarea input for user's request
            <div className={styles.inputBox}>
              {/* Agent + model selectors */}
              <div className={styles.agentRow}>
                <select
                  value={selectedAgent}
                  onChange={(e) =>
                    setSelectedAgent(e.target.value as PlanAgent)
                  }
                  title="Agent"
                >
                  <option value="opencode">opencode</option>
                  <option value="copilot">copilot</option>
                  <option value="claude">claude</option>
                </select>
                <select
                  value={selectedModel}
                  onChange={(e) => setSelectedModel(e.target.value)}
                  title="Model"
                >
                  <option value="">default</option>
                  {cachedModels.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </div>
              <textarea
                ref={textareaRef}
                className={styles.inputTextarea}
                placeholder="Describe what you need help with… Type @ to mention files"
                value={userInput}
                onChange={handleInputChange}
                onKeyDown={handleTextareaKeyDown}
                onPaste={handlePaste}
                rows={4}
                autoFocus
              />
              {showDropdown && (
                <div
                  ref={dropdownRef}
                  className={styles.fileDropdown}
                  style={{
                    top: dropdownPosition.top,
                    left: dropdownPosition.left,
                  }}
                >
                  {treeLoading ? (
                    <div className={styles.dropdownLoading}>Loading files…</div>
                  ) : fileResults.length === 0 ? (
                    <div className={styles.dropdownEmpty}>No files found</div>
                  ) : (
                    fileResults.map((result, index) => (
                      <div
                        key={result.item.path}
                        className={`${styles.dropdownItem} ${
                          index === selectedIndex
                            ? styles.dropdownItemSelected
                            : ""
                        }`}
                        onClick={() => insertFilePath(result.item.path)}
                      >
                        <span className={styles.dropdownFileName}>
                          {result.item.name}
                        </span>
                        <span className={styles.dropdownFilePath}>
                          {result.item.path}
                        </span>
                      </div>
                    ))
                  )}
                </div>
              )}
              <div className={styles.inputFooter}>
                <span className={styles.inputHint}>⌘↵ to send</span>
                <button
                  className={styles.sendButton}
                  onClick={handleSend}
                  disabled={!userInput.trim()}
                >
                  Send
                </button>
              </div>
            </div>
          ) : (
            // Exec mode first start, or "ended" restart for either mode.
            // For plan mode "ended": clicking "Start new session" resets to the
            // input screen so the user can type a fresh request (no auto-inject).
            <div className={styles.startContent}>
              {sessionState === "ended" && (
                <p className={styles.startHint}>
                  {errorMsg ?? "Session ended."}
                </p>
              )}
              <button
                className={styles.startButton}
                onClick={() => {
                  if (sessionState === "ended" && sessionMode === "plan") {
                    // Return to input screen — user types a new request
                    setSessionState("none");
                    setErrorMsg(null);
                  } else {
                    void startNewSession();
                  }
                }}
              >
                {sessionState === "ended"
                  ? "Start new session"
                  : sessionMode === "exec"
                    ? "Start execution session"
                    : `Start ${agent} session`}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
