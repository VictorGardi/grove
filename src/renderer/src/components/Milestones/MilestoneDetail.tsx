import { useMemo, useState, useEffect, useRef } from "react";
import { useDataStore } from "../../stores/useDataStore";
import { useNavStore } from "../../stores/useNavStore";
import { updateMilestone } from "../../actions/milestoneActions";
import { createTask, updateTask } from "../../actions/taskActions";
import { InlineEdit } from "../shared/InlineEdit";
import { TagInput } from "../shared/TagInput";
import type { TaskStatus, MilestoneStatus } from "@shared/types";
import styles from "./MilestoneDetail.module.css";

const STATUS_GROUPS: { status: TaskStatus; label: string; color: string }[] = [
  { status: "doing", label: "Doing", color: "var(--status-green)" },
  { status: "review", label: "Review", color: "var(--status-amber)" },
  { status: "backlog", label: "Backlog", color: "var(--text-lo)" },
  { status: "done", label: "Done", color: "var(--status-green)" },
];

const PRIORITY_CLASSES: Record<string, string> = {
  critical: styles.priorityCritical,
  high: styles.priorityHigh,
  medium: styles.priorityMedium,
  low: styles.priorityLow,
};

const DEBOUNCE_MS = 300;

export function MilestoneDetail(): React.JSX.Element {
  const selectedId = useDataStore((s) => s.selectedMilestoneId);
  const milestones = useDataStore((s) => s.milestones);
  const tasks = useDataStore((s) => s.tasks);
  const setSelected = useDataStore((s) => s.setSelectedMilestone);
  const setMilestoneFilter = useDataStore((s) => s.setMilestoneFilter);

  const milestone = milestones.find((m) => m.id === selectedId);

  // Local description state for debounced editing
  const [localDesc, setLocalDesc] = useState("");
  const descTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sync description from milestone
  useEffect(() => {
    if (milestone) {
      setLocalDesc(milestone.description || "");
    }
  }, [milestone?.description, milestone?.id]);

  // Cleanup timer
  useEffect(() => {
    return () => {
      if (descTimerRef.current) clearTimeout(descTimerRef.current);
    };
  }, []);

  const linkedTasks = useMemo(() => {
    if (!selectedId) return [];
    return tasks.filter((t) => t.milestone === selectedId);
  }, [tasks, selectedId]);

  if (!milestone) return <div className={styles.panel} />;

  const { taskCounts } = milestone;
  const progressPct =
    taskCounts.total > 0
      ? Math.round((taskCounts.done / taskCounts.total) * 100)
      : 0;

  // ── Handlers ────────────────────────────────────────────────

  function handleTitleSave(title: string): void {
    updateMilestone(milestone!.filePath, { title });
  }

  function handleStatusToggle(): void {
    const newStatus: MilestoneStatus =
      milestone!.status === "open" ? "closed" : "open";
    updateMilestone(milestone!.filePath, { status: newStatus });
  }

  function handleTagsChange(tags: string[]): void {
    updateMilestone(milestone!.filePath, { tags });
  }

  function handleDescriptionChange(
    e: React.ChangeEvent<HTMLTextAreaElement>,
  ): void {
    const desc = e.target.value;
    setLocalDesc(desc);
    if (descTimerRef.current) clearTimeout(descTimerRef.current);
    descTimerRef.current = setTimeout(() => {
      updateMilestone(milestone!.filePath, {}, desc);
    }, DEBOUNCE_MS);
  }

  function handleTaskClick(taskId: string): void {
    useNavStore.getState().setActiveView("board");
    setMilestoneFilter(milestone!.id);
    useDataStore.getState().setSelectedTask(taskId);
  }

  async function handleCreateTask(): Promise<void> {
    const taskId = await createTask("New task");
    if (taskId) {
      // Find the task to get its filePath and set the milestone
      // We need to wait briefly for chokidar to refresh the task list
      setTimeout(() => {
        const task = useDataStore.getState().tasks.find((t) => t.id === taskId);
        if (task) {
          updateTask(task.filePath, { milestone: milestone!.id });
        }
        useNavStore.getState().setActiveView("board");
        useDataStore.getState().setSelectedTask(taskId);
      }, 500);
    }
  }

  return (
    <div className={styles.panel}>
      {/* Header */}
      <div className={styles.header}>
        <div className={styles.headerTop}>
          <span className={styles.idBadge}>{milestone.id}</span>
          <button
            className={`${styles.statusBadge} ${milestone.status === "open" ? styles.statusOpen : styles.statusClosed}`}
            onClick={handleStatusToggle}
            title={`Click to ${milestone.status === "open" ? "close" : "reopen"}`}
          >
            {milestone.status.toUpperCase()}
          </button>
          <button
            className={styles.closeBtn}
            onClick={() => setSelected(null)}
            aria-label="Close detail panel"
          >
            &times;
          </button>
        </div>
        <InlineEdit
          value={milestone.title}
          onSave={handleTitleSave}
          tag="h3"
          className={styles.title}
          placeholder="Milestone title..."
        />
      </div>

      {/* Description */}
      <div className={styles.section}>
        <div className={styles.sectionTitle}>Description</div>
        <textarea
          className={styles.descriptionTextarea}
          value={localDesc}
          onChange={handleDescriptionChange}
          placeholder="Milestone description..."
        />
      </div>

      {/* Tags */}
      <div className={styles.section}>
        <div className={styles.sectionTitle}>Tags</div>
        <TagInput
          tags={milestone.tags || []}
          onChange={handleTagsChange}
          placeholder="Add tag..."
        />
      </div>

      {/* Progress */}
      {taskCounts.total > 0 && (
        <div className={styles.section}>
          <div className={styles.progressLabel}>
            {taskCounts.done} of {taskCounts.total} tasks complete
          </div>
          <div className={styles.progressTrack}>
            <div
              className={styles.progressFill}
              style={{ width: `${progressPct}%` }}
            />
          </div>
        </div>
      )}

      {/* Linked tasks */}
      <div className={styles.section}>
        <div className={styles.sectionTitle}>Linked tasks</div>
        {linkedTasks.length === 0 && (
          <div className={styles.noTasks}>
            No tasks linked to this milestone
          </div>
        )}
        {STATUS_GROUPS.map((group) => {
          const groupTasks = linkedTasks.filter(
            (t) => t.status === group.status,
          );
          if (groupTasks.length === 0) return null;
          return (
            <div key={group.status} className={styles.taskGroup}>
              <div className={styles.groupHeader}>
                <span
                  className={styles.groupDot}
                  style={{ background: group.color }}
                />
                <span className={styles.groupLabel}>{group.label}</span>
                <span className={styles.groupCount}>{groupTasks.length}</span>
              </div>
              {groupTasks.map((t) => (
                <div
                  key={t.id}
                  className={styles.taskRow}
                  onClick={() => handleTaskClick(t.id)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) =>
                    (e.key === "Enter" || e.key === " ") &&
                    handleTaskClick(t.id)
                  }
                >
                  <span
                    className={styles.taskDot}
                    style={{ background: group.color }}
                  />
                  <span className={styles.taskTitle}>{t.title}</span>
                  {t.priority && (
                    <span
                      className={`${styles.taskPriority} ${PRIORITY_CLASSES[t.priority] || ""}`}
                    >
                      {t.priority}
                    </span>
                  )}
                </div>
              ))}
            </div>
          );
        })}
      </div>

      {/* Create task in milestone */}
      <div className={styles.section}>
        <button className={styles.createTaskBtn} onClick={handleCreateTask}>
          + Create task in milestone
        </button>
      </div>
    </div>
  );
}
