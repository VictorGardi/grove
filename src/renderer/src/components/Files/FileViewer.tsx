import React, { useEffect, useState, useMemo, useRef } from "react";
import type { ThemedToken, BundledLanguage } from "shiki";
import { useFileStore } from "../../stores/useFileStore";
import { getHighlighter, SUPPORTED_LANGS } from "./shikiHighlighter";
import { MarkdownViewer } from "./MarkdownViewer";
import styles from "./FileViewer.module.css";

// ── Breadcrumb ─────────────────────────────────────────────────

function PathBreadcrumb({ filePath }: { filePath: string }): React.JSX.Element {
  const parts = filePath.split("/");
  const fileName = parts.pop() || "";
  const dirs = parts;

  return (
    <div className={styles.breadcrumb}>
      {dirs.map((dir, i) => (
        <React.Fragment key={i}>
          <span className={styles.breadcrumbDir}>{dir}</span>
          <span className={styles.breadcrumbSep}>/</span>
        </React.Fragment>
      ))}
      <span className={styles.breadcrumbFile}>{fileName}</span>
    </div>
  );
}

// ── Format file size ───────────────────────────────────────────

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ── FileViewer Component ───────────────────────────────────────

export function FileViewer(): React.JSX.Element {
  const openFilePath = useFileStore((s) => s.openFilePath);
  const fileContent = useFileStore((s) => s.fileContent);
  const fileBinary = useFileStore((s) => s.fileBinary);
  const fileTooLarge = useFileStore((s) => s.fileTooLarge);
  const fileTooLargeSize = useFileStore((s) => s.fileTooLargeSize);
  const fileLoading = useFileStore((s) => s.fileLoading);

  const [tokenLines, setTokenLines] = useState<ThemedToken[][] | null>(null);
  const [highlighterReady, setHighlighterReady] = useState(false);
  const [flashKey, setFlashKey] = useState(0);
  const [viewMode, setViewMode] = useState<"rendered" | "source">("rendered");
  const prevContentRef = useRef<string | null>(null);
  const codeAreaRef = useRef<HTMLDivElement>(null);

  // Initialize highlighter on mount
  useEffect(() => {
    getHighlighter().then(() => setHighlighterReady(true));
  }, []);

  // Reset to rendered view when opening a new file
  useEffect(() => {
    setViewMode("rendered");
  }, [openFilePath]);

  // Tokenize when file content or language changes
  useEffect(() => {
    if (!fileContent || !highlighterReady) {
      setTokenLines(null);
      return;
    }

    let cancelled = false;
    const lang = SUPPORTED_LANGS.has(fileContent.language)
      ? fileContent.language
      : "text";

    getHighlighter().then((highlighter) => {
      if (cancelled) return;
      try {
        if (lang === "text") {
          setTokenLines(null);
          return;
        }
        const { tokens } = highlighter.codeToTokens(fileContent.content, {
          lang: lang as BundledLanguage,
          theme: "grove-dark",
        });
        if (!cancelled) {
          setTokenLines(tokens);
        }
      } catch {
        if (!cancelled) {
          setTokenLines(null);
        }
      }
    });

    return () => {
      cancelled = true;
    };
  }, [fileContent, highlighterReady]);

  // Flash on reload (content changed while file was open)
  useEffect(() => {
    if (!fileContent) {
      prevContentRef.current = null;
      return;
    }
    if (
      prevContentRef.current !== null &&
      prevContentRef.current !== fileContent.content
    ) {
      setFlashKey((k) => k + 1);
    }
    prevContentRef.current = fileContent.content;
  }, [fileContent]);

  // Memoize rendered lines for performance
  const renderedLines = useMemo(() => {
    if (!fileContent) return null;

    const lines = fileContent.content.split("\n");

    if (tokenLines) {
      return tokenLines.map((tokens, lineIdx) => (
        <div key={lineIdx} className={styles.codeLine}>
          <span className={styles.lineNumber}>{lineIdx + 1}</span>
          <span className={styles.lineContent}>
            {tokens.map((token, tokenIdx) => (
              <span key={tokenIdx} style={{ color: token.color }}>
                {token.content}
              </span>
            ))}
          </span>
        </div>
      ));
    }

    // Plain text fallback
    return lines.map((line, lineIdx) => (
      <div key={lineIdx} className={styles.codeLine}>
        <span className={styles.lineNumber}>{lineIdx + 1}</span>
        <span className={styles.lineContent}>{line}</span>
      </div>
    ));
  }, [fileContent, tokenLines]);

  const isMarkdown = fileContent?.language === "markdown";

  // No file selected
  if (!openFilePath) {
    return (
      <div className={styles.viewerContainer}>
        <div className={styles.centerMessage}>Select a file to view</div>
      </div>
    );
  }

  // Loading
  if (fileLoading) {
    return (
      <div className={styles.viewerContainer}>
        <div className={styles.centerMessage}>Loading...</div>
      </div>
    );
  }

  // Binary file
  if (fileBinary) {
    return (
      <div className={styles.viewerContainer}>
        <Header filePath={openFilePath} language={null} lineCount={null} />
        <div className={styles.centerMessage}>Binary file — cannot display</div>
      </div>
    );
  }

  // Too large
  if (fileTooLarge) {
    return (
      <div className={styles.viewerContainer}>
        <Header filePath={openFilePath} language={null} lineCount={null} />
        <div className={styles.centerMessage}>
          <span>
            File too large to display (
            {fileTooLargeSize ? formatSize(fileTooLargeSize) : "unknown"})
          </span>
          <span className={styles.centerHint}>Open in external editor</span>
        </div>
      </div>
    );
  }

  // File content loaded
  if (fileContent) {
    return (
      <div className={styles.viewerContainer}>
        <Header
          filePath={openFilePath}
          language={fileContent.language}
          lineCount={fileContent.lineCount}
          viewMode={isMarkdown ? viewMode : undefined}
          onSetViewMode={isMarkdown ? setViewMode : undefined}
        />

        {/* Markdown rendered preview */}
        {isMarkdown && viewMode === "rendered" ? (
          <div
            ref={codeAreaRef}
            key={`md-${flashKey}`}
            className={`${styles.codeArea} ${flashKey > 0 ? styles.flash : ""}`}
          >
            <MarkdownViewer content={fileContent.content} />
          </div>
        ) : (
          /* Code / source view */
          <div
            ref={codeAreaRef}
            key={`src-${flashKey}`}
            className={`${styles.codeArea} ${flashKey > 0 ? styles.flash : ""}`}
          >
            <div className={styles.codeTable}>{renderedLines}</div>
          </div>
        )}
      </div>
    );
  }

  // Fallback
  return (
    <div className={styles.viewerContainer}>
      <div className={styles.centerMessage}>Unable to display file</div>
    </div>
  );
}

// ── Header sub-component ───────────────────────────────────────

function Header({
  filePath,
  language,
  lineCount,
  viewMode,
  onSetViewMode,
}: {
  filePath: string;
  language: string | null;
  lineCount: number | null;
  viewMode?: "rendered" | "source";
  onSetViewMode?: (mode: "rendered" | "source") => void;
}): React.JSX.Element {
  return (
    <div className={styles.header}>
      <PathBreadcrumb filePath={filePath} />

      {/* Preview / Source toggle for markdown */}
      {viewMode !== undefined && onSetViewMode && (
        <div className={styles.viewToggle}>
          <button
            className={`${styles.toggleBtn} ${viewMode === "rendered" ? styles.toggleBtnActive : ""}`}
            onClick={() => onSetViewMode("rendered")}
          >
            Preview
          </button>
          <button
            className={`${styles.toggleBtn} ${viewMode === "source" ? styles.toggleBtnActive : ""}`}
            onClick={() => onSetViewMode("source")}
          >
            Source
          </button>
        </div>
      )}

      {language && language !== "markdown" && (
        <span className={styles.badge}>{language.toUpperCase()}</span>
      )}
      {lineCount !== null && (
        <span className={styles.badge}>{lineCount} lines</span>
      )}
      <span className={styles.badge}>READ ONLY</span>
    </div>
  );
}
