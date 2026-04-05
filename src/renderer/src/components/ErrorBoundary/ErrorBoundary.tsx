import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("[ErrorBoundary] Caught error:", error, info);
  }

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            height: "100%",
            background: "var(--bg-base)",
            color: "var(--text-secondary)",
            fontFamily: "var(--font-ui)",
            gap: "16px",
            padding: "32px",
          }}
        >
          <div style={{ fontSize: "14px", color: "var(--text-primary)" }}>
            Something went wrong
          </div>
          <div
            style={{
              fontSize: "12px",
              color: "var(--text-lo)",
              fontFamily: "var(--font-mono)",
              maxWidth: "480px",
              wordBreak: "break-word",
              textAlign: "center",
            }}
          >
            {this.state.error?.message}
          </div>
          <button
            onClick={() => window.location.reload()}
            style={{
              padding: "6px 16px",
              background: "var(--bg-elevated)",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius-md)",
              color: "var(--text-primary)",
              fontFamily: "var(--font-ui)",
              fontSize: "13px",
              cursor: "pointer",
            }}
          >
            Reload
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
