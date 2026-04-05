import { useState, useRef, useEffect, type KeyboardEvent } from "react";
import styles from "./InlineEdit.module.css";

interface InlineEditProps {
  value: string;
  onSave: (value: string) => void;
  className?: string;
  placeholder?: string;
  tag?: "h2" | "h3" | "span";
  startEditing?: boolean;
}

export function InlineEdit({
  value,
  onSave,
  className,
  placeholder = "Click to edit...",
  tag: Tag = "span",
  startEditing = false,
}: InlineEditProps): React.JSX.Element {
  const [editing, setEditing] = useState(startEditing);
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setDraft(value);
  }, [value]);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  function handleSave(): void {
    const trimmed = draft.trim();
    if (trimmed && trimmed !== value) {
      onSave(trimmed);
    } else {
      setDraft(value);
    }
    setEditing(false);
  }

  function handleKeyDown(e: KeyboardEvent): void {
    if (e.key === "Enter") {
      e.preventDefault();
      handleSave();
    } else if (e.key === "Escape") {
      setDraft(value);
      setEditing(false);
    }
  }

  if (editing) {
    return (
      <input
        ref={inputRef}
        className={`${styles.input} ${className || ""}`}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={handleSave}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
      />
    );
  }

  return (
    <Tag
      className={`${styles.display} ${className || ""}`}
      onClick={() => setEditing(true)}
      title="Click to edit"
    >
      {value || <span className={styles.placeholder}>{placeholder}</span>}
    </Tag>
  );
}
