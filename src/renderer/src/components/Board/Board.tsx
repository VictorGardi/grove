import { useState, useCallback, useEffect, useMemo } from "react";
import Fuse from "fuse.js";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  type DragStartEvent,
  type DragEndEvent,
} from "@dnd-kit/core";
import { useDataStore } from "../../stores/useDataStore";
import { useBoardStore } from "../../stores/useBoardStore";
import type { TaskInfo, TaskStatus } from "@shared/types";
import { createTask, moveTask } from "../../actions/taskActions";
import {
  showLaunchModalAndExecute,
  completeTask,
} from "../../actions/executionActions";
import { Column } from "./Column";
import { BoardToolbar } from "./BoardToolbar";
import { TaskCard } from "./TaskCard";
import styles from "./Board.module.css";

const COLUMNS: { status: TaskStatus; label: string; color: string }[] = [
  { status: "backlog", label: "BACKLOG", color: "var(--status-backlog)" },
  { status: "doing", label: "DOING", color: "var(--status-green)" },
  { status: "review", label: "REVIEW", color: "var(--status-amber)" },
  { status: "done", label: "DONE", color: "var(--status-done)" },
];

const VALID_STATUSES = new Set<string>(["backlog", "doing", "review", "done"]);

export function Board(): React.JSX.Element {
  const tasks = useDataStore((s) => s.tasks);
  const loading = useDataStore((s) => s.loading);
  const [activeTask, setActiveTask] = useState<TaskInfo | null>(null);

  const searchQuery = useBoardStore((s) => s.searchQuery);

  // Clear search when leaving board view (handled via useEffect in parent,
  // but we also handle it here when component unmounts)
  useEffect(() => {
    return () => {
      useBoardStore.getState().clearSearch();
    };
  }, []);

  // Fuse.js instance, rebuilt when tasks change
  const fuse = useMemo(
    () =>
      new Fuse(tasks, {
        keys: ["title", "description", "tags", "id"],
        threshold: 0.35,
        includeScore: true,
      }),
    [tasks],
  );

  // Compute search results
  const searchResults = useMemo(() => {
    if (!searchQuery.trim()) return null;
    return fuse.search(searchQuery);
  }, [fuse, searchQuery]);

  // Set of matched task IDs (in ranked order)
  const matchedIds: string[] | null = useMemo(() => {
    if (!searchResults) return null;
    return searchResults.map((r) => r.item.id);
  }, [searchResults]);

  const matchCount = matchedIds?.length ?? 0;

  // Handle Enter from board search: open top-ranked match
  useEffect(() => {
    function handleBoardSearchEnter(): void {
      if (!matchedIds || matchedIds.length === 0) return;
      const topId = matchedIds[0];
      useDataStore.getState().setSelectedTask(topId);
      useBoardStore.getState().clearSearch();
    }

    document.addEventListener("board-search-enter", handleBoardSearchEnter);
    return () =>
      document.removeEventListener(
        "board-search-enter",
        handleBoardSearchEnter,
      );
  }, [matchedIds]);

  // Pointer sensor with activation distance to avoid accidental drags on click
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  // When search is active, filter displayed tasks; otherwise show all
  const filtered = useMemo(
    () => (searchResults ? searchResults.map((r) => r.item) : tasks),
    [tasks, searchResults],
  );

  const handleDragStart = useCallback(
    (event: DragStartEvent) => {
      const task = tasks.find((t) => t.id === event.active.id);
      setActiveTask(task ?? null);
    },
    [tasks],
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      setActiveTask(null);
      const { active, over } = event;
      if (!over) return;

      const task = tasks.find((t) => t.id === active.id);
      if (!task) return;

      const toStatus = String(over.id);
      if (!VALID_STATUSES.has(toStatus)) return;
      if (task.status === toStatus) return;

      if (toStatus === "doing") {
        if (task.terminalExecSession) return;
        void showLaunchModalAndExecute(task);
        return;
      }

      if (toStatus === "done") {
        void completeTask(task);
        return;
      }

      moveTask(task.filePath, toStatus as TaskStatus);
    },
    [tasks],
  );

  const handleDragCancel = useCallback(() => {
    setActiveTask(null);
  }, []);

  if (loading && tasks.length === 0) {
    return (
      <div className={styles.board}>
        <div className={styles.loading}>Loading tasks...</div>
      </div>
    );
  }

  if (!loading && tasks.length === 0) {
    return (
      <div className={styles.board}>
        <div className={styles.empty}>
          <div className={styles.emptyTitle}>No tasks yet</div>
          <div className={styles.emptyHint}>
            Create a Markdown file in .grove/tasks/backlog/ to get started
          </div>
          <button
            className={styles.createFirstTaskBtn}
            onClick={() => createTask("New task")}
          >
            + Create first task
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.board}>
      <BoardToolbar matchCount={searchQuery.trim() ? matchCount : undefined} />
      <DndContext
        sensors={sensors}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragCancel={handleDragCancel}
      >
        <div className={styles.columns}>
          {COLUMNS.map((col) => {
            let colTasks = filtered.filter((t) => t.status === col.status);
            if (col.status === "done") {
              colTasks = [...colTasks].sort((a, b) => {
                const dateA = a.completed ?? a.created ?? "";
                const dateB = b.completed ?? b.created ?? "";
                return dateB.localeCompare(dateA);
              });
            }
            return (
              <Column
                key={col.status}
                status={col.status}
                label={col.label}
                color={col.color}
                tasks={colTasks}
                matchedIds={matchedIds}
              />
            );
          })}
        </div>
        <DragOverlay dropAnimation={null}>
          {activeTask && (
            <div className={styles.dragOverlay}>
              <TaskCard task={activeTask} />
            </div>
          )}
        </DragOverlay>
      </DndContext>
    </div>
  );
}
