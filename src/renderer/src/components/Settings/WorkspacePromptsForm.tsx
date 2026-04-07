import { useState, useEffect } from "react";
import { useWorkspaceStore } from "../../stores/useWorkspaceStore";
import {
  DEFAULT_PLAN_PERSONA,
  DEFAULT_PLAN_REVIEW_PERSONA,
  DEFAULT_EXECUTE_PERSONA,
  DEFAULT_EXECUTE_REVIEW_PERSONA,
  DEFAULT_EXECUTE_REVIEW_INSTRUCTIONS,
} from "../../utils/planPrompts";
import styles from "./Settings.module.css";

interface WorkspacePromptsFormProps {
  workspacePath: string;
  isDisabled: boolean;
}

export function WorkspacePromptsForm({
  workspacePath,
  isDisabled,
}: WorkspacePromptsFormProps): React.JSX.Element {
  const [planPersona, setPlanPersona] = useState<string>("");
  const [planReviewPersona, setPlanReviewPersona] = useState<string>("");
  const [executePersona, setExecutePersona] = useState<string>("");
  const [executeReviewPersona, setExecuteReviewPersona] = useState<string>("");
  const [executeReviewInstructions, setExecuteReviewInstructions] =
    useState<string>("");

  const fetchDefaults = useWorkspaceStore((s) => s.fetchDefaults);
  const updateDefaults = useWorkspaceStore((s) => s.updateDefaults);
  const workspaceDefaults = useWorkspaceStore((s) => s.workspaceDefaults);

  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    if (!workspacePath) {
      setInitialized(false);
      return;
    }

    fetchDefaults(workspacePath).then(() => setInitialized(true));
  }, [workspacePath, fetchDefaults]);

  useEffect(() => {
    if (!workspacePath || !initialized) return;

    const defaults = workspaceDefaults[workspacePath];

    setPlanPersona(defaults?.planPersona ?? "");
    setPlanReviewPersona(defaults?.planReviewPersona ?? "");
    setExecutePersona(defaults?.executePersona ?? "");
    setExecuteReviewPersona(defaults?.executeReviewPersona ?? "");
    setExecuteReviewInstructions(defaults?.executeReviewInstructions ?? "");
  }, [workspacePath, initialized]);

  const handleSave = async (field: string, value: string): Promise<void> => {
    if (!workspacePath) return;

    await updateDefaults(workspacePath, {
      planPersona: field === "planPersona" ? value : undefined,
      planReviewPersona: field === "planReviewPersona" ? value : undefined,
      executePersona: field === "executePersona" ? value : undefined,
      executeReviewPersona:
        field === "executeReviewPersona" ? value : undefined,
      executeReviewInstructions:
        field === "executeReviewInstructions" ? value : undefined,
    });
  };

  const handleReset = async (field: string): Promise<void> => {
    if (!workspacePath) return;

    switch (field) {
      case "planPersona":
        setPlanPersona("");
        break;
      case "planReviewPersona":
        setPlanReviewPersona("");
        break;
      case "executePersona":
        setExecutePersona("");
        break;
      case "executeReviewPersona":
        setExecuteReviewPersona("");
        break;
      case "executeReviewInstructions":
        setExecuteReviewInstructions("");
        break;
    }

    await updateDefaults(workspacePath, {
      [field]: undefined,
    });
  };

  const disabled = isDisabled || !workspacePath;

  const MAX_CHARS = 3000;

  return (
    <div className={styles.defaultsGroup}>
      <h3 className={styles.defaultsGroupTitle}>Prompt Customization</h3>

      <p className={styles.sectionDesc}>
        Customize the persona names and review instructions that appear in the
        prompts sent to planning and execution agents. Leave empty to use
        defaults.
      </p>

      <div className={styles.promptWarning}>
        Warning: Prompt content is sent to external agents. Be cautious of
        instructions that could override system behavior.
      </div>

      <div className={styles.promptField}>
        <div className={styles.promptFieldHeader}>
          <span className={styles.defaultsLabel}>Plan Persona</span>
          <button
            className={styles.resetBtn}
            onClick={() => handleReset("planPersona")}
            disabled={disabled}
            title="Reset to default"
          >
            Reset
          </button>
        </div>
        <p className={styles.promptDescription}>
          Prefix instructions used during the <strong>planning phase</strong> to
          describe how the planning agent should approach creating tasks in the{" "}
          <strong>backlog column</strong>.
        </p>
        <input
          type="text"
          className={styles.promptInput}
          value={planPersona}
          onChange={(e) => setPlanPersona(e.target.value)}
          onBlur={() => handleSave("planPersona", planPersona)}
          disabled={disabled}
          placeholder={DEFAULT_PLAN_PERSONA}
          maxLength={MAX_CHARS}
        />
        <span className={styles.charCount}>
          {planPersona.length}/{MAX_CHARS}
        </span>
      </div>

      <div className={styles.promptField}>
        <div className={styles.promptFieldHeader}>
          <span className={styles.defaultsLabel}>Plan Review Persona</span>
          <button
            className={styles.resetBtn}
            onClick={() => handleReset("planReviewPersona")}
            disabled={disabled}
            title="Reset to default"
          >
            Reset
          </button>
        </div>
        <p className={styles.promptDescription}>
          Suffix instructions used during the <strong>planning phase</strong> to
          review and iterate on the generated plan before tasks move from{" "}
          <strong>backlog</strong> to <strong>doing</strong>.
        </p>
        <input
          type="text"
          className={styles.promptInput}
          value={planReviewPersona}
          onChange={(e) => setPlanReviewPersona(e.target.value)}
          onBlur={() => handleSave("planReviewPersona", planReviewPersona)}
          disabled={disabled}
          placeholder={DEFAULT_PLAN_REVIEW_PERSONA}
          maxLength={MAX_CHARS}
        />
        <span className={styles.charCount}>
          {planReviewPersona.length}/{MAX_CHARS}
        </span>
      </div>

      <div className={styles.promptField}>
        <div className={styles.promptFieldHeader}>
          <span className={styles.defaultsLabel}>Execute Persona</span>
          <button
            className={styles.resetBtn}
            onClick={() => handleReset("executePersona")}
            disabled={disabled}
            title="Reset to default"
          >
            Reset
          </button>
        </div>
        <p className={styles.promptDescription}>
          Prefix instructions used during the <strong>execution phase</strong>{" "}
          to guide the agent in implementing tasks in the{" "}
          <strong>doing column</strong>.
        </p>
        <input
          type="text"
          className={styles.promptInput}
          value={executePersona}
          onChange={(e) => setExecutePersona(e.target.value)}
          onBlur={() => handleSave("executePersona", executePersona)}
          disabled={disabled}
          placeholder={DEFAULT_EXECUTE_PERSONA}
          maxLength={MAX_CHARS}
        />
        <span className={styles.charCount}>
          {executePersona.length}/{MAX_CHARS}
        </span>
      </div>

      <div className={styles.promptField}>
        <div className={styles.promptFieldHeader}>
          <span className={styles.defaultsLabel}>Execute Review Persona</span>
          <button
            className={styles.resetBtn}
            onClick={() => handleReset("executeReviewPersona")}
            disabled={disabled}
            title="Reset to default"
          >
            Reset
          </button>
        </div>
        <p className={styles.promptDescription}>
          Suffix instructions used during the <strong>execution phase</strong>{" "}
          to review and iterate on the implementation before tasks move from{" "}
          <strong>doing</strong> onwards.
        </p>
        <input
          type="text"
          className={styles.promptInput}
          value={executeReviewPersona}
          onChange={(e) => setExecuteReviewPersona(e.target.value)}
          onBlur={() =>
            handleSave("executeReviewPersona", executeReviewPersona)
          }
          disabled={disabled}
          placeholder={DEFAULT_EXECUTE_REVIEW_PERSONA}
          maxLength={MAX_CHARS}
        />
        <span className={styles.charCount}>
          {executeReviewPersona.length}/{MAX_CHARS}
        </span>
      </div>

      <div className={styles.promptField}>
        <div className={styles.promptFieldHeader}>
          <span className={styles.defaultsLabel}>
            Execute Review Instructions
          </span>
          <button
            className={styles.resetBtn}
            onClick={() => handleReset("executeReviewInstructions")}
            disabled={disabled}
            title="Reset to default"
          >
            Reset
          </button>
        </div>
        <p className={styles.promptDescription}>
          Detailed suffix instructions for the <strong>execution phase</strong>{" "}
          review. These are appended to review prompts to guide iteration on
          implementation quality, test coverage, and code standards before tasks
          move from <strong>doing</strong> onwards.
        </p>
        <textarea
          className={styles.promptTextarea}
          value={executeReviewInstructions}
          onChange={(e) => setExecuteReviewInstructions(e.target.value)}
          onBlur={() =>
            handleSave("executeReviewInstructions", executeReviewInstructions)
          }
          disabled={disabled}
          placeholder={DEFAULT_EXECUTE_REVIEW_INSTRUCTIONS}
          maxLength={MAX_CHARS}
          rows={6}
        />
        <span className={styles.charCount}>
          {executeReviewInstructions.length}/{MAX_CHARS}
        </span>
      </div>
    </div>
  );
}
