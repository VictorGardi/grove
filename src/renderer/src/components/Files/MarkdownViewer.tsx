import React, { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { ThemedToken, BundledLanguage } from "shiki";
import { getHighlighter, SUPPORTED_LANGS } from "./shikiHighlighter";
import { MermaidDiagram } from "./MermaidDiagram";
import { useThemeStore } from "../../stores/useThemeStore";
import styles from "./MarkdownViewer.module.css";

// ── Shiki-powered code block inside markdown ───────────────────

function CodeBlock({
  lang,
  code,
}: {
  lang: string;
  code: string;
}): React.JSX.Element {
  const shikiTheme = useThemeStore((s) => s.colors.shikiTheme);
  const [tokenLines, setTokenLines] = useState<ThemedToken[][] | null>(null);

  useEffect(() => {
    if (lang === "mermaid") return;
    const normalizedLang =
      lang && SUPPORTED_LANGS.has(lang) && lang !== "text" ? lang : "text";
    if (normalizedLang === "text") {
      setTokenLines(null);
      return;
    }
    let cancelled = false;
    getHighlighter().then((highlighter) => {
      if (cancelled) return;
      try {
        const { tokens } = highlighter.codeToTokens(code, {
          lang: normalizedLang as BundledLanguage,
          theme: shikiTheme,
        });
        if (!cancelled) setTokenLines(tokens);
      } catch {
        if (!cancelled) setTokenLines(null);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [lang, code, shikiTheme]);

  if (lang === "mermaid") {
    return <MermaidDiagram code={code} />;
  }

  return (
    <div className={styles.codeBlock}>
      {lang && lang !== "text" && (
        <span className={styles.codeLang}>{lang}</span>
      )}
      <pre className={styles.codePre}>
        <code>
          {tokenLines
            ? tokenLines.map((tokens, lineIdx) => (
                <div key={lineIdx} className={styles.codeLine}>
                  {tokens.map((token, tokenIdx) => (
                    <span key={tokenIdx} style={{ color: token.color }}>
                      {token.content}
                    </span>
                  ))}
                </div>
              ))
            : code}
        </code>
      </pre>
    </div>
  );
}

// ── Markdown renderer ──────────────────────────────────────────

export function MarkdownViewer({
  content,
}: {
  content: string;
}): React.JSX.Element {
  return (
    <div className={styles.markdownBody}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          // Block code: `pre` intercepts and renders our Shiki CodeBlock.
          // By not rendering `children`, the inner `code` component is never
          // called for block code — React won't instantiate it.
          pre({ children }) {
            const child = children as React.ReactElement<{
              className?: string;
              children?: string;
            }>;
            const lang =
              child?.props?.className?.replace("language-", "") ?? "";
            const code = String(child?.props?.children ?? "").trimEnd();
            return <CodeBlock lang={lang} code={code} />;
          },
          // Inline code (never wrapped in a <pre>)
          code({ children }) {
            return <code className={styles.inlineCode}>{children}</code>;
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
