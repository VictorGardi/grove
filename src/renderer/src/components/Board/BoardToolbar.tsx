import { useEffect, useRef } from "react";
import { createTask } from "../../actions/taskActions";
import { useBoardStore } from "../../stores/useBoardStore";
import styles from "./BoardToolbar.module.css";

interface BoardToolbarProps {
  /** Number of search matches; undefined when search is inactive */
  matchCount?: number;
}

export function BoardToolbar({
  matchCount,
}: BoardToolbarProps): React.JSX.Element {
  const searchQuery = useBoardStore((s) => s.searchQuery);
  const searchActive = useBoardStore((s) => s.searchActive);
  const searchFocusCounter = useBoardStore((s) => s.searchFocusCounter);
  const setSearchQuery = useBoardStore((s) => s.setSearchQuery);
  const setSearchActive = useBoardStore((s) => s.setSearchActive);
  const clearSearch = useBoardStore((s) => s.clearSearch);

  const inputRef = useRef<HTMLInputElement>(null);

  // Focus search input whenever the counter increments
  useEffect(() => {
    if (searchFocusCounter > 0) {
      inputRef.current?.focus();
    }
  }, [searchFocusCounter]);

  function handleNewTask(): void {
    createTask("New task");
  }

  function handleSearchChange(e: React.ChangeEvent<HTMLInputElement>): void {
    setSearchQuery(e.target.value);
  }

  function handleSearchKeyDown(e: React.KeyboardEvent<HTMLInputElement>): void {
    if (e.key === "Escape") {
      e.preventDefault();
      clearSearch();
      inputRef.current?.blur();
    }
  }

  function handleSearchBlur(): void {
    // When blurring, keep search active if there's still a query
    if (!searchQuery) {
      setSearchActive(false);
    }
  }

  function handleSearchFocus(): void {
    setSearchActive(true);
  }

  return (
    <div className={styles.toolbar}>
      <button className={styles.newTaskBtn} onClick={handleNewTask}>
        + New task
      </button>

      <div
        className={`${styles.searchWrapper} ${searchActive || searchQuery ? styles.searchWrapperActive : ""}`}
      >
        <input
          ref={inputRef}
          type="text"
          className={styles.searchInput}
          placeholder="Search tasks…"
          value={searchQuery}
          onChange={handleSearchChange}
          onKeyDown={handleSearchKeyDown}
          onFocus={handleSearchFocus}
          onBlur={handleSearchBlur}
          data-board-search="true"
        />
        {searchQuery && matchCount !== undefined && (
          <span className={styles.matchCount}>
            {matchCount === 0
              ? "no matches"
              : matchCount === 1
                ? "1 match"
                : `${matchCount} matches`}
          </span>
        )}
      </div>
    </div>
  );
}
