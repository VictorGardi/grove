import { useState, useEffect, useMemo } from "react";
import type { MessageContentBlock } from "@shared/types";
import { useThemeStore } from "../../stores/useThemeStore";
import { getHighlighter } from "../Files/shikiHighlighter";
import styles from "./PlanChat.module.css";

function toolLabel(tool: string): string {
  switch (tool) {
    case "bash":
      return "$";
    case "read":
      return "r";
    case "write":
      return "w";
    case "edit":
      return "e";
    case "grep":
      return "/";
    case "glob":
      return "*";
    case "task":
      return "t";
    case "webfetch":
    case "websearch":
      return "~";
    case "todowrite":
      return "✓";
    default:
      return "?";
  }
}

function parseAnsi(text: string): React.ReactNode[] {
  const colors = useThemeStore.getState().colors.xterm;

  const ansiColorMap: Record<number, string> = {
    30: colors.black,
    31: colors.red,
    32: colors.green,
    33: colors.yellow,
    34: colors.blue,
    35: colors.magenta,
    36: colors.cyan,
    37: colors.white,
    90: colors.brightBlack,
    91: colors.brightRed,
    92: colors.brightGreen,
    93: colors.brightYellow,
    94: colors.brightBlue,
    95: colors.brightMagenta,
    96: colors.brightCyan,
    97: colors.brightWhite,
  };

  const result: React.ReactNode[] = [];
  let currentStyle: {
    color?: string;
    bold?: boolean;
    italic?: boolean;
    strikethrough?: boolean;
    underline?: boolean;
  } = {};
  let currentText = "";
  let inEscape = false;
  let escapeBuffer = "";

  const flushText = () => {
    if (currentText) {
      const spans: React.ReactNode[] = [];
      if (Object.keys(currentStyle).length > 0) {
        const styleObj: React.CSSProperties = {};
        if (currentStyle.color) styleObj.color = currentStyle.color;
        if (currentStyle.bold) styleObj.fontWeight = "bold";
        if (currentStyle.italic) styleObj.fontStyle = "italic";
        if (currentStyle.strikethrough)
          styleObj.textDecoration = "line-through";
        if (currentStyle.underline) styleObj.textDecoration = "underline";
        spans.push(
          <span style={styleObj} key={result.length}>
            {currentText}
          </span>,
        );
      } else {
        spans.push(currentText);
      }
      result.push(...spans);
      currentText = "";
    }
  };

  for (let i = 0; i < text.length; i++) {
    const char = text[i];

    if (char === "\x1b") {
      flushText();
      inEscape = true;
      escapeBuffer = "";
      continue;
    }

    if (inEscape) {
      escapeBuffer += char;
      if (char === "m") {
        inEscape = false;
        const codes = escapeBuffer
          .slice(1, -1)
          .split(";")
          .map((s) => parseInt(s, 10) || 0);

        for (let j = 0; j < codes.length; j++) {
          const code = codes[j];
          if (code === 0) {
            currentStyle = {};
          } else if (code === 1) {
            currentStyle.bold = true;
          } else if (code === 3) {
            currentStyle.italic = true;
          } else if (code === 4) {
            currentStyle.underline = true;
          } else if (code === 9) {
            currentStyle.strikethrough = true;
          } else if (code >= 30 && code <= 37) {
            currentStyle.color = ansiColorMap[code];
          } else if (code >= 90 && code <= 97) {
            currentStyle.color = ansiColorMap[code];
          } else if (code >= 40 && code <= 47) {
            // background colors - not commonly used in terminal output for display
          } else if (code >= 100 && code <= 107) {
            // bright background colors
          }
        }
        escapeBuffer = "";
      }
      continue;
    }

    currentText += char;
  }

  flushText();
  return result;
}

function parseDiff(
  oldString: string,
  newString: string,
): {
  lines: Array<{ type: "removed" | "added" | "context"; content: string }>;
  addedCount: number;
  removedCount: number;
} {
  const oldLines = oldString.split("\n");
  const newLines = newString.split("\n");
  const result: Array<{
    type: "removed" | "added" | "context";
    content: string;
  }> = [];
  let addedCount = 0;
  let removedCount = 0;

  const oldSet = new Set(oldLines);
  const newSet = new Set(newLines);

  for (const line of oldLines) {
    if (!newSet.has(line)) {
      result.push({ type: "removed", content: line });
      removedCount++;
    }
  }

  for (const line of newLines) {
    if (!oldSet.has(line)) {
      result.push({ type: "added", content: line });
      addedCount++;
    }
  }

  return { lines: result, addedCount, removedCount };
}

function getBasename(path: string): string {
  const parts = path.replace(/\\/g, "/").split("/");
  return parts[parts.length - 1] || path;
}

function getDirname(path: string): string {
  const parts = path.replace(/\\/g, "/").split("/");
  parts.pop();
  const dir = parts.join("/");
  return dir || ".";
}

function getLanguageFromExtension(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase() || "";
  const extMap: Record<string, string> = {
    ts: "typescript",
    tsx: "tsx",
    js: "javascript",
    jsx: "jsx",
    py: "python",
    rb: "ruby",
    rs: "rust",
    go: "go",
    java: "java",
    c: "c",
    cpp: "cpp",
    h: "c",
    hpp: "cpp",
    css: "css",
    scss: "scss",
    less: "less",
    html: "html",
    json: "json",
    yaml: "yaml",
    yml: "yaml",
    md: "markdown",
    sql: "sql",
    sh: "bash",
    bash: "bash",
    zsh: "bash",
    xml: "xml",
    toml: "toml",
    txt: "text",
  };
  return extMap[ext] || "text";
}

interface DiffViewProps {
  oldString: string;
  newString: string;
}

function DiffView({ oldString, newString }: DiffViewProps): React.JSX.Element {
  const { lines } = useMemo(
    () => parseDiff(oldString, newString),
    [oldString, newString],
  );

  const [showAll, setShowAll] = useState(false);
  const maxLines = 200;
  const needsTruncation = lines.length > maxLines;
  const displayLines = showAll ? lines : lines.slice(0, maxLines);

  return (
    <div className={styles.diffContainer}>
      {needsTruncation && !showAll && (
        <button
          className={styles.diffShowMore}
          onClick={() => setShowAll(true)}
        >
          Show {lines.length - maxLines} more lines
        </button>
      )}
      <div className={styles.diffLines}>
        {displayLines.map((line, idx) => (
          <div
            key={idx}
            className={`${styles.diffLine} ${line.type === "removed" ? styles.diffRemoved : line.type === "added" ? styles.diffAdded : ""}`}
          >
            <span className={styles.diffLinePrefix}>
              {line.type === "removed"
                ? "-"
                : line.type === "added"
                  ? "+"
                  : " "}
            </span>
            <span className={styles.diffLineContent}>{line.content}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

interface LineNumbersProps {
  lineCount: number;
}

function LineNumbers({ lineCount }: LineNumbersProps): React.JSX.Element {
  const lines = useMemo(() => {
    return Array.from({ length: lineCount }, (_, i) => i + 1);
  }, [lineCount]);

  return (
    <span className={styles.codeLineNumbers}>
      {lines.map((num) => (
        <span key={num} className={styles.codeLineNumber}>
          {num}
        </span>
      ))}
    </span>
  );
}

interface CodeBlockProps {
  content: string;
  language?: string;
  showLineNumbers?: boolean;
}

function CodeBlock({
  content,
  language = "json",
  showLineNumbers = true,
}: CodeBlockProps): React.JSX.Element {
  const [highlightedHtml, setHighlightedHtml] = useState<string>("");
  const [highlighterReady, setHighlighterReady] = useState(false);
  const shikiTheme = useThemeStore((s) => s.colors.shikiTheme);
  const [highlighter] = useState(() => getHighlighter());

  useEffect(() => {
    highlighter.then(() => setHighlighterReady(true));
  }, [highlighter]);

  useEffect(() => {
    if (!highlighterReady) return;

    const highlight = async () => {
      try {
        const h = await highlighter;
        const html = h.codeToHtml(content, {
          lang: language,
          theme: shikiTheme,
        });
        setHighlightedHtml(html);
      } catch {
        setHighlightedHtml(`<pre>${content}</pre>`);
      }
    };

    highlight();
  }, [content, highlighterReady, shikiTheme, highlighter]);

  const lines = content.split("\n");
  const lineCount = lines.length;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(content);
    } catch {
      // ignore copy errors
    }
  };

  return (
    <div className={styles.codeBlockContainer}>
      <button
        className={styles.copyButton}
        onClick={handleCopy}
        aria-label="Copy to clipboard"
        title="Copy to clipboard"
      >
        <CopyIcon />
      </button>
      <div className={styles.codeBlockWrapper}>
        {showLineNumbers && <LineNumbers lineCount={lineCount} />}
        {highlightedHtml ? (
          <div
            className={styles.codeHighlighted}
            dangerouslySetInnerHTML={{ __html: highlightedHtml }}
          />
        ) : (
          <pre className={styles.codeBlockPre}>{content}</pre>
        )}
      </div>
    </div>
  );
}

function CopyIcon(): React.JSX.Element {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
    </svg>
  );
}

interface AnsiOutputProps {
  content: string;
}

function AnsiOutput({ content }: AnsiOutputProps): React.JSX.Element {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore
    }
  };

  const lines = content.split("\n");
  const lineCount = lines.length;

  return (
    <div className={styles.codeBlockContainer}>
      <button
        className={styles.copyButton}
        onClick={handleCopy}
        aria-label="Copy to clipboard"
        title="Copy to clipboard"
      >
        {copied ? <CheckIcon /> : <CopyIcon />}
      </button>
      <div className={styles.codeBlockWrapper}>
        <LineNumbers lineCount={lineCount} />
        <div className={styles.ansiOutput}>
          {lines.map((line, idx) => (
            <div key={idx} className={styles.ansiLine}>
              {parseAnsi(line)}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function CheckIcon(): React.JSX.Element {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="20 6 9 17 4 12"></polyline>
    </svg>
  );
}

interface TodoListOutputProps {
  content: string;
}

function parseTodoList(
  content: string,
): Array<{ text: string; completed: boolean }> {
  try {
    const parsed = JSON.parse(content);
    if (parsed.todos && Array.isArray(parsed.todos)) {
      return parsed.todos.map(
        (t: { content?: string; text?: string; status?: string }) => ({
          text: t.content || t.text || "",
          completed: t.status === "completed",
        }),
      );
    }
    if (Array.isArray(parsed)) {
      return parsed.map(
        (t: { content?: string; text?: string; status?: string }) => ({
          text: t.content || t.text || "",
          completed: t.status === "completed",
        }),
      );
    }
  } catch {
    // Not JSON, try markdown checkbox format
    const lines = content.split("\n");
    const result: Array<{ text: string; completed: boolean }> = [];
    for (const line of lines) {
      const match = line.match(/^- \[([ x])\] (.+)$/);
      if (match) {
        result.push({
          completed: match[1].toLowerCase() === "x",
          text: match[2].trim(),
        });
      }
    }
    if (result.length > 0) return result;
  }
  return [];
}

function TodoListOutput({ content }: TodoListOutputProps): React.JSX.Element {
  const items = useMemo(() => parseTodoList(content), [content]);

  if (items.length === 0) {
    return <div className={styles.toolUseEmpty}>no todos</div>;
  }

  return (
    <div className={styles.todoListBlock}>
      <div className={styles.todoListItems}>
        {items.map((item, idx) => (
          <div key={idx} className={styles.todoItem}>
            <label className={styles.todoLabel}>
              <span className={styles.todoCheckboxCustom}>
                {item.completed ? (
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className={styles.todoCheckboxIconChecked}
                  >
                    <polyline points="20 6 9 17 4 12"></polyline>
                  </svg>
                ) : (
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className={styles.todoCheckboxIconUnchecked}
                  >
                    <rect
                      x="3"
                      y="3"
                      width="18"
                      height="18"
                      rx="2"
                      ry="2"
                    ></rect>
                  </svg>
                )}
              </span>
              <span
                className={`${styles.todoText} ${item.completed ? styles.todoTextCompleted : ""}`}
              >
                {item.text}
              </span>
            </label>
          </div>
        ))}
      </div>
    </div>
  );
}

interface ToolUseBlockProps {
  block: MessageContentBlock;
}

export function ToolUseBlock({ block }: ToolUseBlockProps): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const { data } = block;

  if (!data) return <></>;

  const hasError = data.exitCode !== null && data.exitCode !== 0;
  const durationMs = data.time ? data.time.end - data.time.start : null;
  const durationLabel =
    durationMs !== null
      ? durationMs >= 1000
        ? `${(durationMs / 1000).toFixed(1)}s`
        : `${durationMs}ms`
      : null;

  const hasOutput = data.output.length > 0;
  const hasAnsi = data.output.includes("\x1b");

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      setOpen((o) => !o);
    }
  };

  const tool = data.tool;
  const input = data.input || {};

  const renderHeader = (): React.ReactNode => {
    if (tool === "edit") {
      const filePath = String(input.filePath || data.title || "");
      const basename = getBasename(filePath);
      const dirname = getDirname(filePath);
      const oldString = String(input.oldString || "");
      const newString = String(input.newString || "");
      const { addedCount, removedCount } = parseDiff(oldString, newString);

      return (
        <>
          <span className={styles.toolUseIcon}>{toolLabel(tool)}</span>
          <span className={styles.toolUseName}>{tool}</span>
          <span className={styles.toolUseTitle}>{basename}</span>
          {dirname !== "." && (
            <span className={styles.toolUseDir}>{dirname}</span>
          )}
          <span className={styles.toolUseMeta}>
            {addedCount > 0 && (
              <span className={styles.lineCountBadgeAdded}>+{addedCount}</span>
            )}
            {removedCount > 0 && (
              <span className={styles.lineCountBadgeRemoved}>
                -{removedCount}
              </span>
            )}
          </span>
        </>
      );
    }

    if (tool === "write") {
      const filePath = String(input.filePath || data.title || "");
      const basename = getBasename(filePath);
      const dirname = getDirname(filePath);

      return (
        <>
          <span className={styles.toolUseIcon}>{toolLabel(tool)}</span>
          <span className={styles.toolUseName}>{tool}</span>
          <span className={styles.toolUseTitle}>{basename}</span>
          {dirname !== "." && (
            <span className={styles.toolUseDir}>{dirname}</span>
          )}
        </>
      );
    }

    if (tool === "read") {
      const filePath = String(input.filePath || data.title || "");
      const basename = getBasename(filePath);
      const dirname = getDirname(filePath);

      return (
        <>
          <span className={styles.toolUseIcon}>{toolLabel(tool)}</span>
          <span className={styles.toolUseName}>{tool}</span>
          <span className={styles.toolUseTitle}>{basename}</span>
          {dirname !== "." && (
            <span className={styles.toolUseDir}>{dirname}</span>
          )}
        </>
      );
    }

    if (tool === "bash") {
      const command = String(input.command || data.title || tool);

      return (
        <>
          <span className={styles.toolUseIcon}>{toolLabel(tool)}</span>
          <span className={styles.toolUseName}>{tool}</span>
          <span className={styles.toolUseTitle}>{command}</span>
        </>
      );
    }

    if (tool === "glob" || tool === "grep") {
      const pattern = String(input.pattern || data.title || tool);

      return (
        <>
          <span className={styles.toolUseIcon}>{toolLabel(tool)}</span>
          <span className={styles.toolUseName}>{tool}</span>
          <span className={styles.toolUseTitle}>{pattern}</span>
        </>
      );
    }

    if (tool === "task") {
      const subagentType = String(input.subagent_type || input.command || "");
      const description = String(input.description || "");

      return (
        <>
          <span className={styles.toolUseIcon}>{toolLabel(tool)}</span>
          <span className={styles.toolUseName}>{tool}</span>
          <span className={styles.subagentPill}>{subagentType}</span>
          {description && (
            <span className={styles.toolUseTitle}>{description}</span>
          )}
        </>
      );
    }

    if (tool === "webfetch" || tool === "websearch") {
      const url = String(input.url || data.title || tool);

      return (
        <>
          <span className={styles.toolUseIcon}>{toolLabel(tool)}</span>
          <span className={styles.toolUseName}>{tool}</span>
          <span className={styles.toolUseTitle}>{url}</span>
        </>
      );
    }

    if (tool === "todowrite") {
      return (
        <>
          <span className={styles.toolUseIcon}>{toolLabel(tool)}</span>
          <span className={styles.toolUseName}>{tool}</span>
          <span className={styles.toolUseTitle}>
            {data.title || "update todo list"}
          </span>
        </>
      );
    }

    return (
      <>
        <span className={styles.toolUseIcon}>{toolLabel(tool)}</span>
        <span className={styles.toolUseName}>{tool}</span>
        <span className={styles.toolUseTitle}>{data.title || tool}</span>
      </>
    );
  };

  const renderInput = (): React.ReactNode => {
    if (tool === "edit") {
      const oldString = String(input.oldString || "");
      const newString = String(input.newString || "");

      return (
        <div className={styles.toolUseSection}>
          <span className={styles.toolUseSectionLabel}>diff</span>
          <DiffView oldString={oldString} newString={newString} />
        </div>
      );
    }

    if (tool === "write") {
      const filePath = String(input.filePath || data.title || "file");
      const content = String(input.content || "");
      const language = getLanguageFromExtension(filePath);

      return (
        <div className={styles.toolUseSection}>
          <span className={styles.toolUseSectionLabel}>content</span>
          <CodeBlock content={content} language={language} />
        </div>
      );
    }

    if (tool === "todowrite") {
      return (
        <div className={styles.toolUseSection}>
          <span className={styles.toolUseSectionLabel}>todos</span>
          <TodoListOutput content={data.output} />
        </div>
      );
    }

    if (tool === "read") {
      return null;
    }

    if (
      tool === "bash" ||
      tool === "glob" ||
      tool === "grep" ||
      tool === "task" ||
      tool === "webfetch" ||
      tool === "websearch"
    ) {
      return null;
    }

    const inputKeys = Object.keys(input);
    if (inputKeys.length > 0) {
      return (
        <div className={styles.toolUseSection}>
          <span className={styles.toolUseSectionLabel}>input</span>
          <CodeBlock content={JSON.stringify(input, null, 2)} language="json" />
        </div>
      );
    }

    return null;
  };

  return (
    <div
      className={`${styles.toolUseBlock} ${hasError ? styles.toolUseError : ""}`}
      role="group"
      aria-label={`Tool: ${data.tool}`}
    >
      <button
        className={styles.toolUseToggle}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={handleKeyDown}
        aria-expanded={open}
      >
        {renderHeader()}
        <span className={styles.toolUseMeta}>
          {hasError && (
            <span className={styles.toolUseExitBadge}>
              exit {data.exitCode}
            </span>
          )}
          {durationLabel && (
            <span className={styles.toolUseDuration}>{durationLabel}</span>
          )}
        </span>
        <span
          className={`${styles.toolUseArrow} ${open ? styles.toolUseArrowOpen : ""}`}
        >
          &#9654;
        </span>
      </button>

      {open && (
        <div className={styles.toolUseDetails}>
          {renderInput()}
          {hasOutput && (
            <div className={styles.toolUseSection}>
              <span className={styles.toolUseSectionLabel}>output</span>
              {hasAnsi ? (
                <AnsiOutput content={data.output} />
              ) : (
                <CodeBlock
                  content={data.output}
                  language="text"
                  showLineNumbers={true}
                />
              )}
              {data.truncated && (
                <span className={styles.toolUseTruncated}>
                  output truncated at 5KB
                </span>
              )}
            </div>
          )}
          {!hasOutput && Object.keys(data.input || {}).length === 0 && (
            <div className={styles.toolUseEmpty}>no input or output</div>
          )}
        </div>
      )}
    </div>
  );
}
