import { useState, useEffect, useTransition } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import styles from "./TaskEventStream.module.css";

interface StreamingTextProps {
  text: string;
  isStreaming: boolean;
}

function SyntaxHighlightedCode({
  inline,
  className,
  children,
}: {
  inline?: boolean;
  className?: string;
  children?: React.ReactNode;
}): React.JSX.Element {
  if (inline) {
    return (
      <code
        style={{
          background: "var(--bg-subtle)",
          padding: "2px 4px",
          borderRadius: "3px",
          fontSize: "0.9em",
        }}
      >
        {children}
      </code>
    );
  }

  return (
    <code className={className}>
      {children}
    </code>
  );
}

export function StreamingText({ text, isStreaming }: StreamingTextProps): React.JSX.Element {
  const [isPending, startTransition] = useTransition();
  const [showMarkdown, setShowMarkdown] = useState(!isStreaming);

  useEffect(() => {
    if (isStreaming) {
      setShowMarkdown(false);
    } else {
      startTransition(() => {
        setShowMarkdown(true);
      });
    }
  }, [isStreaming]);

  if (isStreaming) {
    return (
      <div className={`${styles.textPart} ${styles.textPartStreaming}`}>
        {text}
      </div>
    );
  }

  if (showMarkdown && !isPending) {
    return (
      <div className={styles.textPart}>
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{ code: SyntaxHighlightedCode }}
        >
          {text}
        </ReactMarkdown>
      </div>
    );
  }

  return (
    <div className={`${styles.textPart} ${styles.textPartStreaming}`}>
      {text}
    </div>
  );
}