import React, { useEffect, useRef, useState } from "react";
import styles from "./MarkdownViewer.module.css";

let instanceCounter = 0;

export function MermaidDiagram({ code }: { code: string }): React.JSX.Element {
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [svgContent, setSvgContent] = useState<string>("");
  const [scale, setScale] = useState(1);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const instanceId = useRef(`mermaid-${++instanceCounter}`);

  useEffect(() => {
    setLoading(true);
    setError(null);
    setSvgContent("");

    let cancelled = false;

    const renderDiagram = async (): Promise<void> => {
      try {
        const mermaid = (await import("mermaid")).default;
        if (cancelled) return;

        (mermaid as { initialize: (config: unknown) => void }).initialize({
          startOnLoad: false,
          theme: "base",
          securityLevel: "loose",
        });

        const id = instanceId.current;
        const result = await (
          mermaid as {
            render: (id: string, text: string) => Promise<{ svg: string }>;
          }
        ).render(id, code);
        if (!cancelled) {
          setSvgContent(result.svg);
          setLoading(false);
        }
      } catch (err) {
        if (cancelled) return;
        const message =
          err instanceof Error ? err.message : "Failed to render diagram";
        setError(message);
        setLoading(false);
      }
    };

    renderDiagram();

    return () => {
      cancelled = true;
    };
  }, [code]);

  const handleZoomIn = (): void => {
    setScale((s) => Math.min(s + 0.25, 3));
  };

  const handleZoomOut = (): void => {
    setScale((s) => Math.max(s - 0.25, 0.5));
  };

  const handleResetZoom = (): void => {
    setScale(1);
  };

  const handleFullscreen = (): void => {
    setIsFullscreen(true);
    setScale(1);
  };

  const handleExitFullscreen = (): void => {
    setIsFullscreen(false);
    setScale(1);
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent): void => {
      if (e.key === "Escape" && isFullscreen) {
        handleExitFullscreen();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isFullscreen]);

  if (error) {
    return (
      <div className={styles.mermaidContainer}>
        <div className={styles.mermaidError}>
          <span className={styles.mermaidErrorIcon}>⚠</span>
          <span className={styles.mermaidErrorText}>{error}</span>
        </div>
      </div>
    );
  }

  const containerStyle: React.CSSProperties = {
    transform: `scale(${scale})`,
    transformOrigin: isFullscreen ? "center center" : "top left",
  };

  if (isFullscreen) {
    return (
      <div className={styles.mermaidFullscreenOverlay}>
        <div className={styles.mermaidFullscreenHeader}>
          <div className={styles.mermaidControls}>
            <button
              className={styles.mermaidControlBtn}
              onClick={handleZoomOut}
              title="Zoom out"
            >
              −
            </button>
            <span className={styles.mermaidScale}>
              {Math.round(scale * 100)}%
            </span>
            <button
              className={styles.mermaidControlBtn}
              onClick={handleZoomIn}
              title="Zoom in"
            >
              +
            </button>
            <button
              className={styles.mermaidControlBtn}
              onClick={handleResetZoom}
              title="Reset zoom"
            >
              ↺
            </button>
            <button
              className={styles.mermaidControlBtn}
              onClick={handleExitFullscreen}
              title="Exit fullscreen"
            >
              ✕
            </button>
          </div>
        </div>
        <div
          className={styles.mermaidDiagram}
          style={containerStyle}
          dangerouslySetInnerHTML={{ __html: svgContent }}
        />
      </div>
    );
  }

  return (
    <div className={styles.mermaidContainer}>
      <div className={styles.mermaidControls}>
        <button
          className={styles.mermaidControlBtn}
          onClick={handleZoomOut}
          title="Zoom out"
        >
          −
        </button>
        <span className={styles.mermaidScale}>{Math.round(scale * 100)}%</span>
        <button
          className={styles.mermaidControlBtn}
          onClick={handleZoomIn}
          title="Zoom in"
        >
          +
        </button>
        <button
          className={styles.mermaidControlBtn}
          onClick={handleResetZoom}
          title="Reset zoom"
        >
          ↺
        </button>
        <button
          className={styles.mermaidControlBtn}
          onClick={handleFullscreen}
          title="Fullscreen"
        >
          ⤢
        </button>
      </div>
      {loading && <div className={styles.mermaidLoading}>Rendering...</div>}
      <div
        className={styles.mermaidDiagram}
        style={containerStyle}
        dangerouslySetInnerHTML={{ __html: svgContent }}
      />
    </div>
  );
}
