import { useState, useCallback, useRef, useEffect } from "react";
import { createClient } from "../../utils/opencodeClient";
import styles from "./CommandAutocomplete.module.css";

export interface CommandInfo {
  name: string;
  description: string;
  icon?: string;
}

interface CommandAutocompleteProps {
  query: string;
  commands: CommandInfo[];
  onSelect: (command: string) => void;
  onClose: () => void;
  position: { top: number; left: number; width?: number };
}

export function CommandAutocomplete({
  query,
  commands,
  onSelect,
  onClose,
  position,
}: CommandAutocompleteProps) {
  const [activeIndex, setActiveIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const filtered = commands.filter((cmd) =>
    cmd.name.toLowerCase().includes(query.toLowerCase()),
  );

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveIndex((prev) => (prev + 1) % filtered.length);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIndex((prev) => (prev - 1 + filtered.length) % filtered.length);
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (filtered[activeIndex]) {
          onSelect(filtered[activeIndex].name);
        }
      } else if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    },
    [filtered, activeIndex, onSelect, onClose],
  );

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  useEffect(() => {
    if (listRef.current) {
      const activeItem = listRef.current.children[activeIndex] as HTMLElement;
      if (activeItem) {
        activeItem.scrollIntoView({ block: "nearest" });
      }
    }
  }, [activeIndex]);

  if (filtered.length === 0) return null;

  return (
    <div
      ref={listRef}
      className={styles.dropdown}
      style={{
        position: "fixed",
        top: position.top,
        left: position.left,
        width: position.width || 300,
      }}
      onMouseDown={(e) => e.preventDefault()}
    >
      {filtered.map((cmd, idx) => (
        <div
          key={cmd.name}
          className={`${styles.item} ${idx === activeIndex ? styles.active : ""}`}
          onMouseEnter={() => setActiveIndex(idx)}
          onMouseDown={(e) => {
            e.preventDefault();
            onSelect(cmd.name);
          }}
        >
          <span className={styles.icon}>{cmd.icon}</span>
          <div className={styles.content}>
            <span className={styles.name}>{cmd.name}</span>
            <span className={styles.description}>{cmd.description}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

interface ModelSelectorProps {
  models: string[];
  onSelect: (model: string) => void;
  onClose: () => void;
  position: { top: number; left: number; width?: number };
}

export function ModelSelector({
  models,
  onSelect,
  onClose,
  position,
}: ModelSelectorProps) {
  const [activeIndex, setActiveIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveIndex((prev) => (prev + 1) % models.length);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIndex((prev) => (prev - 1 + models.length) % models.length);
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (models[activeIndex]) {
          onSelect(models[activeIndex]);
        }
      } else if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    },
    [models, activeIndex, onSelect, onClose],
  );

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  useEffect(() => {
    if (listRef.current) {
      const activeItem = listRef.current.children[activeIndex] as HTMLElement;
      if (activeItem) {
        activeItem.scrollIntoView({ block: "nearest" });
      }
    }
  }, [activeIndex]);

  if (models.length === 0) return null;

  return (
    <div
      ref={listRef}
      className={styles.dropdown}
      style={{
        position: "fixed",
        top: position.top,
        left: position.left,
        width: position.width || 300,
      }}
      onMouseDown={(e) => e.preventDefault()}
    >
      {models.map((model, idx) => (
        <div
          key={model}
          className={`${styles.item} ${idx === activeIndex ? styles.active : ""}`}
          onMouseEnter={() => setActiveIndex(idx)}
          onMouseDown={(e) => {
            e.preventDefault();
            onSelect(model);
          }}
        >
          <span className={styles.modelName}>{model}</span>
        </div>
      ))}
    </div>
  );
}

interface SessionItem {
  id: string;
  label: string;
  sub: string;
}

const NEW_SESSION_ID = "__new__";

function formatRelativeTime(timestamp: number): string {
  const diff = Date.now() - timestamp;
  if (diff < 60000) return "just now";
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  if (diff < 604800000) return `${Math.floor(diff / 86400000)}d ago`;
  return new Date(timestamp).toLocaleDateString();
}

interface SessionSelectorProps {
  sessionIds: string[];
  directory: string;
  onSelect: (sessionId: string) => void;
  onNewSession: () => void;
  onClose: () => void;
  position: { top: number; left: number; width?: number };
}

export function SessionSelector({
  sessionIds,
  directory,
  onSelect,
  onNewSession,
  onClose,
  position,
}: SessionSelectorProps) {
  const [items, setItems] = useState<SessionItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeIndex, setActiveIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const serverResult = await window.api.opencodeServer.ensure();
        if ("error" in serverResult) {
          setItems([{ id: NEW_SESSION_ID, label: "+ New session", sub: "" }]);
          setLoading(false);
          return;
        }
        const client = createClient(serverResult.url);
        const results = await Promise.all(
          sessionIds.map(async (id) => {
            try {
              const r = await client.session.get({ sessionID: id, directory });
              if (r.error || !r.data) return null;
              return {
                id,
                label: r.data.title || id.slice(0, 16),
                sub: r.data.time?.updated ? formatRelativeTime(r.data.time.updated) : "",
              } as SessionItem;
            } catch {
              return null;
            }
          }),
        );
        const valid = results.filter((s): s is SessionItem => s !== null);
        // Most recent first (items already sorted by server; fallback: preserve order)
        valid.push({ id: NEW_SESSION_ID, label: "+ New session", sub: "" });
        setItems(valid);
      } catch {
        setItems([{ id: NEW_SESSION_ID, label: "+ New session", sub: "" }]);
      } finally {
        setLoading(false);
      }
    };
    void load();
  }, [sessionIds, directory]);

  const handleSelect = useCallback(
    (item: SessionItem) => {
      if (item.id === NEW_SESSION_ID) {
        onNewSession();
      } else {
        onSelect(item.id);
      }
    },
    [onSelect, onNewSession],
  );

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (items.length === 0) return;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveIndex((prev) => (prev + 1) % items.length);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIndex((prev) => (prev - 1 + items.length) % items.length);
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (items[activeIndex]) handleSelect(items[activeIndex]);
      } else if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    },
    [items, activeIndex, handleSelect, onClose],
  );

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  useEffect(() => {
    if (listRef.current) {
      const activeItem = listRef.current.children[activeIndex] as HTMLElement;
      if (activeItem) activeItem.scrollIntoView({ block: "nearest" });
    }
  }, [activeIndex]);

  return (
    <div
      ref={listRef}
      className={styles.dropdown}
      style={{
        position: "fixed",
        top: position.top,
        left: position.left,
        width: position.width || 300,
      }}
      onMouseDown={(e) => e.preventDefault()}
    >
      {loading ? (
        <div className={styles.item}>Loading sessions...</div>
      ) : (
        items.map((item, idx) => (
          <div
            key={item.id}
            className={`${styles.item} ${idx === activeIndex ? styles.active : ""}`}
            onMouseEnter={() => setActiveIndex(idx)}
            onMouseDown={(e) => {
              e.preventDefault();
              handleSelect(item);
            }}
          >
            <div className={styles.content}>
              <span className={styles.name}>{item.label}</span>
              {item.sub && <span className={styles.description}>{item.sub}</span>}
            </div>
          </div>
        ))
      )}
    </div>
  );
}
