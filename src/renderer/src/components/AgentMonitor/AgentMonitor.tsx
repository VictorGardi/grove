import { useEffect, useState, useCallback } from "react";
import type { TmuxSessionInfo } from "@shared/types";
import { useNavStore } from "../../stores/useNavStore";
import { useWorkspaceStore } from "../../stores/useWorkspaceStore";
import { useDataStore } from "../../stores/useDataStore";
import { useAgentsStore } from "../../stores/useAgentsStore";

type SessionStatus =
  | "COMPLETED"
  | "HUNG"
  | "LINGERING"
  | "RUNNING"
  | "WAITING"
  | "IDLE"
  | "ZOMBIE"
  | "ALL";

type FilterOption = SessionStatus;

const FILTER_OPTIONS: FilterOption[] = [
  "ALL",
  "RUNNING",
  "WAITING",
  "IDLE",
  "COMPLETED",
  "HUNG",
  "LINGERING",
  "ZOMBIE",
];

const AGENT_BINARIES = ["opencode", "copilot", "aider", "claude"];
const SHELL_BINARIES = ["bash", "zsh", "sh"];

function classifyStatus(session: TmuxSessionInfo): SessionStatus {
  if (session.paneDead) return "ZOMBIE";
  if (session.taskStatus === "done") return "COMPLETED";
  if (session.taskStatus === null) return "HUNG";
  if (session.taskStatus === "review") return "LINGERING";
  if (session.taskStatus === "doing") {
    const cmd = session.paneCommand.toLowerCase();
    if (AGENT_BINARIES.some((b) => cmd.includes(b))) {
      return session.idleSeconds >= 30 ? "WAITING" : "RUNNING";
    }
    if (SHELL_BINARIES.some((b) => cmd.includes(b))) {
      return "IDLE";
    }
  }
  return "RUNNING";
}

function formatDuration(seconds: number): string {
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  if (hrs > 0) return `${hrs}h ${mins}m`;
  if (mins > 0) return `${mins}m ${secs}s`;
  return `${secs}s`;
}

const statusColors: Record<SessionStatus, string> = {
  ALL: "#94a3b8",
  COMPLETED: "#22c55e",
  HUNG: "#ef4444",
  LINGERING: "#eab308",
  RUNNING: "#22c55e",
  WAITING: "#eab308",
  IDLE: "#94a3b8",
  ZOMBIE: "#ef4444",
};

export function AgentMonitor(): React.JSX.Element {
  const [sessions, setSessions] = useState<TmuxSessionInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const setActiveView = useNavStore((s) => s.setActiveView);
  const activeWorkspacePath = useWorkspaceStore((s) => s.activeWorkspacePath);
  const setActiveWorkspace = useWorkspaceStore((s) => s.setActiveWorkspace);
  const setSelectedTask = useDataStore((s) => s.setSelectedTask);
  const setHungCount = useAgentsStore((s) => s.setHungCount);
  const setRunningCount = useAgentsStore((s) => s.setRunningCount);
  const agentFilter = useAgentsStore((s) => s.agentFilter);
  const setAgentFilter = useAgentsStore((s) => s.setAgentFilter);

  const fetchSessions = useCallback(async () => {
    try {
      const data = await window.api.tmux.listGroveSessions();
      setSessions(data);
      setError(null);
      const hung = data.filter(
        (s) => classifyStatus(s) === "HUNG" || classifyStatus(s) === "ZOMBIE",
      ).length;
      setHungCount(hung);
      const running = data.filter(
        (s) => classifyStatus(s) === "RUNNING",
      ).length;
      setRunningCount(running);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch sessions");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSessions();
    const interval = setInterval(fetchSessions, 5000);
    return () => clearInterval(interval);
  }, [fetchSessions]);

  const handleKill = async (session: TmuxSessionInfo) => {
    setSessions((prev) =>
      prev.filter((s) => s.sessionName !== session.sessionName),
    );
    const result = await window.api.tmux.killSession({
      sessionName: session.sessionName,
    });
    if (!result.ok) {
      fetchSessions();
    }
    if (session.sessionType.startsWith("term-")) {
      // Extract mode from sessionType (e.g., "term-plan" -> "plan")
      const mode = session.sessionType.replace("term-", "");
      const ptyId = `taskterm-${mode}-${session.taskId}`;
      await window.api.pty.kill(ptyId);
    }
  };

  const handleTaskClick = async (session: TmuxSessionInfo) => {
    if (
      session.workspacePath &&
      session.workspacePath !== activeWorkspacePath
    ) {
      await setActiveWorkspace(session.workspacePath);
    }
    setActiveView("board");
    setSelectedTask(session.taskId);
  };

  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const hasWorkspaces = workspaces.length > 0;

  if (!hasWorkspaces) {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          height: "100%",
          color: "var(--text-lo)",
        }}
      >
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: "14px", marginBottom: "8px" }}>
            No workspaces configured
          </div>
          <div style={{ fontSize: "12px", color: "var(--text-disabled)" }}>
            Add a workspace to see agent sessions
          </div>
        </div>
      </div>
    );
  }

  if (loading && sessions.length === 0) {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          height: "100%",
        }}
      >
        <div style={{ color: "var(--text-lo)" }}>Loading...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          height: "100%",
          color: "var(--color-error)",
        }}
      >
        {error}
      </div>
    );
  }

  if (sessions.length === 0) {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          height: "100%",
          color: "var(--text-lo)",
        }}
      >
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: "14px", marginBottom: "8px" }}>
            No active sessions
          </div>
          <div style={{ fontSize: "12px", color: "var(--text-disabled)" }}>
            Agent sessions will appear here when running
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        height: "100%",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          padding: "12px 16px",
          borderBottom: "1px solid var(--border)",
          fontSize: "12px",
          color: "var(--text-lo)",
          display: "flex",
          flexDirection: "column",
          gap: "8px",
        }}
      >
        <span>
          Polling every 5s — runs independently of workspace status liveness
          check
        </span>
        <div style={{ display: "flex", gap: "4px", flexWrap: "wrap" }}>
          {FILTER_OPTIONS.map((option) => (
            <button
              key={option}
              onClick={() => setAgentFilter(option)}
              style={{
                background:
                  agentFilter === option ? "var(--bg-active)" : "transparent",
                border: "1px solid var(--border)",
                color:
                  agentFilter === option
                    ? "var(--text-primary)"
                    : "var(--text-secondary)",
                padding: "4px 8px",
                fontSize: "11px",
                borderRadius: "4px",
                cursor: "pointer",
              }}
            >
              {option}
            </button>
          ))}
        </div>
      </div>
      <div
        style={{
          flex: 1,
          overflow: "auto",
          padding: "8px",
        }}
      >
        <table
          style={{
            width: "100%",
            borderCollapse: "collapse",
            fontSize: "12px",
          }}
        >
          <thead>
            <tr style={{ color: "var(--text-lo)", textAlign: "left" }}>
              <th style={{ padding: "8px", width: "80px" }}>STATUS</th>
              <th style={{ padding: "8px", width: "80px" }}>TASK</th>
              <th style={{ padding: "8px", width: "100px" }}>WORKSPACE</th>
              <th style={{ padding: "8px", width: "70px" }}>MODE</th>
              <th style={{ padding: "8px", width: "70px" }}>AGENT</th>
              <th style={{ padding: "8px", width: "100px" }}>MODEL</th>
              <th style={{ padding: "8px", width: "70px" }}>IDLE</th>
              <th style={{ padding: "8px", width: "70px" }}>DURATION</th>
              <th style={{ padding: "8px", width: "60px" }}>ACTIONS</th>
            </tr>
          </thead>
          <tbody>
            {sessions
              .filter(
                (session) =>
                  agentFilter === "ALL" ||
                  classifyStatus(session) === agentFilter,
              )
              .map((session) => {
                const status = classifyStatus(session);
                return (
                  <tr
                    key={session.sessionName}
                    style={{
                      borderBottom: "1px solid var(--border)",
                      background:
                        status === "HUNG" || status === "ZOMBIE"
                          ? "rgba(239, 68, 68, 0.1)"
                          : "transparent",
                    }}
                  >
                    <td style={{ padding: "8px" }}>
                      <span
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: "6px",
                        }}
                      >
                        <span
                          style={{
                            width: "8px",
                            height: "8px",
                            borderRadius: "50%",
                            backgroundColor: statusColors[status],
                          }}
                        />
                        {status}
                      </span>
                    </td>
                    <td style={{ padding: "8px" }}>
                      <button
                        onClick={() => handleTaskClick(session)}
                        style={{
                          background: "none",
                          border: "none",
                          color: "var(--text-link)",
                          cursor: "pointer",
                          font: "inherit",
                          padding: 0,
                        }}
                      >
                        {session.taskId}
                      </button>
                    </td>
                    <td
                      style={{ padding: "8px", color: "var(--text-secondary)" }}
                    >
                      {session.workspaceName ?? session.workspaceHash}
                    </td>
                    <td style={{ padding: "8px" }}>
                      {session.sessionType.replace("term-", "")}
                    </td>
                    <td
                      style={{ padding: "8px", color: "var(--text-secondary)" }}
                    >
                      {session.agent ?? "-"}
                    </td>
                    <td
                      style={{ padding: "8px", color: "var(--text-secondary)" }}
                    >
                      {session.model ?? "-"}
                    </td>
                    <td style={{ padding: "8px" }}>
                      {formatDuration(session.idleSeconds)}
                    </td>
                    <td style={{ padding: "8px" }}>
                      {formatDuration(session.durationSeconds)}
                    </td>
                    <td style={{ padding: "8px" }}>
                      <button
                        onClick={() => handleKill(session)}
                        style={{
                          background: "none",
                          border: "1px solid var(--border)",
                          color: "var(--text-secondary)",
                          cursor: "pointer",
                          padding: "4px 8px",
                          fontSize: "11px",
                          borderRadius: "4px",
                        }}
                      >
                        Kill
                      </button>
                    </td>
                  </tr>
                );
              })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
