import { useState, useMemo } from "react";
import type { TodoItem } from "@shared/types";
import styles from "./PlanChat.module.css";

function CheckboxIcon({ checked }: { checked: boolean }): React.JSX.Element {
  if (checked) {
    return (
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className={styles.todoCheckboxIconChecked}
      >
        <polyline points="20 6 9 17 4 12"></polyline>
      </svg>
    );
  }
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={styles.todoCheckboxIconUnchecked}
    >
      <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
    </svg>
  );
}

interface TodoListBlockProps {
  items: TodoItem[];
  title?: string;
}

export function TodoListBlock({
  items,
  title,
}: TodoListBlockProps): React.JSX.Element {
  const [showAll, setShowAll] = useState(false);

  const displayItems = useMemo(() => {
    if (items.length <= 10 || showAll) return items;
    return items.slice(0, 10);
  }, [items, showAll]);

  const completedCount = useMemo(
    () => items.filter((item) => item.completed).length,
    [items],
  );

  const totalCount = items.length;
  const needsCollapsing = items.length > 10;

  const toggleShowAll = () => {
    setShowAll((prev) => !prev);
  };

  const progressText = needsCollapsing
    ? `${completedCount}/${totalCount} completed`
    : `${completedCount} of ${totalCount} completed`;

  return (
    <div
      className={styles.todoListBlock}
      role="group"
      aria-label={title || "Todo list"}
    >
      {title && <div className={styles.todoListTitle}>{title}</div>}

      <div className={styles.todoListItems}>
        {displayItems.map((item) => (
          <div key={item.id} className={styles.todoItem} role="listitem">
            <label className={styles.todoLabel}>
              <span
                className={styles.todoCheckboxCustom}
                aria-label={
                  item.completed
                    ? `${item.text} (completed)`
                    : `${item.text} (not completed)`
                }
              >
                <CheckboxIcon checked={item.completed} />
              </span>
              <span
                className={`${styles.todoText} ${item.completed ? styles.todoTextCompleted : ""}`}
              >
                {item.text}
              </span>
            </label>
          </div>
        ))}
      </div>

      <div className={styles.todoListFooter}>
        <span className={styles.todoProgress}>{progressText}</span>

        {needsCollapsing && (
          <button
            className={styles.todoToggle}
            onClick={toggleShowAll}
            aria-expanded={showAll}
          >
            {showAll ? "Show less" : `Show ${totalCount - 10} more`}
          </button>
        )}
      </div>
    </div>
  );
}

interface TodoListFromMarkdownProps {
  content: string;
}

export function TodoListFromMarkdown({
  content,
}: TodoListFromMarkdownProps): React.JSX.Element | null {
  const todoData = useMemo(() => {
    const checkboxRegex = /^- \[([ x])\] (.+)$/gm;
    const items: TodoItem[] = [];
    let match;
    let id = 0;

    while ((match = checkboxRegex.exec(content)) !== null) {
      const completed = match[1].toLowerCase() === "x";
      const text = match[2].trim();
      items.push({ id: `todo-${id++}`, text, completed });
    }

    if (items.length === 0) return null;
    return { items };
  }, [content]);

  if (!todoData) return null;

  return <TodoListBlock items={todoData.items} />;
}
