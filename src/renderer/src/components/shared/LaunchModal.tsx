import { useState, useEffect, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import {
  useLaunchModalStore,
  type LaunchConfig,
} from "../../stores/useLaunchModalStore";
import { usePlanStore } from "../../stores/usePlanStore";
import { useWorkspaceStore } from "../../stores/useWorkspaceStore";
import type { PlanAgent, TaskInfo } from "@shared/types";
import styles from "./LaunchModal.module.css";
interface LaunchFormProps {
  task: TaskInfo;
  initialAgent: PlanAgent;
  initialModel: string | null;
  initialUseWorktree: boolean;
  workspacePath: string | null;
  onExecute: (config: LaunchConfig) => void;
  onCancel: () => void;
}

/** Inner form — receives initial values as props, manages its own controlled state.
 *  Gets re-mounted (via key={task.id}) each time a new task modal opens. */
function LaunchForm({
  task,
  initialAgent,
  initialModel,
  initialUseWorktree,
  workspacePath,
  onExecute,
  onCancel,
}: LaunchFormProps): React.JSX.Element {
  const [agent, setAgent] = useState<PlanAgent>(initialAgent);
  const [model, setModel] = useState<string | null>(initialModel);
  const [useWorktree, setUseWorktree] = useState<boolean>(initialUseWorktree);

  const executeButtonRef = useRef<HTMLButtonElement>(null);

  const modelsCache = usePlanStore((s) => s.modelsCache);
  const ensureModels = usePlanStore((s) => s.ensureModels);

  // Ensure models are loaded for the current agent
  useEffect(() => {
    if (!workspacePath) return;
    void ensureModels(workspacePath, agent);
  }, [workspacePath, agent, ensureModels]);

  // Focus the execute button on mount
  useEffect(() => {
    setTimeout(() => executeButtonRef.current?.focus(), 0);
  }, []);

  const handleAgentChange = useCallback(
    (newAgent: PlanAgent) => {
      setAgent(newAgent);
      if (workspacePath) {
        void ensureModels(workspacePath, newAgent);
      }
      // Reset model selection if not present in the new agent's model list
      setModel((prevModel) => {
        if (prevModel === null) return null;
        const cacheKey = `${workspacePath ?? ""}:${newAgent}`;
        const cached = modelsCache[cacheKey];
        if (Array.isArray(cached) && !cached.includes(prevModel)) {
          return null;
        }
        return prevModel;
      });
    },
    [workspacePath, ensureModels, modelsCache],
  );

  const cacheKey = `${workspacePath ?? ""}:${agent}`;
  const modelsCacheEntry = modelsCache[cacheKey];
  const modelsLoading = modelsCacheEntry === null;
  const availableModels: string[] = Array.isArray(modelsCacheEntry)
    ? modelsCacheEntry
    : [];

  // Validate current model against available models when cache loaded
  const validatedModel =
    model !== null &&
    Array.isArray(modelsCacheEntry) &&
    !modelsCacheEntry.includes(model)
      ? null
      : model;

  function handleExecute(): void {
    onExecute({ agent, model: validatedModel, useWorktree });
  }

  return (
    <div
      className={styles.modal}
      onClick={(e) => e.stopPropagation()}
      role="dialog"
      aria-modal="true"
      aria-labelledby="launch-modal-title"
    >
      <h2 id="launch-modal-title" className={styles.title}>
        Execute Task
      </h2>
      <p className={styles.taskTitle}>{task.title}</p>

      <div className={styles.fields}>
        {/* Agent selector */}
        <div className={styles.field}>
          <label className={styles.label} htmlFor="launch-agent">
            Agent
          </label>
          <select
            id="launch-agent"
            className={styles.select}
            value={agent}
            onChange={(e) => handleAgentChange(e.target.value as PlanAgent)}
          >
            <option value="opencode">opencode</option>
            <option value="copilot">copilot</option>
          </select>
        </div>

        {/* Model dropdown */}
        <div className={styles.field}>
          <label className={styles.label} htmlFor="launch-model">
            Model
          </label>
          <select
            id="launch-model"
            className={styles.select}
            value={validatedModel ?? ""}
            disabled={modelsLoading}
            onChange={(e) => {
              const val = e.target.value;
              setModel(val === "" ? null : val);
            }}
          >
            {modelsLoading ? (
              <option value="" disabled>
                loading…
              </option>
            ) : (
              <>
                <option value="">default</option>
                {availableModels.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </>
            )}
          </select>
        </div>

        {/* Use worktree toggle */}
        <div className={styles.field}>
          <label className={styles.checkboxLabel} htmlFor="launch-worktree">
            <input
              id="launch-worktree"
              type="checkbox"
              className={styles.checkbox}
              checked={useWorktree}
              onChange={(e) => setUseWorktree(e.target.checked)}
            />
            Use git worktree
          </label>
        </div>
      </div>

      <div className={styles.actions}>
        <button className={styles.cancelBtn} onClick={onCancel} type="button">
          Cancel
        </button>
        <button
          ref={executeButtonRef}
          className={styles.executeBtn}
          onClick={handleExecute}
          type="button"
        >
          Execute
        </button>
      </div>
    </div>
  );
}

/** Outer shell: renders the portal backdrop, handles Escape key, reads store. */
export function LaunchModal(): React.JSX.Element | null {
  const open = useLaunchModalStore((s) => s.open);
  const task = useLaunchModalStore((s) => s.task);
  const execute = useLaunchModalStore((s) => s.execute);
  const cancel = useLaunchModalStore((s) => s.cancel);

  const workspacePath = useWorkspaceStore((s) => s.activeWorkspacePath);
  const workspaceDefaults =
    useWorkspaceStore((s) =>
      s.activeWorkspacePath
        ? (s.workspaceDefaults[s.activeWorkspacePath] ?? null)
        : null,
    ) ?? {};

  // Keyboard handler: Escape = cancel
  useEffect(() => {
    if (!open) return;

    function handleKeyDown(e: KeyboardEvent): void {
      if (e.key === "Escape") {
        e.preventDefault();
        cancel();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, cancel]);

  if (!open || !task) return null;

  // Compute initial values for the form (3-level fallbacks).
  // Note: workspace defaults are pre-fetched in Board.tsx handleDragEnd before
  // the modal is shown, so workspaceDefaults should be available here.
  const initialAgent: PlanAgent =
    task.execSessionAgent ??
    workspaceDefaults?.defaultExecutionAgent ??
    "opencode";
  const initialModel: string | null =
    task.execModel ?? workspaceDefaults?.defaultExecutionModel ?? null;
  const initialUseWorktree = task.useWorktree ?? true;

  return createPortal(
    <div className={styles.backdrop} onClick={cancel}>
      {/* key={task.id} ensures LaunchForm remounts (resetting state) for each new task */}
      <LaunchForm
        key={task.id}
        task={task}
        initialAgent={initialAgent}
        initialModel={initialModel}
        initialUseWorktree={initialUseWorktree}
        workspacePath={workspacePath}
        onExecute={execute}
        onCancel={cancel}
      />
    </div>,
    document.body,
  );
}
