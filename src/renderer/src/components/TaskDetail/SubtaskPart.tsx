import { useState } from "react";
import styles from "./TaskEventStream.module.css";

interface SubtaskPartProps {
  description?: string;
  command?: string;
  agent?: string;
  prompt?: string;
  taskSessionID?: string;
  model?: { providerID?: string; modelID?: string };
}

export function SubtaskPart({ description, command, agent, prompt, taskSessionID, model }: SubtaskPartProps): React.JSX.Element {
  const [expanded, setExpanded] = useState(false);

  const modelString = model?.providerID && model?.modelID ? `${model.providerID}/${model.modelID}` : null;

  return (
    <div className={styles.subtaskPart}>
      <div className={styles.subtaskHeader}>
        <span className={styles.subtaskIcon}>&#x2192;</span>
        <span className={styles.subtaskLabel}>subtask</span>
        {command && <span className={styles.subtaskCommand}>/{command}</span>}
        {agent && <span className={styles.subtaskAgent}>@{agent}</span>}
        {modelString && <span className={styles.subtaskModel}>{modelString}</span>}
      </div>

      {description && <div className={styles.subtaskDescription}>{description}</div>}

      {prompt && (
        <div className={styles.subtaskPromptSection}>
          <button className={styles.subtaskPromptToggle} onClick={() => setExpanded(!expanded)}>
            {expanded ? "Hide prompt" : "Show prompt"}
          </button>
          {expanded && <pre className={styles.subtaskPrompt}>{prompt}</pre>}
        </div>
      )}

      {taskSessionID && (
        <button className={styles.subtaskOpenSession}>
          Open session
        </button>
      )}
    </div>
  );
}