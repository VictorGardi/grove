import { useState } from "react";
import type { QuestionRequest, QuestionInfo } from "@opencode-ai/sdk/v2";
import styles from "./TaskEventStream.module.css";

interface QuestionCardProps {
  request: QuestionRequest;
  onReply: (answers: string[][]) => Promise<void>;
  onReject: () => Promise<void>;
}

export function QuestionCard({
  request,
  onReply,
  onReject,
}: QuestionCardProps): React.JSX.Element {
  const [selections, setSelections] = useState<string[][]>(
    request.questions.map(() => []),
  );
  const [submitting, setSubmitting] = useState(false);

  function toggleOption(qIdx: number, option: string, multiple: boolean) {
    setSelections((prev) => {
      const next = [...prev];
      if (multiple) {
        const cur = next[qIdx];
        next[qIdx] = cur.includes(option)
          ? cur.filter((o) => o !== option)
          : [...cur, option];
      } else {
        next[qIdx] = [option];
      }
      return next;
    });
  }

  async function handleSubmit() {
    setSubmitting(true);
    try {
      await onReply(selections);
    } finally {
      setSubmitting(false);
    }
  }

  const allAnswered = request.questions.every((_, i) => selections[i].length > 0);

  return (
    <div className={styles.questionCard}>
      {request.questions.map((q, i) => (
        <QuestionBlock
          key={i}
          question={q}
          selected={selections[i]}
          onToggle={(opt) => toggleOption(i, opt, !!q.multiple)}
        />
      ))}
      <div className={styles.questionActions}>
        <button
          className={styles.questionSubmit}
          onClick={handleSubmit}
          disabled={!allAnswered || submitting}
        >
          {submitting ? "Submitting..." : "Submit"}
        </button>
        <button
          className={styles.questionDismiss}
          onClick={onReject}
          disabled={submitting}
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}

function QuestionBlock({
  question,
  selected,
  onToggle,
}: {
  question: QuestionInfo;
  selected: string[];
  onToggle: (option: string) => void;
}): React.JSX.Element {
  return (
    <div className={styles.questionBlock}>
      {question.header && (
        <div className={styles.questionHeader}>{question.header}</div>
      )}
      <div className={styles.questionText}>{question.question}</div>
      <div className={styles.questionOptions}>
        {question.options.map((opt, i) => {
          const checked = selected.includes(opt.label);
          return (
            <label key={i} className={styles.questionOption}>
              <input
                type={question.multiple ? "checkbox" : "radio"}
                checked={checked}
                onChange={() => onToggle(opt.label)}
              />
              <div>
                <span>{opt.label}</span>
                {opt.description && (
                  <div className={styles.questionOptionDesc}>{opt.description}</div>
                )}
              </div>
            </label>
          );
        })}
      </div>
    </div>
  );
}
