import { useState, useEffect } from "react";
import { createClient } from "../../utils/opencodeClient";
import styles from "./SessionPicker.module.css";

interface SessionInfo {
  id: string;
  title: string;
  lastUpdated: number;
  changes?: {
    additions: number;
    deletions: number;
    files: number;
  };
}

interface SessionPickerProps {
  sessionIds: string[];
  directory: string;
  onSelect: (sessionId: string) => void;
  onNewSession: () => void;
  onClose: () => void;
}

async function fetchSessionInfo(sessionId: string, directory: string): Promise<SessionInfo | null> {
  try {
    const serverResult = await window.api.opencodeServer.ensure();
    if ("error" in serverResult) return null;

    const client = createClient(serverResult.url);
    const result = await client.session.get({ sessionID: sessionId, directory });
    
    if (result.error || !result.data) return null;
    
    return {
      id: result.data.id,
      title: result.data.title || "Untitled",
      lastUpdated: result.data.time?.updated || Date.now(),
      changes: result.data.summary,
    };
  } catch (err) {
    console.error("[SessionPicker] Failed to fetch session:", sessionId, err);
    return null;
  }
}

function formatRelativeTime(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;
  
  if (diff < 60000) return "just now";
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  if (diff < 604800000) return `${Math.floor(diff / 86400000)}d ago`;
  
  return new Date(timestamp).toLocaleDateString();
}

export function SessionPicker({
  sessionIds,
  directory,
  onSelect,
  onNewSession,
  onClose,
}: SessionPickerProps): React.JSX.Element {
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchAllSessions = async () => {
      setLoading(true);
      const results = await Promise.all(
        sessionIds.map((id) => fetchSessionInfo(id, directory))
      );
      const validSessions = results.filter((s): s is SessionInfo => s !== null);
      // Sort by last updated, most recent first
      validSessions.sort((a, b) => b.lastUpdated - a.lastUpdated);
      setSessions(validSessions);
      setLoading(false);
    };

    void fetchAllSessions();
  }, [sessionIds, directory]);

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <h2 className={styles.title}>Select Session</h2>
          <button className={styles.closeBtn} onClick={onClose}>x</button>
        </div>

        <div className={styles.content}>
          {loading ? (
            <div className={styles.loading}>Loading sessions...</div>
          ) : sessions.length === 0 ? (
            <div className={styles.empty}>No sessions found</div>
          ) : (
            <div className={styles.sessionList}>
              {sessions.map((session) => (
                <button
                  key={session.id}
                  className={styles.sessionItem}
                  onClick={() => onSelect(session.id)}
                >
                  <div className={styles.sessionTitle}>{session.title}</div>
                  <div className={styles.sessionMeta}>
                    <span className={styles.timestamp}>
                      {formatRelativeTime(session.lastUpdated)}
                    </span>
                    {session.changes && (
                      <span className={styles.changes}>
                        +{session.changes.additions} -{session.changes.deletions} ({session.changes.files} files)
                      </span>
                    )}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className={styles.footer}>
          <button className={styles.newSessionBtn} onClick={onNewSession}>
            + Start New Session
          </button>
        </div>
      </div>
    </div>
  );
}