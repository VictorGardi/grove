import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useDataStore, useSelectedTask } from "../../stores/useDataStore";
import { updateTask, archiveTask } from "../../actions/taskActions";
import {
  parseTaskBody,
  serializeTaskBody,
  type TaskBody,
} from "../../utils/taskBodyParser";
import { InlineEdit } from "../shared/InlineEdit";
import { TagInput } from "../shared/TagInput";
import type { TaskPriority, DodItem } from "@shared/types";
import styles from "./TaskDetailPanel.module.css";

// ── Constants ─────────────────────────────────────────────────────

const STATUS_COLORS: Record<string, string> = {
  backlog: "var(--text-lo)",
  doing: "var(--status-green)",
  review: "var(--status-amber)",
  done: "var(--status-green)",
};

const PRIORITY_LEVELS: TaskPriority[] = ["critical", "high", "medium", "low"];

const PRIORITY_STYLE: Record<TaskPriority, string> = {
  critical: styles.priorityCritical,
  high: styles.priorityHigh,
  medium: styles.priorityMedium,
  low: styles.priorityLow,
};

const AGENT_OPTIONS = [
  "",
  "claude-code",
  "copilot",
  "codex",
  "aider",
  "opencode",
];

const DEBOUNCE_MS = 300;

// ── Component ─────────────────────────────────────────────────────

export function TaskDetailPanel(): React.JSX.Element {
  const task = useSelectedTask();
  const selectedTaskBody = useDataStore((s) => s.selectedTaskBody);
  const taskDetailLoading = useDataStore((s) => s.taskDetailLoading);
  const setTaskDetailDirty = useDataStore((s) => s.setTaskDetailDirty);
  const clearSelectedTask = useDataStore((s) => s.clearSelectedTask);
  const milestones = useDataStore((s) => s.milestones);
  const allTasks = useDataStore((s) => s.tasks);

  console.log("[TDP] render:", {
    taskId: task?.id,
    taskPriority: task?.priority,
    taskCount: allTasks.length,
    bodyLen: selectedTaskBody?.length,
    loading: taskDetailLoading,
  });

  // Parsed body state — local to panel, synced from store body
  const [parsed, setParsed] = useState<TaskBody>({
    description: "",
    dod: [],
    contextForAgent: "",
    otherSections: [],
  });

  // Debounce timers
  const descTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ctxTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Dod add-item input
  const [dodInput, setDodInput] = useState("");

  // Open milestones for the picker
  const openMilestones = useMemo(
    () => milestones.filter((m) => m.status === "open"),
    [milestones],
  );

  // ── Sync parsed body from store ──────────────────────────────

  useEffect(() => {
    if (selectedTaskBody !== null) {
      setParsed(parseTaskBody(selectedTaskBody));
    } else {
      setParsed({
        description: "",
        dod: [],
        contextForAgent: "",
        otherSections: [],
      });
    }
  }, [selectedTaskBody]);

  // ── Cleanup timers ────────────────────────────────────────────

  useEffect(() => {
    return () => {
      if (descTimerRef.current) clearTimeout(descTimerRef.current);
      if (ctxTimerRef.current) clearTimeout(ctxTimerRef.current);
    };
  }, []);

  // ── Body save helper ──────────────────────────────────────────

  const saveBody = useCallback(
    (updatedParsed: TaskBody) => {
      if (!task) return;
      const body = serializeTaskBody(updatedParsed);
      updateTask(task.filePath, {}, body);
      // Dirty flag cleared when chokidar re-delivers body
    },
    [task],
  );

  // ── Loading / empty state ─────────────────────────────────────

  if (!task) return <div className={styles.panel} />;

  if (taskDetailLoading) {
    return (
      <div className={styles.panel}>
        <div className={styles.loading}>Loading...</div>
      </div>
    );
  }

  // ── Frontmatter field handlers ────────────────────────────────

  function handleTitleSave(title: string): void {
    updateTask(task!.filePath, { title });
  }

  function handlePriorityClick(p: TaskPriority): void {
    // Toggle off if clicking the active priority
    const newVal = task!.priority === p ? null : p;
    updateTask(task!.filePath, { priority: newVal });
  }

  function handleAgentChange(e: React.ChangeEvent<HTMLSelectElement>): void {
    const val = e.target.value || null;
    updateTask(task!.filePath, { agent: val });
  }

  function handleMilestoneChange(
    e: React.ChangeEvent<HTMLSelectElement>,
  ): void {
    const val = e.target.value || null;
    updateTask(task!.filePath, { milestone: val });
  }

  function handleTagsChange(tags: string[]): void {
    updateTask(task!.filePath, { tags });
  }

  // ── Body section handlers ─────────────────────────────────────

  function handleDescriptionChange(
    e: React.ChangeEvent<HTMLTextAreaElement>,
  ): void {
    const description = e.target.value;
    const next = { ...parsed, description };
    setParsed(next);
    setTaskDetailDirty(true);

    if (descTimerRef.current) clearTimeout(descTimerRef.current);
    descTimerRef.current = setTimeout(() => {
      saveBody(next);
      setTaskDetailDirty(false);
    }, DEBOUNCE_MS);
  }

  function handleContextChange(
    e: React.ChangeEvent<HTMLTextAreaElement>,
  ): void {
    const contextForAgent = e.target.value;
    const next = { ...parsed, contextForAgent };
    setParsed(next);
    setTaskDetailDirty(true);

    if (ctxTimerRef.current) clearTimeout(ctxTimerRef.current);
    ctxTimerRef.current = setTimeout(() => {
      saveBody(next);
      setTaskDetailDirty(false);
    }, DEBOUNCE_MS);
  }

  // ── DoD handlers ──────────────────────────────────────────────

  function handleDodToggle(index: number): void {
    const dod = parsed.dod.map((item, i) =>
      i === index ? { ...item, checked: !item.checked } : item,
    );
    const next = { ...parsed, dod };
    setParsed(next);
    saveBody(next);
  }

  function handleDodDelete(index: number): void {
    const dod = parsed.dod.filter((_, i) => i !== index);
    const next = { ...parsed, dod };
    setParsed(next);
    saveBody(next);
  }

  function handleDodAdd(e: React.KeyboardEvent<HTMLInputElement>): void {
    if (e.key !== "Enter") return;
    const text = dodInput.trim();
    if (!text) return;

    const item: DodItem = { text, checked: false };
    const dod = [...parsed.dod, item];
    const next = { ...parsed, dod };
    setParsed(next);
    setDodInput("");
    saveBody(next);
  }

  // ── Archive handler ───────────────────────────────────────────

  function handleArchive(): void {
    if (
      window.confirm("Archive this task? It will be moved to .tasks/archive/")
    ) {
      archiveTask(task!.filePath);
    }
  }

  // ── Computed values ───────────────────────────────────────────

  const dodDone = parsed.dod.filter((d) => d.checked).length;
  const dodTotal = parsed.dod.length;
  const dodPct = dodTotal > 0 ? Math.round((dodDone / dodTotal) * 100) : 0;

  // ── Render ────────────────────────────────────────────────────

  return (
    <div className={styles.panel}>
      {/* 1. Header */}
      <div className={styles.header}>
        <div className={styles.headerTop}>
          <span className={styles.idBadge}>{task.id}</span>
          <span className={styles.statusTag}>
            <span
              className={styles.statusDot}
              style={{ background: STATUS_COLORS[task.status] }}
            />
            {task.status}
          </span>
          <button
            className={styles.closeBtn}
            onClick={clearSelectedTask}
            aria-label="Close detail panel"
          >
            &times;
          </button>
        </div>

        {/* 2. Title */}
        <InlineEdit
          value={task.title}
          onSave={handleTitleSave}
          className={styles.titleEdit}
          tag="h3"
          placeholder="Task title..."
        />
      </div>

      {/* Scrollable body */}
      <div className={styles.body}>
        {/* 3. Priority */}
        <div className={styles.section}>
          <div className={styles.sectionLabel}>Priority</div>
          <div className={styles.priorityRow}>
            {PRIORITY_LEVELS.map((p) => (
              <button
                key={p}
                className={`${styles.priorityPill} ${
                  task.priority === p
                    ? `${styles.priorityPillActive} ${PRIORITY_STYLE[p]}`
                    : ""
                }`}
                onClick={() => handlePriorityClick(p)}
              >
                {p}
              </button>
            ))}
          </div>
        </div>

        {/* 4. Agent */}
        <div className={styles.section}>
          <div className={styles.sectionLabel}>Agent</div>
          <select
            className={styles.fieldSelect}
            value={task.agent || ""}
            onChange={handleAgentChange}
          >
            <option value="">None</option>
            {AGENT_OPTIONS.filter(Boolean).map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </div>

        {/* 5. Milestone */}
        <div className={styles.section}>
          <div className={styles.sectionLabel}>Milestone</div>
          <select
            className={styles.fieldSelect}
            value={task.milestone || ""}
            onChange={handleMilestoneChange}
          >
            <option value="">None</option>
            {openMilestones.map((m) => (
              <option key={m.id} value={m.id}>
                {m.id} — {m.title}
              </option>
            ))}
          </select>
        </div>

        {/* 6. Tags */}
        <div className={styles.section}>
          <div className={styles.sectionLabel}>Tags</div>
          <TagInput
            tags={task.tags || []}
            onChange={handleTagsChange}
            placeholder="Add tag..."
          />
        </div>

        {/* 7. Description */}
        <div className={styles.section}>
          <div className={styles.sectionLabel}>Description</div>
          <textarea
            className={styles.textarea}
            value={parsed.description}
            onChange={handleDescriptionChange}
            placeholder="Task description..."
          />
        </div>

        {/* 8. Definition of Done */}
        <div className={styles.section}>
          <div className={styles.dodHeader}>
            <span className={styles.sectionLabel}>Definition of Done</span>
            {dodTotal > 0 && (
              <span className={styles.dodProgress}>
                {dodDone}/{dodTotal} complete
              </span>
            )}
          </div>
          {dodTotal > 0 && (
            <div className={styles.dodTrack}>
              <div className={styles.dodFill} style={{ width: `${dodPct}%` }} />
            </div>
          )}
          {parsed.dod.map((item, i) => (
            <div key={i} className={styles.dodItem}>
              <input
                type="checkbox"
                className={styles.dodCheckbox}
                checked={item.checked}
                onChange={() => handleDodToggle(i)}
              />
              <span
                className={`${styles.dodText} ${
                  item.checked ? styles.dodTextDone : ""
                }`}
              >
                {item.text}
              </span>
              <button
                className={styles.dodDeleteBtn}
                onClick={() => handleDodDelete(i)}
                aria-label={`Remove: ${item.text}`}
              >
                &times;
              </button>
            </div>
          ))}
          <input
            className={styles.dodAddInput}
            value={dodInput}
            onChange={(e) => setDodInput(e.target.value)}
            onKeyDown={handleDodAdd}
            placeholder="Add checklist item..."
          />
        </div>

        {/* 9. Linked decisions (read-only) */}
        {task.decisions && task.decisions.length > 0 && (
          <div className={styles.section}>
            <div className={styles.sectionLabel}>Linked Decisions</div>
            {task.decisions.map((d) => (
              <span key={d} className={styles.decisionBadge}>
                {d}
              </span>
            ))}
          </div>
        )}

        {/* 10. Context for agent */}
        <div className={styles.section}>
          <div className={styles.sectionLabel}>Context for Agent</div>
          <textarea
            className={styles.textarea}
            value={parsed.contextForAgent}
            onChange={handleContextChange}
            placeholder="Context and instructions for the AI agent..."
          />
        </div>

        {/* 11. Metadata footer */}
        <div className={styles.footer}>
          {task.created && (
            <div className={styles.metaLine}>Created: {task.created}</div>
          )}
          <div className={styles.metaPath}>{task.filePath}</div>
          <button className={styles.archiveBtn} onClick={handleArchive}>
            Archive task
          </button>
        </div>
      </div>
    </div>
  );
}
