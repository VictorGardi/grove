import { useState, useCallback, memo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useStreamingThrottle } from "../../hooks/useStreamingThrottle";
import styles from "./TaskEventStream.module.css";

const TERMINAL_LANGS = new Set(["bash", "sh", "zsh", "fish", "shell", "console"]);

function ChatCodeBlock({
  inline,
  className,
  children,
}: {
  inline?: boolean;
  className?: string;
  children?: React.ReactNode;
}): React.JSX.Element {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    const text = String(children).replace(/\n$/, "");
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }, [children]);

  if (inline) {
    return <code className={styles.inlineCode}>{children}</code>;
  }

  const language = className?.replace("language-", "") ?? "";
  const isTerminal = TERMINAL_LANGS.has(language);
  const text = String(children).replace(/\n$/, "");
  const lines = text.split("\n");
  const showLineNumbers = lines.length > 8;

  return (
    <div className={`${styles.codeBlock} ${isTerminal ? styles.terminalBlock : ""}`}>
      <div className={styles.codeBlockHeader}>
        {language && <span className={styles.langBadge}>{language}</span>}
        <button className={styles.copyButton} onClick={handleCopy}>
          {copied ? "✓ copied" : "copy"}
        </button>
      </div>
      <pre className={styles.codeBlockPre}>
        <code className={styles.codeBlockCode}>
          {showLineNumbers
            ? lines.map((line, i) => (
                <span key={i} className={styles.codeLine}>
                  <span className={styles.lineNum}>{i + 1}</span>
                  {line}
                  {"\n"}
                </span>
              ))
            : text}
        </code>
      </pre>
    </div>
  );
}

// Memoised markdown block — stable blocks never re-render
const MarkdownBlock = memo(function MarkdownBlock({ text }: { text: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{ code: ChatCodeBlock }}
    >
      {text}
    </ReactMarkdown>
  );
});

export function StreamingText({ text, isStreaming, partId }: { text: string; isStreaming: boolean; partId?: string }): React.JSX.Element {
  // Throttle display updates during streaming
  const displayText = useStreamingThrottle({
    text,
    isStreaming,
    identityKey: partId ?? "text",
  });

  return (
    <div className={styles.textPart}>
      <MarkdownBlock text={displayText} />
    </div>
  );
}
